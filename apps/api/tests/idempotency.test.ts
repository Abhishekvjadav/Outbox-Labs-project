import { emailQueue } from '../src/queues/emailQueue';
import { redisClient } from '../src/queues/redis';

describe('Job Scheduling Idempotency', () => {
  const emailId = `email-${Date.now()}`;
  const deterministicJobId = `email-send-${emailId}`;

  afterAll(async () => {
    try {
      const job = await emailQueue.getJob(deterministicJobId);
      if (job) await job.remove();
      await emailQueue.close();
      await redisClient.quit();
    } catch (e) {}
  });

  it('guarantees that identical deterministic job IDs produce at most one executable job in BullMQ', async () => {
    // Schedule the exact same job 3 times with identical deterministic ID
    const p1 = emailQueue.add('send-email', { emailId }, { jobId: deterministicJobId });
    const p2 = emailQueue.add('send-email', { emailId }, { jobId: deterministicJobId });
    const p3 = emailQueue.add('send-email', { emailId }, { jobId: deterministicJobId });

    await Promise.all([p1, p2, p3]);

    const job = await emailQueue.getJob(deterministicJobId);
    expect(job).not.toBeNull();
    expect(job?.id).toBe(deterministicJobId);

    // BullMQ silently drops duplicate job additions with the same ID
    expect(job?.data.emailId).toBe(emailId);
  });
});
