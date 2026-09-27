import { emailQueue } from '../src/queues/emailQueue';
import { redisClient } from '../src/queues/redis';

describe('Server Restart & Redis Persistence Invariant', () => {
  const emailId = `restart-test-${Date.now()}`;
  const jobId = `email-send-${emailId}`;
  const futureDelayMs = 10000; // 10 seconds in future

  afterAll(async () => {
    try {
      const job = await emailQueue.getJob(jobId);
      if (job) await job.remove();
      await emailQueue.close();
      await redisClient.quit();
    } catch (e) {}
  });

  it('preserves future delayed jobs in Redis even if the application server shuts down', async () => {
    // 1. Enqueue delayed job
    await emailQueue.add('send-email', { emailId }, { jobId, delay: futureDelayMs });

    // 2. Verify job is currently in BullMQ "delayed" state
    let job = await emailQueue.getJob(jobId);
    expect(job).not.toBeNull();
    let state = await job?.getState();
    expect(state).toBe('delayed');

    // 3. Simulate server shutdown (closing queue connection)
    await emailQueue.close();

    // 4. Simulate server restart (re-instantiating queue)
    const { Queue } = await import('bullmq');
    const { EMAIL_QUEUE_NAME } = await import('../src/queues/emailQueue');
    const { redisConnectionOptions } = await import('../src/queues/redis');

    const recoveredQueue = new Queue(EMAIL_QUEUE_NAME, { connection: redisConnectionOptions });
    const recoveredJob = await recoveredQueue.getJob(jobId);

    // Assert: Job was NOT lost during shutdown/restart
    expect(recoveredJob).not.toBeNull();
    expect(recoveredJob?.id).toBe(jobId);
    const recoveredState = await recoveredJob?.getState();
    expect(recoveredState).toBe('delayed');

    await recoveredJob?.remove();
    await recoveredQueue.close();
  });
});
