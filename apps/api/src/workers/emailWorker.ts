import { Worker, Job } from 'bullmq';
import { EMAIL_QUEUE_NAME, EmailJobData, esIndexQueue } from '../queues/emailQueue';
import { redisClient, redisConnectionOptions } from '../queues/redis';
import { prisma } from '../prisma/client';
import { rateLimiterService, RateLimiterService } from '../services/rateLimiter';
import { etherealService, SendMailResult } from '../services/ethereal';
import { slackService } from '../services/slack';
import { config } from '../config/env';
import { EmailStatus, EventType } from '@reachflow/shared';

export interface DispatchReceipt {
  messageId: string;
  previewUrl: string | false;
  sentAt: string;
}

const DISPATCH_RECEIPT_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days retention
const DISPATCH_RECEIPT_KEY_PREFIX = 'reachflow:dispatch_receipt:';
export const PROCESSING_LEASE_TIMEOUT_MS = 60 * 1000; // 60 seconds lease window

export class EmailWorkerService {
  private worker: Worker<EmailJobData> | null = null;
  public static LEASE_TIMEOUT_MS = PROCESSING_LEASE_TIMEOUT_MS;
  public static RECOVERY_BUFFER_MS = 5_000; // 5 seconds after lease expiry
  public static HEARTBEAT_INTERVAL_MS = 15_000; // 15 seconds heartbeat interval

  public start(): Worker<EmailJobData> {
    if (this.worker) {
      return this.worker;
    }

    this.worker = new Worker<EmailJobData>(
      EMAIL_QUEUE_NAME,
      async (job: Job<EmailJobData>) => {
        const { emailId } = job.data;
        await this.processEmailJob(emailId, job);
      },
      {
        connection: redisConnectionOptions,
        concurrency: config.workerConcurrency, // Configurable multi-worker concurrency
      }
    );

    this.worker.on('ready', () => {
      console.log(`[EmailWorker] Worker ready with concurrency: ${config.workerConcurrency}`);
    });

    this.worker.on('failed', (job, err) => {
      console.error(`[EmailWorker] Job ${job?.id} failed:`, err.message);
    });

    return this.worker;
  }

  private getReceiptKey(emailId: string): string {
    return `${DISPATCH_RECEIPT_KEY_PREFIX}${emailId}`;
  }

  private async getDispatchReceipt(emailId: string): Promise<DispatchReceipt | null> {
    try {
      if (!redisClient || typeof redisClient.get !== 'function') {
        return null;
      }
      const raw = await redisClient.get(this.getReceiptKey(emailId));
      if (!raw) return null;
      return JSON.parse(raw) as DispatchReceipt;
    } catch (err) {
      console.warn(`[EmailWorker] Failed to read dispatch receipt for ${emailId}:`, (err as Error).message);
      return null;
    }
  }

