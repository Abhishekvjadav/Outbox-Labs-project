import dotenv from 'dotenv';
import path from 'path';

// Load .env from monorepo root or apps/api
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '5000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
  jwtSecret: process.env.JWT_SECRET || 'reachflow-default-development-jwt-secret-min32-characters',

  // PostgreSQL
  databaseUrl:
    process.env.DATABASE_URL ||
    'postgresql://postgres:postgrespassword@localhost:5432/reachflow?schema=public',

  // Redis
  redisHost: process.env.REDIS_HOST || 'localhost',
  redisPort: parseInt(process.env.REDIS_PORT || '6379', 10),
  redisPassword: process.env.REDIS_PASSWORD || undefined,
  redisTls: process.env.REDIS_TLS === 'true',

  // Worker Settings
  workerConcurrency: parseInt(process.env.WORKER_CONCURRENCY || '5', 10),
  defaultMinEmailDelayMs: parseInt(process.env.DEFAULT_MIN_EMAIL_DELAY_MS || '2000', 10),
  defaultMaxEmailsPerHour: parseInt(process.env.DEFAULT_MAX_EMAILS_PER_HOUR || '100', 10),

  // Elasticsearch
  enableElasticsearch: process.env.ENABLE_ELASTICSEARCH !== 'false',
  elasticsearchNode: process.env.ELASTICSEARCH_NODE || 'http://localhost:9200',
  elasticsearchUsername: process.env.ELASTICSEARCH_USERNAME || undefined,
  elasticsearchPassword: process.env.ELASTICSEARCH_PASSWORD || undefined,

  // Google OAuth
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  googleCallbackUrl:
    process.env.GOOGLE_CALLBACK_URL || 'http://localhost:5000/api/auth/google/callback',

  // Slack OAuth
  slackClientId: process.env.SLACK_CLIENT_ID || '',
  slackClientSecret: process.env.SLACK_CLIENT_SECRET || '',
  slackRedirectUri:
    process.env.SLACK_REDIRECT_URI || 'http://localhost:5000/api/integrations/slack/callback',

  // Ethereal Credentials (Optional pre-configured account)
  defaultEtherealUser: process.env.DEFAULT_ETHEREAL_USER || '',
  defaultEtherealPass: process.env.DEFAULT_ETHEREAL_PASS || '',
};
