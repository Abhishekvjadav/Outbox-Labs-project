import { Queue } from 'bullmq';
import { redisConnectionOptions } from './redis';

export const EMAIL_QUEUE_NAME = 'reachflow-email-queue';
export const ES_INDEX_QUEUE_NAME = 'reachflow-es-index-queue';

export interface EmailJobData {
  emailId: string;
  isRescheduled?: boolean;
  isRecovery?: boolean;
  recoveryGeneration?: number;
  isThrottled?: boolean;
  reservedStartMs?: number;
}

export interface EsIndexJobData {
  emailId: string;
  action: 'index' | 'update';
}

export const emailQueue = new Queue<EmailJobData>(EMAIL_QUEUE_NAME, {
  connection: redisConnectionOptions,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: false, // Keep completed jobs visible for Bull Board inspection
    removeOnFail: false,     // Keep failed jobs visible for DLQ inspection
  },
});

export const esIndexQueue = new Queue<EsIndexJobData>(ES_INDEX_QUEUE_NAME, {
  connection: redisConnectionOptions,
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: true,
    removeOnFail: false,
  },
});