  private async saveDispatchReceipt(emailId: string, receipt: DispatchReceipt): Promise<DispatchReceipt | null> {
    const key = this.getReceiptKey(emailId);
    const maxAttempts = 3;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        if (!redisClient || typeof redisClient.set !== 'function') {
          return receipt;
        }
        // Use NX to guarantee atomic write without overwriting existing authoritative receipt
        const res = await redisClient.set(key, JSON.stringify(receipt), 'EX', DISPATCH_RECEIPT_TTL_SECONDS, 'NX');
        if (res === 'OK') {
          return receipt;
        }
        // NX was rejected — another write beat us. Read the existing authoritative receipt.
        const existingRaw = await redisClient.get(key);
        if (existingRaw) {
          return JSON.parse(existingRaw) as DispatchReceipt;
        }
        // GET returned nothing: the key was evicted or lost in the NX→GET race window.
        // Do NOT return the in-memory receipt as authoritative — persistence is unconfirmed.
        return null;
      } catch (err) {
        lastError = err;
        console.warn(
          `[EmailWorker] Redis dispatch receipt save attempt ${attempt}/${maxAttempts} failed for email ${emailId}:`,
          (err as Error).message
        );
        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 100));
        }
      }
    }

    console.error(
      `[EmailWorker] CRITICAL: Persistently failed to record dispatch receipt in Redis for ${emailId} after ${maxAttempts} attempts:`,
      (lastError as Error)?.message
    );
    return null;
  }

  private async finalizeSentStatus(
    emailId: string,
    campaignId: string,
    receipt: DispatchReceipt
  ): Promise<void> {
    const maxLocalAttempts = 3;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxLocalAttempts; attempt++) {
      try {
        const finalized = await prisma.$transaction(async (tx) => {
          const result = await tx.email.updateMany({
            where: {
              id: emailId,
              status: {
                not: EmailStatus.SENT,
              },
            },
            data: {
              status: EmailStatus.SENT,
              sentAt: new Date(receipt.sentAt),
              messageId: receipt.messageId,
              previewUrl: receipt.previewUrl ? receipt.previewUrl : null,
            },
          });

          if (result.count === 1) {
            const campaignClient = tx.campaign || prisma.campaign;
            await campaignClient.update({
              where: { id: campaignId },
              data: {
                sentEmails: { increment: 1 },
              },
            });

            const eventClient = tx.emailEvent || prisma.emailEvent;
            await eventClient.create({
              data: {
                emailId,
                type: EventType.SMTP_DELIVERED,
                message: `Email successfully delivered to SMTP server. Message-ID: ${receipt.messageId}`,
                metadata: {
                  messageId: receipt.messageId,
                  previewUrl: receipt.previewUrl || null,
                },
              },
            });

            return true;
          }

          return false;
        });

        if (finalized) {
          console.log(`[EmailWorker] Email ${emailId} successfully finalized as SENT`);
          if (receipt.previewUrl) {
            console.log(`[EmailWorker] Preview URL: ${receipt.previewUrl}`);
          }

          // ASYNC DECOUPLED ELASTICSEARCH INDEXING (Isolated search projection)
          try {
            await esIndexQueue.add(
              'index-email',
              { emailId, action: 'update' },
              { jobId: `es-index-${emailId}` }
            );
          } catch (queueErr) {
            console.warn('[EmailWorker] Could not queue ES indexing:', (queueErr as Error).message);
          }
        } else {
          console.log(
            `[EmailWorker] Email ${emailId} was already finalized as SENT. Skipping counter increment and duplicate event creation.`
          );
        }

        return;
      } catch (err) {
        lastError = err;
        console.warn(
          `[EmailWorker] PostgreSQL SENT finalization attempt ${attempt}/${maxLocalAttempts} failed for email ${emailId}:`,
          (err as Error).message
        );
        if (attempt < maxLocalAttempts) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 150));
        }
      }
    }

    throw lastError;
  }

  /**
   * F7: Classify SMTP delivery errors as clear pre-send failures (safe to retry)
   * vs ambiguous post-transmission errors (unsafe to retry because remote MTA may have accepted).
   *
   * @param error The caught error from SMTP dispatch
   * @param transmissionStarted Whether the attempt entered the transmission phase
   */
  public isAmbiguousSmtpError(error: unknown, transmissionStarted: boolean = false): boolean {
    if (!error) return false;

    const err = error as Record<string, any>;
    const message = (err.message || '').toLowerCase();
    const code = (err.code || '').toUpperCase();
    const command = (err.command || '').toUpperCase();
    const responseCode = Number(err.responseCode) || 0;

    // 1. CLEAR PRE-SEND / PROTOCOL REJECTIONS (Never reached message body transmission):
    // If the error occurred during connection establishment, greeting, auth, or recipient envelope,
    // the email body was never sent, so delivery definitively did not take place.
    if (
      command === 'CONN' ||
      command === 'EHLO' ||
      command === 'HELO' ||
      command === 'AUTH' ||
      command === 'MAIL' ||
      command === 'RCPT'
    ) {
      return false;
    }
    if (
      code === 'ECONNREFUSED' ||
      code === 'ENOTFOUND' ||
      code === 'EAI_AGAIN' ||
      code === 'EAUTH' ||
      code === 'EENVELOPE'
    ) {
      return false;
    }
    if (
      message.includes('connection refused') ||
      message.includes('econnrefused') ||
      message.includes('enotfound') ||
      message.includes('getaddrinfo') ||
      message.includes('authentication') ||
      message.includes('invalid login') ||
      message.includes('recipient rejected') ||
      message.includes('mailbox unavailable') ||
      message.includes('relay access denied') ||
      message.includes('service unavailable') ||
      message.includes('503') ||
      message.includes('550') ||
      message.includes('535')
    ) {
      return false;
    }
    // Specific pre-send connection timeout (e.g. connecting to SMTP host before data)
    if (
      message.includes('connection timeout') ||
      message.includes('connect timeout') ||
      message.includes('greeting timeout')
    ) {
      return false;
    }
    // Explicit SMTP negative completion status codes before/at RCPT (e.g. 535, 550, 503, 421)
    if (responseCode === 535 || responseCode === 550 || responseCode === 503 || responseCode === 421) {
      return false;
    }

    // 2. HAS TRANSMISSION ENTERED SEND PHASE?
    const hasTransmissionStarted =
      transmissionStarted ||
      err.transmissionStarted === true ||
      err.isPostTransmission === true ||
      err.phase === 'transmission' ||
      command === 'DATA' ||
      command === 'MESSAGE' ||
      command === 'DOT';

    // 3. AMBIGUOUS NETWORK / TIMEOUT / DISCONNECTION ERRORS:
    const isAmbiguousNetworkError =
      code === 'ECONNRESET' ||
      code === 'ETIMEDOUT' ||
      code === 'ESOCKETTIMEDOUT' ||
      code === 'EPIPE' ||
      code === 'ECONNABORTED' ||
      message.includes('econnreset') ||
      message.includes('socket hang up') ||
      message.includes('socket timeout') ||
      message.includes('read timeout') ||
      message.includes('broken pipe') ||
      message.includes('connection reset') ||
      message.includes('connection closed') ||
      message.includes('client network socket disconnected') ||
      message.includes('ambiguous');

    if (hasTransmissionStarted && isAmbiguousNetworkError) {
      return true;
    }

    if (command === 'DATA' || command === 'MESSAGE' || command === 'DOT') {
      return true;
    }

    // In-flight socket drops that inherently happen during active streaming or response read
    if (
      code === 'ECONNRESET' ||
      code === 'EPIPE' ||
      message.includes('read econnreset') ||
      message.includes('socket hang up') ||
      message.includes('during transmission') ||
      message.includes('post-transmission')
    ) {
      return true;
    }

    return false;
  }

  private async processEmailJob(emailId: string, job: Job<EmailJobData>): Promise<void> {
    // 1. Fetch email and associated entities from PostgreSQL (Source of Truth)
    const email = await prisma.email.findUnique({
      where: { id: emailId },
      include: {
        sender: true,
        campaign: true,
        user: true,
      },
    });

    if (!email) {
      console.warn(`[EmailWorker] Email with ID ${emailId} not found in DB. Skipping.`);
      return;
    }

    // 2. IDEMPOTENCY CHECK: If already sent or failed, exit safely without duplicate dispatch
    if (email.status === EmailStatus.SENT) {
      console.log(`[EmailWorker] Email ${emailId} is already marked as SENT. Skipping duplicate execution.`);
      return;
    }

    if (email.status === EmailStatus.FAILED) {
      console.log(`[EmailWorker] Email ${emailId} is already marked as FAILED. Skipping execution.`);
      return;
    }

    // F5: SCHEDULEDAT GUARD FOR RESCHEDULED EMAILS
    // If email is in RESCHEDULED status and scheduledAt is in the future, do not process prematurely.
    if (
      email.status === EmailStatus.RESCHEDULED &&
      email.scheduledAt &&
      new Date(email.scheduledAt).getTime() > Date.now()
    ) {
      console.log(
        `[EmailWorker] Email ${emailId} is RESCHEDULED for future execution at ${new Date(email.scheduledAt).toISOString()}. Skipping premature execution.`
      );
      return;
    }

    // 3. DISPATCH RECEIPT CHECK (RULE B): If already accepted by SMTP in a prior attempt where DB commit failed,
    // bypass SMTP completely and directly finalize PostgreSQL state using stored receipt.
    // Also skips rate limiter check and send slot reservation to avoid consuming extra quota.
    const existingReceipt = await this.getDispatchReceipt(emailId);
    if (existingReceipt) {
      console.log(
        `[EmailWorker] Existing dispatch receipt found for email ${emailId} (Message-ID: ${existingReceipt.messageId}). Bypassing SMTP and finalizing DB.`
      );
      await this.finalizeSentStatus(emailId, email.campaignId, existingReceipt);
      return;
    }

    // 4. PROCESSING STATE RECOVERY / ABANDONED WORKER CHECK (RULES D, E, F)
    //
    // LEASE IS THE SOLE AUTHORITY (F3 FIX):
    // job.attemptsMade > 0 alone does NOT prove that a worker has abandoned the email.
    // A retry can occur due to transient Redis/DB failures while a valid lease is still active,
    // or while another worker is legitimately processing the job.
    // Only an expired lease (updatedAt older than PROCESSING_LEASE_TIMEOUT_MS) proves abandonment.
    if (email.status === EmailStatus.PROCESSING) {
      const updatedAtMs = email.updatedAt ? new Date(email.updatedAt).getTime() : NaN;
      const hasValidUpdatedAt = Number.isFinite(updatedAtMs);

      // If updatedAt is valid, compute elapsed time. If missing/invalid (e.g. test mock),
      // default leaseElapsedMs to 0 so the lease is protected with the full timeout window.
      const leaseElapsedMs = hasValidUpdatedAt ? Math.max(0, Date.now() - updatedAtMs) : 0;
      const isLeaseExpired = hasValidUpdatedAt && leaseElapsedMs >= EmailWorkerService.LEASE_TIMEOUT_MS;

      if (!isLeaseExpired) {
        // Lease is still active — the original worker is (or recently was) processing this email.
        // This is safe regardless of job.attemptsMade: a BullMQ retry due to infrastructure
        // failure does not mean SMTP was called or the email was abandoned.
        //
        // F3 MULTI-GENERATION RECOVERY:
        // Schedule a deterministic delayed recovery job that fires AFTER the lease expires.
        //
        // - generation 0/1/2... per email.attempts
        // - If this execution is already a recovery job (isRecovery: true), it increments the generation
        //   (currentGen + 1) so it does NOT collide with itself or deduplicate against its own active jobId.
        // - If this is a concurrent regular retry (!isRecovery), it always targets generation 0,
        //   ensuring concurrent retries deduplicate to a single generation-0 delayed job.
        // - removeOnComplete: true and removeOnFail: true ensure no lingering tombstones block future jobs.
        const isRecoveryJob = Boolean(job.data?.isRecovery);
        const currentGeneration = typeof job.data?.recoveryGeneration === 'number'
          ? job.data.recoveryGeneration
          : 0;
        const nextGeneration = isRecoveryJob ? currentGeneration + 1 : 0;
        const recoveryJobId = `email-recovery-${emailId}-${email.attempts}-${nextGeneration}`;

        const leaseRemainingMs = Math.max(0, EmailWorkerService.LEASE_TIMEOUT_MS - leaseElapsedMs);
        const rawRecoveryDelayMs = leaseRemainingMs + EmailWorkerService.RECOVERY_BUFFER_MS;
        const recoveryDelayMs = Number.isFinite(rawRecoveryDelayMs) && rawRecoveryDelayMs > 0
          ? rawRecoveryDelayMs
          : EmailWorkerService.LEASE_TIMEOUT_MS + EmailWorkerService.RECOVERY_BUFFER_MS;

        try {
          const { emailQueue } = await import('../queues/emailQueue');
          await emailQueue.add(
            'send-email',
            {
              emailId,
              isRecovery: true,
              recoveryGeneration: nextGeneration,
            },
            {
              jobId: recoveryJobId,
              delay: recoveryDelayMs,
              // One-shot recovery probe:
              attempts: 1,
              removeOnComplete: true,
              removeOnFail: true,
            }
          );
          console.log(
            `[EmailWorker] F3 recovery: scheduled delayed recovery job ${recoveryJobId} for email ${emailId} ` +
            `(generation ${nextGeneration}, attempt ${email.attempts}) with delay=${recoveryDelayMs}ms ` +
            `(leaseRemaining=${leaseRemainingMs}ms, buffer=${EmailWorkerService.RECOVERY_BUFFER_MS}ms).`
          );
        } catch (recoveryErr) {
          // Non-fatal: if scheduling fails, log at error level for alerting.
          console.error(
            `[EmailWorker] F3 recovery: FAILED to schedule recovery job ${recoveryJobId} for email ${emailId}:`,
            (recoveryErr as Error).message
          );
        }

        console.log(
          `[EmailWorker] Email ${emailId} is in PROCESSING with an active lease (updatedAt=${email.updatedAt?.toISOString?.() ?? 'unknown'}, attemptsMade=${job.attemptsMade}). Skipping to protect the active worker.`
        );
        return;
      }

      // Lease is expired. The original worker is gone.
      // No dispatch receipt exists (checked above). Cannot prove SMTP was or was not called.
      // Per Rule E & F: Do NOT blindly send again.
      // Atomically transition to FAILED with DLQ_MOVED event to prevent silent stranding.
      const recovered = await prisma.$transaction(async (tx) => {
        const result = await tx.email.updateMany({
          where: {
            id: emailId,
            status: EmailStatus.PROCESSING,
            attempts: email.attempts, // Optimistic concurrency lock
          },
          data: {
            status: EmailStatus.FAILED,
            error: 'Expired lease in PROCESSING state without dispatch receipt. Moved to DLQ to prevent duplicate send.',
          },
        });

        if (result.count !== 1) {
          return false;
        }

        const eventClient = tx.emailEvent || prisma.emailEvent;
        await eventClient.create({
          data: {
            emailId,
            type: EventType.DLQ_MOVED,
            message: `Expired lease in PROCESSING state (Attempt ${email.attempts}, attemptsMade=${job.attemptsMade}). Cannot verify SMTP dispatch status; moved to DLQ.`,
            metadata: {
              jobId: job.id,
              attemptsMade: job.attemptsMade,
              lastUpdatedAt: email.updatedAt,
              reason: 'EXPIRED_LEASE_PROCESSING_CRASH',
            },
          },
        });

        return true;
      });

      if (recovered) {
        console.warn(
          `[EmailWorker] Expired-lease recovery: email ${emailId} transitioned from PROCESSING to FAILED (DLQ). attemptsMade=${job.attemptsMade}.`
        );
      }
      return;
    }

    // 5. ATOMIC WORKER CLAIM (RULE C & F5 CLAIM GUARD)
    // Claim the email atomically so concurrent executions cannot both send it.
    // RESCHEDULED emails are claimable only when scheduledAt <= now.
    const now = new Date();
    const currentAttempt = email.attempts + 1;
    const claimed = await prisma.$transaction(async (tx) => {
      const result = await tx.email.updateMany({
        where: {
          id: emailId,
          OR: [
            {
              status: {
                in: [EmailStatus.SCHEDULED, EmailStatus.QUEUED, EmailStatus.RATE_LIMITED],
              },
            },
            {
              status: EmailStatus.RESCHEDULED,
              scheduledAt: { lte: now },
            },
          ],
        },
        data: {
          status: EmailStatus.PROCESSING,
          attempts: { increment: 1 },
        },
      });

      if (result.count !== 1) {
        return false;
      }

      const eventClient = tx.emailEvent || prisma.emailEvent;
      await eventClient.create({
        data: {
          emailId,
          type: EventType.WORKER_PICKED,
          message: `Worker picked job for dispatch (Attempt ${currentAttempt})`,
          metadata: { jobId: job.id, workerConcurrency: config.workerConcurrency },
        },
      });

      return true;
    });

    if (!claimed) {
      console.log(`[EmailWorker] Email ${emailId} is already claimed or no longer eligible. Skipping.`);
      return;
    }

    // SCOPED PROCESSING HEARTBEAT:
    // Periodically touch email.updatedAt every 15s to keep the lease alive during long-running
    // processing (e.g. rate-limiting, inter-send throttle, slow SMTP dispatch).
    // The heartbeat is strictly scoped to this attempt (status: PROCESSING, attempts: currentAttempt).
    // It is guaranteed to be cleared when processing finishes or errors via try/finally.
    let heartbeatTimer: NodeJS.Timeout | null = null;
    try {
      heartbeatTimer = setInterval(async () => {
        try {
          const res = await prisma.email.updateMany({
            where: {
              id: emailId,
              status: EmailStatus.PROCESSING,
              attempts: currentAttempt,
            },
            data: {
              updatedAt: new Date(),
            },
          });
          if (res.count === 0 && heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
          }
        } catch (hbErr) {
          console.warn(
            `[EmailWorker] Heartbeat update failed for email ${emailId}:`,
            (hbErr as Error).message
          );
        }
      }, EmailWorkerService.HEARTBEAT_INTERVAL_MS);

      if (heartbeatTimer && typeof heartbeatTimer.unref === 'function') {
        heartbeatTimer.unref();
      }

    const isThrottledJob = Boolean(job.data?.isThrottled && job.data?.reservedStartMs);
    let rateCheckWindowKey: string | undefined;

    // 5. ATOMIC RATE LIMIT CHECK (Redis Lua check-and-increment)
    // Waking throttled jobs bypass hourly quota check because quota was already incremented in attempt 1
    if (!isThrottledJob) {
      const effectiveHourlyLimit = Math.min(
        email.sender?.hourlyLimit ?? config.defaultMaxEmailsPerHour,
        email.campaign?.hourlyLimit ?? email.sender?.hourlyLimit ?? config.defaultMaxEmailsPerHour
      );
      const rateCheck = await rateLimiterService.checkAndIncrement(email.senderId, effectiveHourlyLimit);
      rateCheckWindowKey = rateCheck.windowKey;

      if (!rateCheck.allowed) {
        console.log(
          `[EmailWorker] Rate limit reached for sender ${email.sender.email} (${rateCheck.currentCount}/${effectiveHourlyLimit}). Rescheduling email ${emailId}.`
        );

        // Trigger deduplicated Slack alert via Redis SET-NX (F4 FIX: fully non-blocking).
        // Any Slack/Redis/DB error is caught and logged. The critical rescheduling path
        // (PostgreSQL RESCHEDULED update + BullMQ delayed enqueue) must always execute,
        // regardless of notification infrastructure availability.
        Promise.resolve()
          .then(() =>
            slackService.sendDeduplicatedRateLimitAlert(email.userId, email.senderId, {
              senderEmail: email.sender.email,
              senderName: email.sender.name,
              hourlyLimit: effectiveHourlyLimit,
              currentCount: rateCheck.currentCount,
              windowKey: rateCheck.windowKey,
              nextWindowTime: new Date(rateCheck.resetTimeMs).toISOString(),
              campaignName: email.campaign.name,
            })
          )
          .catch((slackErr: unknown) => {
            console.warn(
              `[EmailWorker] Slack rate-limit notification failed for sender ${email.sender.email} (non-fatal, rescheduling continues):`,
              (slackErr as Error).message
            );
          });

        // Calculate exact delay to next window
        const nowMs = Date.now();
        const delayUntilNextWindow = Math.max(1000, rateCheck.resetTimeMs - nowMs + Math.floor(Math.random() * 2000));
        const nextScheduledAt = new Date(nowMs + delayUntilNextWindow);

        // F5 ENQUEUE-FIRST RESCHEDULING:
        // 1. Enqueue deterministic BullMQ delayed job in Redis BEFORE updating PostgreSQL.
        // 2. Use bounded local retry (3 attempts, short backoff).
        // 3. If enqueue fails after retries, throw so email is NOT marked RESCHEDULED in DB;
        //    existing retry/recovery mechanics will safely handle the active lease / PROCESSING state.
        // 4. Once BullMQ enqueue succeeds, update PostgreSQL status to RESCHEDULED.
        // 5. If PostgreSQL update fails after enqueue, the delayed job safely remains in Redis;
        //    when it fires, the worker verifies DB state before dispatching.
        const { emailQueue } = await import('../queues/emailQueue');
        const reschedJobId = `email-send-${email.id}-resched-${rateCheck.resetTimeMs}`;

        const maxEnqueueAttempts = 3;
        let enqueueSuccess = false;
        let lastEnqueueError: unknown;

        for (let attempt = 1; attempt <= maxEnqueueAttempts; attempt++) {
          try {
            await emailQueue.add(
              'send-email',
              { emailId: email.id, isRescheduled: true },
              {
                jobId: reschedJobId,
                delay: delayUntilNextWindow,
              }
            );
            enqueueSuccess = true;
            break;
          } catch (enqueueErr) {
            lastEnqueueError = enqueueErr;
            console.warn(
              `[EmailWorker] F5 rescheduling: emailQueue.add attempt ${attempt}/${maxEnqueueAttempts} failed for email ${emailId}:`,
              (enqueueErr as Error).message
            );
            if (attempt < maxEnqueueAttempts) {
              await new Promise((resolve) => setTimeout(resolve, attempt * 100));
            }
          }
        }

        if (!enqueueSuccess) {
          console.error(
            `[EmailWorker] F5 rescheduling: FAILED to enqueue delayed job for email ${emailId} after ${maxEnqueueAttempts} attempts. Aborting RESCHEDULED DB update:`,
            (lastEnqueueError as Error)?.message
          );
          throw lastEnqueueError;
        }

        // Step 2: Only after BullMQ delayed job is securely in Redis, commit RESCHEDULED in PostgreSQL
        await prisma.$transaction([
          prisma.email.update({
            where: { id: emailId },
            data: {
              status: EmailStatus.RESCHEDULED,
              scheduledAt: nextScheduledAt,
            },
          }),
          prisma.emailEvent.create({
            data: {
              emailId,
              type: EventType.RATE_LIMIT_EXCEEDED,
              message: `Hourly limit reached (${rateCheck.currentCount}/${effectiveHourlyLimit}). Rescheduled to next hour window.`,
              metadata: {
                windowKey: rateCheck.windowKey,
                resetTimeMs: rateCheck.resetTimeMs,
                delayUntilNextWindow,
              },
            },
          }),
        ]);

        return;
      }
    } else {
      rateCheckWindowKey = RateLimiterService.getHourlyWindowKey().windowKey;
    }

    // 6. PER-SENDER INTER-SEND THROTTLING: Reserve start slot across concurrent workers
    if (isThrottledJob) {
      // Waking throttled job: slot was ALREADY reserved on the Redis timeline at job.data.reservedStartMs.
      // Small jitter guard if BullMQ worker picked the job slightly early (< 1000ms):
      const jitterWaitMs = Math.max(0, (job.data.reservedStartMs || 0) - Date.now());
      if (jitterWaitMs > 0 && jitterWaitMs <= 1000) {
        await new Promise((resolve) => setTimeout(resolve, jitterWaitMs));
      }
    } else {
      const delayMs = email.campaign.delayMs || config.defaultMinEmailDelayMs;
      const { scheduledTime, waitMs } = typeof rateLimiterService.allocateSendSlot === 'function'
        ? await rateLimiterService.allocateSendSlot(email.senderId, delayMs)
        : { scheduledTime: await rateLimiterService.reserveSendSlot(email.senderId, delayMs), waitMs: 0 };

      // HYBRID THROTTLE POLICY:
      // If waitMs > 1000ms: enqueue a deterministic delayed BullMQ job and mark email RESCHEDULED
      // so the worker concurrency slot is instantly freed and F3 recovery cannot DLQ it.
      if (waitMs > 1000) {
        const throttleJobId = `email-send-${email.id}-throttle-${scheduledTime}`;
        const nextScheduledAt = new Date(scheduledTime);

        const { emailQueue } = await import('../queues/emailQueue');
        const maxEnqueueAttempts = 3;
        let enqueueSuccess = false;
        let lastEnqueueError: unknown;

        for (let attempt = 1; attempt <= maxEnqueueAttempts; attempt++) {
          try {
            await emailQueue.add(
              'send-email',
              {
                emailId: email.id,
                isThrottled: true,
                reservedStartMs: scheduledTime,
              },
              {
                jobId: throttleJobId,
                delay: waitMs,
              }
            );
            enqueueSuccess = true;
            break;
          } catch (enqueueErr) {
            lastEnqueueError = enqueueErr;
            console.warn(
              `[EmailWorker] Throttle rescheduling: emailQueue.add attempt ${attempt}/${maxEnqueueAttempts} failed for email ${emailId}:`,
              (enqueueErr as Error).message
            );
            if (attempt < maxEnqueueAttempts) {
              await new Promise((resolve) => setTimeout(resolve, attempt * 100));
            }
          }
        }

        if (!enqueueSuccess) {
          console.error(
            `[EmailWorker] Throttle rescheduling: FAILED to enqueue delayed job for email ${emailId} after ${maxEnqueueAttempts} attempts. Aborting RESCHEDULED DB update:`,
            (lastEnqueueError as Error)?.message
          );
          throw lastEnqueueError;
        }

        // Atomically mark RESCHEDULED in PostgreSQL before returning so F3 recovery cannot DLQ it
        await prisma.$transaction([
          prisma.email.update({
            where: { id: emailId },
            data: {
              status: EmailStatus.RESCHEDULED,
              scheduledAt: nextScheduledAt,
              jobId: throttleJobId,
            },
          }),
          prisma.emailEvent.create({
            data: {
              emailId,
              type: EventType.PROVIDER_DELAY_APPLIED,
              message: `Enforced minimum inter-send interval (${delayMs}ms) for sender ${email.sender.email}. Rescheduled via BullMQ delayed queue (${waitMs}ms delay).`,
              metadata: {
                delayMs,
                reservedStartMs: scheduledTime,
                waitMs,
                throttleJobId,
              },
            },
          }),
        ]);

        return;
      }

      // Micro-wait (waitMs <= 1000ms): in-worker wait without queue overhead
      await prisma.emailEvent.create({
        data: {
          emailId,
          type: EventType.PROVIDER_DELAY_APPLIED,
          message: `Enforced minimum inter-send interval (${delayMs}ms) for sender ${email.sender.email}`,
          metadata: { delayMs, reservedStartMs: scheduledTime },
        },
      });

      if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }

    // 7. STAGE B: SMTP DISPATCH (Isolated error boundary with F7 ambiguity protection)
    // F7.1: Deterministic Message-ID based on email.id passed to Nodemailer
    const senderDomain = email.sender.email.includes('@')
      ? email.sender.email.split('@')[1]
      : 'reachflow.io';
    const deterministicMessageId = `<reachflow-${email.id}@${senderDomain}>`;

    // F7.2: Track whether the SMTP attempt has entered the transmission/send phase
    let transmissionStarted = false;
    let sendResult: SendMailResult;
    try {
      sendResult = await etherealService.sendEmail({
        fromName: email.sender.name,
        fromEmail: email.sender.email,
        etherealUser: email.sender.etherealUser,
        etherealPass: email.sender.etherealPass,
        to: email.recipient,
        subject: email.subject,
        text: email.body,
        html: `<div style="font-family: sans-serif; padding: 20px; line-height: 1.6;">${email.body.replace(
          /\n/g,
          '<br/>'
        )}</div>`,
        messageId: deterministicMessageId,
        onTransmissionStart: () => {
          transmissionStarted = true;
        },
      });
    } catch (smtpError) {
      console.error(`[EmailWorker] SMTP delivery error for email ${emailId}:`, (smtpError as Error).message);

      const isAmbiguous = this.isAmbiguousSmtpError(smtpError, transmissionStarted);

      if (isAmbiguous) {
        console.warn(
          `[EmailWorker] Ambiguous SMTP failure for email ${emailId} after transmission began. ` +
            `Delivery outcome is unknown; suppressing automatic retry to prevent duplicate send.`
        );

        // F7 QUOTA INVARIANT:
        // Do NOT compensate quota for ambiguous SMTP attempts. The message may have been accepted
        // and delivered by the remote MTA. Compensating quota could allow the sender to exceed their
        // actual mail provider hourly limit if the email was in fact delivered.

        await prisma.$transaction([
          prisma.email.update({
            where: { id: emailId },
            data: {
              status: EmailStatus.FAILED,
              messageId: deterministicMessageId,
              error: `SMTP delivery outcome ambiguous: ${(smtpError as Error).message}. Automatic retry suppressed to prevent duplicate delivery.`,
            },
          }),
          prisma.emailEvent.create({
            data: {
              emailId,
              type: EventType.DLQ_MOVED,
              message: `SMTP delivery outcome unknown after transmission began: ${(smtpError as Error).message}. Automatic retry suppressed to prevent duplicate delivery.`,
              metadata: {
                error: (smtpError as Error).message,
                deterministicMessageId,
                attemptsMade: job.attemptsMade + 1,
                ambiguous: true,
                retrySuppressed: true,
              },
            },
          }),
        ]);

        // Suppress automatic retry: do not rethrow to BullMQ. Return to mark job complete
        // while email record remains permanently FAILED in DLQ.
        return;
      }

      // Clear pre-send / provider failure:
      // F1 QUOTA COMPENSATION:
      // Compensate ONLY the quota reservation made by the current attempt using the exact windowKey
      // returned by checkAndIncrement. SMTP was definitively not accepted, so this attempt must not burn quota.
      try {
        if (rateCheckWindowKey) {
          await rateLimiterService.compensate(email.senderId, rateCheckWindowKey);
        }
      } catch (compErr) {
        console.warn(
          `[EmailWorker] Failed to compensate rate-limit quota for email ${emailId}:`,
          (compErr as Error).message
        );
      }

      const isFinalAttempt = job.attemptsMade >= (job.opts.attempts || 3) - 1;

      await prisma.$transaction([
        prisma.email.update({
          where: { id: emailId },
          data: {
            status: isFinalAttempt ? EmailStatus.FAILED : EmailStatus.SCHEDULED,
            error: (smtpError as Error).message,
          },
        }),
        prisma.emailEvent.create({
          data: {
            emailId,
            type: isFinalAttempt ? EventType.DLQ_MOVED : EventType.FAILED_ATTEMPT,
            message: `SMTP attempt ${job.attemptsMade + 1} failed: ${(smtpError as Error).message}`,
            metadata: { error: (smtpError as Error).message, attemptsMade: job.attemptsMade + 1 },
          },
        }),
      ]);

      throw smtpError; // Rethrow to trigger BullMQ exponential backoff retry
    }

    // 8. STAGE C: PERSIST DISPATCH RECEIPT IN REDIS
    // SMTP has accepted the message. Persist receipt BEFORE attempting DB commit so any
    // subsequent DB failure or retry knows SMTP already succeeded.
    const receipt: DispatchReceipt = {
      messageId: sendResult.messageId || deterministicMessageId,
      previewUrl: sendResult.previewUrl || false,
      sentAt: new Date().toISOString(),
    };
    const authoritativeReceipt = await this.saveDispatchReceipt(emailId, receipt);

    // 9. STAGE D: POSTGRESQL FINALIZATION (With bounded local retry)
    // If this fails, the error is NOT an SMTP failure. The dispatch receipt in Redis
    // guarantees that future BullMQ retries will skip SMTP dispatch and re-attempt DB finalization.
    try {
      await this.finalizeSentStatus(emailId, email.campaignId, authoritativeReceipt || receipt);
    } catch (dbError) {
      if (!authoritativeReceipt) {
        // CATASTROPHIC DUAL FAILURE: SMTP accepted message, but Redis receipt persistence failed persistently
        // AND PostgreSQL SENT finalization failed. Transition to FAILED/DLQ to prevent duplicate send.
        console.error(
          `[EmailWorker] CATASTROPHIC DUAL FAILURE: Email ${emailId} delivered to SMTP (Message-ID: ${receipt.messageId}), but BOTH Redis receipt persistence AND PostgreSQL finalization failed. Transitioning to FAILED (DLQ) to prevent duplicate send.`
        );
        // Atomic guard: only transition to FAILED if the row is still in PROCESSING.
        // If finalizeSentStatus() committed SENT before its client connection was lost,
        // the status will already be SENT here and updateMany will return count=0 — leave it alone.
        // The $transaction itself may also fail if DB is fully unavailable; fall back to best-effort
        // direct calls in that case so this handler never throws to the BullMQ caller.
        try {
          const dlqResult = await prisma.$transaction(async (tx) => {
            const result = await tx.email.updateMany({
              where: {
                id: emailId,
                status: EmailStatus.PROCESSING, // Guard: do not overwrite an already-SENT row
              },
              data: {
                status: EmailStatus.FAILED,
                messageId: receipt.messageId,
                error: `Dual failure: SMTP delivered (${receipt.messageId}) but Redis receipt and DB finalization failed: ${(dbError as Error).message}`,
              },
            });

            if (result.count !== 1) {
              // Row is no longer PROCESSING — finalizeSentStatus likely committed SENT.
              // Do NOT create DLQ_MOVED; leave the successful SENT state intact.
              return false;
            }

            await tx.emailEvent.create({
              data: {
                emailId,
                type: EventType.DLQ_MOVED,
                message: `Dual failure: SMTP accepted (${receipt.messageId}) but receipt persistence and DB finalization failed. Moved to DLQ to prevent duplicate send.`,
                metadata: { messageId: receipt.messageId, error: (dbError as Error).message },
              },
            });

            return true;
          });

          if (!dlqResult) {
            console.warn(
              `[EmailWorker] Dual-failure handler: email ${emailId} was NOT in PROCESSING state — finalizeSentStatus likely already committed SENT. Leaving state intact.`
            );
          }
        } catch (dlqTxError) {
          // The transaction itself failed (DB completely unavailable).
          // Best-effort: attempt non-transactional writes individually so we still record the DLQ transition.
          console.error(
            `[EmailWorker] Dual-failure DLQ transaction failed for ${emailId}; attempting non-transactional fallback:`,
            (dlqTxError as Error).message
          );
          try {
            const fallbackResult = await prisma.email.updateMany({
              where: { id: emailId, status: EmailStatus.PROCESSING },
              data: {
                status: EmailStatus.FAILED,
                messageId: receipt.messageId,
                error: `Dual failure: SMTP delivered (${receipt.messageId}) but Redis receipt and DB finalization failed: ${(dbError as Error).message}`,
              },
            });
            if (fallbackResult.count === 1) {
              await prisma.emailEvent.create({
                data: {
                  emailId,
                  type: EventType.DLQ_MOVED,
                  message: `Dual failure: SMTP accepted (${receipt.messageId}) but receipt persistence and DB finalization failed. Moved to DLQ to prevent duplicate send.`,
                  metadata: { messageId: receipt.messageId, error: (dbError as Error).message },
                },
              });
            } else {
              console.warn(
                `[EmailWorker] Dual-failure fallback: email ${emailId} was NOT in PROCESSING state — likely already SENT. Leaving state intact.`
              );
            }
          } catch (fallbackError) {
            // DB is completely unresponsive. Log and return; BullMQ will retry the outer job.
            console.error(
              `[EmailWorker] Dual-failure fallback also failed for ${emailId}. Email may remain stuck in PROCESSING; manual intervention required.`,
              (fallbackError as Error).message
            );
          }
        }
        return;
      }

      console.error(
        `[EmailWorker] PostgreSQL SENT finalization failed for email ${emailId} after SMTP success. Dispatch receipt is safely preserved in Redis. Error:`,
        (dbError as Error).message
      );
      throw dbError; // Bubble to BullMQ for outer backoff retry without resetting status to SCHEDULED
    }
  } finally {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }
}

  public async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }
}

export const emailWorkerService = new EmailWorkerService();
