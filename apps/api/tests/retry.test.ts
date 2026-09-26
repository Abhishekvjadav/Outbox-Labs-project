import { emailQueue } from '../src/queues/emailQueue';
import { redisClient } from '../src/queues/redis';

describe('BullMQ Exponential Backoff and Retry Invariant', () => {
  const emailId = `retry-test-${Date.now()}`;
  const jobId = `email-send-${emailId}`;

  afterAll(async () => {
    try {
      const job = await emailQueue.getJob(jobId);
      if (job) await job.remove();
      await emailQueue.close();
      await redisClient.quit();
    } catch (e) {}
  });

  it('configures exponential backoff retry metadata correctly on jobs', async () => {
    const job = await emailQueue.add(
      'send-email',
      { emailId },
      {
        jobId,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
      }
    );

    expect(job.opts.attempts).toBe(3);
    expect(job.opts.backoff).toEqual({
      type: 'exponential',
      delay: 5000,
    });
  });
});
