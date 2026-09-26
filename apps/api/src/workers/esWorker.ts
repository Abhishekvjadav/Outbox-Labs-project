import { Worker, Job } from 'bullmq';
import { ES_INDEX_QUEUE_NAME, EsIndexJobData } from '../queues/emailQueue';
import { redisConnectionOptions } from '../queues/redis';
import { prisma } from '../prisma/client';
import { elasticsearchService } from '../services/elasticsearch';
import { EventType } from '@reachflow/shared';

export class EsWorkerService {
  private worker: Worker<EsIndexJobData> | null = null;

  public start(): Worker<EsIndexJobData> {
    if (this.worker) {
      return this.worker;
    }

    this.worker = new Worker<EsIndexJobData>(
      ES_INDEX_QUEUE_NAME,
      async (job: Job<EsIndexJobData>) => {
        const { emailId } = job.data;
        await this.processIndexJob(emailId);
      },
      {
        connection: redisConnectionOptions,
        concurrency: 2,
      }
    );

    this.worker.on('failed', (job, err) => {
      console.warn(`[EsWorker] Indexing job ${job?.id} failed:`, err.message);
    });

    return this.worker;
  }

  private async processIndexJob(emailId: string): Promise<void> {
    const email = await prisma.email.findUnique({
      where: { id: emailId },
      include: { sender: true },
    });

    if (!email) return;

    try {
      await elasticsearchService.indexEmail({
        id: email.id,
        userId: email.userId,
        campaignId: email.campaignId,
        senderId: email.senderId,
        senderEmail: email.sender.email,
        recipient: email.recipient,
        subject: email.subject,
        body: email.body,
        status: email.status,
        scheduledAt: email.scheduledAt,
        sentAt: email.sentAt,
      });

      // Log audit event for search sync
      await prisma.emailEvent.create({
        data: {
          emailId,
          type: EventType.INDEXED_SEARCH,
          message: 'Document successfully synced to Elasticsearch index',
        },
      });
    } catch (err) {
      // Re-throw so BullMQ retries in background
      throw err;
    }
  }

  public async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }
}

export const esWorkerService = new EsWorkerService();
