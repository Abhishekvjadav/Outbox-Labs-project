import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { config } from './config/env';
import { apiRouter } from './routes/apiRoutes';
import { emailQueue, esIndexQueue } from './queues/emailQueue';
import { emailWorkerService } from './workers/emailWorker';
import { esWorkerService } from './workers/esWorker';
import { elasticsearchService } from './services/elasticsearch';
import { prisma } from './prisma/client';
import { redisClient } from './queues/redis';

export const app = express();

// Middleware
app.use(
  cors({
    origin: config.frontendUrl,
    credentials: true,
  })
);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Setup Bull Board for live queue monitoring at /admin/queues
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

createBullBoard({
  queues: [new BullMQAdapter(emailQueue) as any, new BullMQAdapter(esIndexQueue) as any],
  serverAdapter,
});

app.use('/admin/queues', serverAdapter.getRouter());

// Mount API routes
app.use('/api', apiRouter);

// Root greeting / health check
app.get('/', (req, res) => {
  res.json({
    service: 'ReachFlow Distributed Email Scheduling Engine',
    version: '2.1.0',
    status: 'online',
    adminQueues: '/admin/queues',
    health: '/api/health',
  });
});

// Start Server & Background Services
const server = app.listen(config.port, async () => {
  console.log('================================================================');
  console.log(`🚀 ReachFlow API Server running on http://localhost:${config.port}`);
  console.log(`📊 Bull Board Dashboard active at http://localhost:${config.port}/admin/queues`);
  console.log(`🔗 Frontend configured at ${config.frontendUrl}`);
  console.log('================================================================');

  // Initialize Elasticsearch search index
  if (config.enableElasticsearch) {
    try {
      await elasticsearchService.initializeIndex();
    } catch (e) {
      console.warn('[Server] Elasticsearch initialization deferred:', (e as Error).message);
    }
  }

  // Start BullMQ workers
  try {
    emailWorkerService.start();
    esWorkerService.start();
    console.log(`⚡ BullMQ Workers active (Concurrency: ${config.workerConcurrency})`);
  } catch (workerErr) {
    console.warn('[Server] BullMQ worker startup warning:', (workerErr as Error).message);
  }
});

// Graceful Shutdown
async function gracefulShutdown(signal: string) {
  console.log(`\n[Server] Received ${signal}. Initiating graceful shutdown...`);

  try {
    server.close();
    await emailWorkerService.close();
    await esWorkerService.close();
    await emailQueue.close();
    await esIndexQueue.close();
    await redisClient.quit();
    await prisma.$disconnect();
    console.log('[Server] Graceful shutdown completed cleanly.');
    process.exit(0);
  } catch (err) {
    console.error('[Server] Error during graceful shutdown:', err);
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
