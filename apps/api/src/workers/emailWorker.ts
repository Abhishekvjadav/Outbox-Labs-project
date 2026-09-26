import { Worker, Job } from 'bullmq';
import { EMAIL_QUEUE_NAME, EmailJobData, esIndexQueue } from '../queues/emailQueue';
import { redisConnectionOptions } from '../queues/redis';
import { prisma } from '../prisma/client';
import { rateLimiterService } from '../services/rateLimiter';
import { etherealService } from '../services/ethereal';
import { slackService } from '../services/slack';
import { config } from '../config/env';
import { EmailStatus, EventType } from '@reachflow/shared';

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

    // 4. ATOMIC RATE LIMIT CHECK (Redis Lua check-and-increment)
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

    // 5. PER-SENDER INTER-SEND THROTTLING: Reserve start slot across concurrent workers
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

    // 6. DISPATCH VIA ETHEREAL SMTP
    try {
      const sendResult = await etherealService.sendEmail({
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

      const sentAt = new Date();

      // 7. COMMIT SUCCESS STATE TO POSTGRESQL (Source of Truth)
      await prisma.$transaction([
        prisma.email.update({
          where: { id: emailId },
          data: {
            status: EmailStatus.SENT,
            sentAt,
            messageId: sendResult.messageId,
            previewUrl: sendResult.previewUrl || null,
          },
        }),
        prisma.campaign.update({
          where: { id: email.campaignId },
          data: {
            sentEmails: { increment: 1 },
          },
        }),
        prisma.emailEvent.create({
          data: {
            emailId,
            type: EventType.SMTP_DELIVERED,
            message: `Email successfully delivered to SMTP server. Message-ID: ${sendResult.messageId}`,
            metadata: {
              messageId: sendResult.messageId,
              previewUrl: sendResult.previewUrl,
            },
          },
        }),
      ]);

      console.log(`[EmailWorker] Email ${emailId} successfully sent to ${email.recipient}`);
      if (sendResult.previewUrl) {
        console.log(`[EmailWorker] Preview URL: ${sendResult.previewUrl}`);
      }

      // 8. ASYNC DECOUPLED ELASTICSEARCH INDEXING (Isolated search projection)
      try {
        await esIndexQueue.add(
          'index-email',
          { emailId: email.id, action: 'update' },
          { jobId: `es-index-${email.id}` }
        );
      } catch (queueErr) {
        console.warn('[EmailWorker] Could not queue ES indexing:', (queueErr as Error).message);
      }
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
  }

  public async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }
}

export const emailWorkerService = new EmailWorkerService();
