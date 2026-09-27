import { Worker, Job } from 'bullmq';
import { EMAIL_QUEUE_NAME, EmailJobData, esIndexQueue } from '../queues/emailQueue';
import { redisClient, redisConnectionOptions } from '../queues/redis';
import { prisma } from '../prisma/client';
import { rateLimiterService } from '../services/rateLimiter';
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
    if (email.status === EmailStatus.PROCESSING) {
      const isLeaseExpired = Date.now() - new Date(email.updatedAt).getTime() >= EmailWorkerService.LEASE_TIMEOUT_MS;
      const isRetry = job.attemptsMade > 0;

      if (!isLeaseExpired && !isRetry) {
        // Active peer worker is currently processing this job
        console.log(`[EmailWorker] Email ${emailId} is actively being processed by another worker (lease active). Skipping.`);
        return;
      }

      // Abandoned worker detected in PROCESSING state without dispatch receipt.
      // Per Rule E & F: Do NOT blindly send again (cannot prove SMTP was not called).
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
            error: 'Ambiguous worker crash during PROCESSING state without dispatch receipt. Moved to DLQ to prevent duplicate send.',
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
            message: `Ambiguous crash in PROCESSING state (Attempt ${email.attempts}). Cannot verify SMTP dispatch status; moved to DLQ.`,
            metadata: {
              jobId: job.id,
              attemptsMade: job.attemptsMade,
              lastUpdatedAt: email.updatedAt,
              reason: 'AMBIGUOUS_PROCESSING_CRASH',
            },
          },
        });

        return true;
      });

      if (recovered) {
        console.warn(
          `[EmailWorker] Recovered abandoned email ${emailId} from PROCESSING state. Marked as FAILED (DLQ) to prevent duplicate delivery.`
        );
      }
      return;
    }

    // 5. ATOMIC WORKER CLAIM (RULE C)
    // Claim the email atomically so concurrent executions cannot both send it.
    const claimed = await prisma.$transaction(async (tx) => {
      const result = await tx.email.updateMany({
        where: {
          id: emailId,
          status: {
            in: [EmailStatus.SCHEDULED, EmailStatus.QUEUED, EmailStatus.RATE_LIMITED, EmailStatus.RESCHEDULED],
          },
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
          message: `Worker picked job for dispatch (Attempt ${email.attempts + 1})`,
          metadata: { jobId: job.id, workerConcurrency: config.workerConcurrency },
        },
      });

      return true;
    });

    if (!claimed) {
      console.log(`[EmailWorker] Email ${emailId} is already claimed or no longer eligible. Skipping.`);
      return;
    }

    // 5. ATOMIC RATE LIMIT CHECK (Redis Lua check-and-increment)
    const hourlyLimit = email.sender.hourlyLimit || config.defaultMaxEmailsPerHour;
    const rateCheck = await rateLimiterService.checkAndIncrement(email.senderId, hourlyLimit);

    if (!rateCheck.allowed) {
      console.log(
        `[EmailWorker] Rate limit reached for sender ${email.sender.email} (${rateCheck.currentCount}/${hourlyLimit}). Rescheduling email ${emailId}.`
      );

      // Trigger deduplicated Slack alert via Redis SET-NX
      await slackService.sendDeduplicatedRateLimitAlert(email.userId, email.senderId, {
        senderEmail: email.sender.email,
        senderName: email.sender.name,
        hourlyLimit,
        currentCount: rateCheck.currentCount,
        windowKey: rateCheck.windowKey,
        nextWindowTime: new Date(rateCheck.resetTimeMs).toISOString(),
        campaignName: email.campaign.name,
      });

      // Calculate exact delay to next window
      const nowMs = Date.now();
      const delayUntilNextWindow = Math.max(1000, rateCheck.resetTimeMs - nowMs + Math.floor(Math.random() * 2000));
      const nextScheduledAt = new Date(nowMs + delayUntilNextWindow);

      // Update DB to RESCHEDULED with audit event
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
            message: `Hourly limit reached (${rateCheck.currentCount}/${hourlyLimit}). Rescheduled to next hour window.`,
            metadata: {
              windowKey: rateCheck.windowKey,
              resetTimeMs: rateCheck.resetTimeMs,
              delayUntilNextWindow,
            },
          },
        }),
      ]);

      // Maintain Single Active Job Invariant: Re-enqueue delayed job for next window
      const { emailQueue } = await import('../queues/emailQueue');
      await emailQueue.add(
        'send-email',
        { emailId: email.id, isRescheduled: true },
        {
          jobId: `email-send-${email.id}-resched-${rateCheck.resetTimeMs}`,
          delay: delayUntilNextWindow,
        }
      );

      return;
    }

    // 6. PER-SENDER INTER-SEND THROTTLING: Reserve start slot across concurrent workers
    const delayMs = email.campaign.delayMs || config.defaultMinEmailDelayMs;
    const reservedStartMs = await rateLimiterService.reserveSendSlot(email.senderId, delayMs);

    await prisma.emailEvent.create({
      data: {
        emailId,
        type: EventType.PROVIDER_DELAY_APPLIED,
        message: `Enforced minimum inter-send interval (${delayMs}ms) for sender ${email.sender.email}`,
        metadata: { delayMs, reservedStartMs },
      },
    });

    // 7. STAGE B: SMTP DISPATCH (Isolated error boundary)
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
      });
    } catch (smtpError) {
      console.error(`[EmailWorker] SMTP delivery error for email ${emailId}:`, (smtpError as Error).message);

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
      messageId: sendResult.messageId,
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
  }

  public async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }
}

export const emailWorkerService = new EmailWorkerService();
