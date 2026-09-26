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

export class EmailWorkerService {
  private worker: Worker<EmailJobData> | null = null;

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

  private async saveDispatchReceipt(emailId: string, receipt: DispatchReceipt): Promise<DispatchReceipt> {
    const key = this.getReceiptKey(emailId);
    try {
      if (!redisClient || typeof redisClient.set !== 'function') {
        return receipt;
      }
      // Use NX to guarantee atomic write without overwriting existing authoritative receipt
      const res = await redisClient.set(key, JSON.stringify(receipt), 'EX', DISPATCH_RECEIPT_TTL_SECONDS, 'NX');
      if (res === 'OK') {
        return receipt;
      }
      // If NX returned null/not OK, a receipt was already recorded; read and treat as authoritative
      const existingRaw = await redisClient.get(key);
      if (existingRaw) {
        return JSON.parse(existingRaw) as DispatchReceipt;
      }
    } catch (err) {
      console.error(`[EmailWorker] Failed to record dispatch receipt for ${emailId}:`, (err as Error).message);
    }
    return receipt;
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
        await prisma.$transaction([
          prisma.email.update({
            where: { id: emailId },
            data: {
              status: EmailStatus.SENT,
              sentAt: new Date(receipt.sentAt),
              messageId: receipt.messageId,
              previewUrl: receipt.previewUrl ? receipt.previewUrl : null,
            },
          }),
          prisma.campaign.update({
            where: { id: campaignId },
            data: {
              sentEmails: { increment: 1 },
            },
          }),
          prisma.emailEvent.create({
            data: {
              emailId,
              type: EventType.SMTP_DELIVERED,
              message: `Email successfully delivered to SMTP server. Message-ID: ${receipt.messageId}`,
              metadata: {
                messageId: receipt.messageId,
                previewUrl: receipt.previewUrl || null,
              },
            },
          }),
        ]);

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

    // 2. IDEMPOTENCY CHECK: If already sent, exit safely without duplicate dispatch
    if (email.status === EmailStatus.SENT) {
      console.log(`[EmailWorker] Email ${emailId} is already marked as SENT. Skipping duplicate execution.`);
      return;
    }

    // 3. DISPATCH RECEIPT CHECK: If already accepted by SMTP in a prior attempt where DB commit failed,
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

    // 4. ATOMIC WORKER CLAIM
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

      await tx.emailEvent.create({
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
      await this.finalizeSentStatus(emailId, email.campaignId, authoritativeReceipt);
    } catch (dbError) {
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
