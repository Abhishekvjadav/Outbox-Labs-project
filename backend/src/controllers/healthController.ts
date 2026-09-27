import { Request, Response } from 'express';
import { prisma } from '../prisma/client';
import { redisClient } from '../queues/redis';
import { emailQueue } from '../queues/emailQueue';
import { elasticsearchService } from '../services/elasticsearch';
import { config } from '../config/env';
import { SystemHealthDTO } from '@reachflow/shared';

export class HealthController {
  public static async getHealth(req: Request, res: Response) {
    const startTime = Date.now();

    // 1. Check PostgreSQL
    let pgStatus: 'healthy' | 'unhealthy' = 'healthy';
    let pgLatency = 0;
    let pgError: string | undefined;
    try {
      const pgStart = Date.now();
      await prisma.$queryRaw`SELECT 1`;
      pgLatency = Date.now() - pgStart;
    } catch (e) {
      pgStatus = 'unhealthy';
      pgError = (e as Error).message;
    }

    // 2. Check Redis
    let redisStatus: 'healthy' | 'unhealthy' = 'healthy';
    let redisLatency = 0;
    let redisError: string | undefined;
    try {
      const rStart = Date.now();
      await redisClient.ping();
      redisLatency = Date.now() - rStart;
    } catch (e) {
      redisStatus = 'unhealthy';
      redisError = (e as Error).message;
    }

    // 3. Check BullMQ Worker & Queue Metrics
    let activeJobs = 0;
    let delayedJobs = 0;
    let waitingJobs = 0;
    let completedJobs = 0;
    let failedJobs = 0;
    try {
      const counts = await emailQueue.getJobCounts('active', 'delayed', 'waiting', 'completed', 'failed');
      activeJobs = counts.active;
      delayedJobs = counts.delayed;
      waitingJobs = counts.waiting;
      completedJobs = counts.completed;
      failedJobs = counts.failed;
    } catch (e) {
      // Redis might be disconnected
    }

    // 4. Check Elasticsearch
    const esState = elasticsearchService.getStatus();

    // 5. Check Slack connection if user authenticated
    let isSlackConnected = false;
    if (req.user?.id) {
      const slack = await prisma.slackConnection.findUnique({
        where: { userId: req.user.id },
      });
      isSlackConnected = !!slack;
    }

    const overallStatus: 'healthy' | 'degraded' | 'unhealthy' =
      pgStatus === 'healthy' && redisStatus === 'healthy'
        ? 'healthy'
        : pgStatus === 'unhealthy' && redisStatus === 'unhealthy'
        ? 'unhealthy'
        : 'degraded';

    const healthData: SystemHealthDTO & { queueCounts: any } = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      services: {
        postgres: { status: pgStatus, latencyMs: pgLatency, error: pgError },
        redis: { status: redisStatus, latencyMs: redisLatency, error: redisError },
        bullmqWorker: {
          status: redisStatus === 'healthy' ? 'healthy' : 'unhealthy',
          concurrency: config.workerConcurrency,
          activeJobs,
        },
        elasticsearch: {
          status: !esState.configured ? 'disabled' : esState.connected ? 'healthy' : 'unhealthy',
        },
        slack: {
          status: isSlackConnected ? 'connected' : 'disconnected',
        },
      },
      queueCounts: {
        active: activeJobs,
        delayed: delayedJobs,
        waiting: waitingJobs,
        completed: completedJobs,
        failed: failedJobs,
      },
    };

    return res.status(overallStatus === 'unhealthy' ? 503 : 200).json(healthData);
  }
}
