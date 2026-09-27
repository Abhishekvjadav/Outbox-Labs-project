export enum EmailStatus {
  SCHEDULED = 'SCHEDULED',
  QUEUED = 'QUEUED',
  PROCESSING = 'PROCESSING',
  RATE_LIMITED = 'RATE_LIMITED',
  RESCHEDULED = 'RESCHEDULED',
  SENT = 'SENT',
  FAILED = 'FAILED',
}

export enum EventType {
  CAMPAIGN_CREATED = 'CAMPAIGN_CREATED',
  JOB_ENQUEUED = 'JOB_ENQUEUED',
  WORKER_PICKED = 'WORKER_PICKED',
  RATE_LIMIT_CHECKED = 'RATE_LIMIT_CHECKED',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  RESCHEDULED_NEXT_WINDOW = 'RESCHEDULED_NEXT_WINDOW',
  PROVIDER_DELAY_APPLIED = 'PROVIDER_DELAY_APPLIED',
  SMTP_DELIVERED = 'SMTP_DELIVERED',
  INDEXED_SEARCH = 'INDEXED_SEARCH',
  FAILED_ATTEMPT = 'FAILED_ATTEMPT',
  DLQ_MOVED = 'DLQ_MOVED',
}

export interface UserDTO {
  id: string;
  email: string;
  name: string;
  avatar?: string | null;
  googleId?: string | null;
  createdAt: string;
}

export interface SenderDTO {
  id: string;
  userId: string;
  email: string;
  name: string;
  hourlyLimit: number;
  createdAt: string;
}

export interface CampaignSenderDTO {
  campaignId: string;
  senderId: string;
  sender?: SenderDTO;
}

export interface CampaignDTO {
  id: string;
  userId: string;
  name: string;
  subject: string;
  body: string;
  startTime: string;
  delayMs: number;
  hourlyLimit: number;
  totalEmails: number;
  sentEmails: number;
  status: string;
  createdAt: string;
  senders?: CampaignSenderDTO[];
}

export interface EmailEventDTO {
  id: string;
  emailId: string;
  type: EventType;
  message: string;
  metadata?: Record<string, any> | null;
  createdAt: string;
}

export interface EmailDTO {
  id: string;
  campaignId: string;
  userId: string;
  senderId: string;
  senderEmail?: string;
  recipient: string;
  subject: string;
  body: string;
  status: EmailStatus;
  scheduledAt: string;
  sentAt?: string | null;
  jobId: string;
  attempts: number;
  messageId?: string | null;
  previewUrl?: string | null;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
  events?: EmailEventDTO[];
}

export interface SlackConnectionDTO {
  id: string;
  userId: string;
  teamId: string;
  teamName: string;
  channelId?: string | null;
  channelName?: string | null;
  isConnected: boolean;
  createdAt: string;
}

export interface SystemHealthDTO {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  services: {
    postgres: { status: 'healthy' | 'unhealthy'; latencyMs: number; error?: string };
    redis: { status: 'healthy' | 'unhealthy'; latencyMs: number; error?: string };
    bullmqWorker: { status: 'healthy' | 'idle' | 'unhealthy'; concurrency: number; activeJobs: number };
    elasticsearch: { status: 'healthy' | 'unhealthy' | 'disabled'; latencyMs?: number };
    slack: { status: 'connected' | 'disconnected' };
  };
}

export interface ParsedLead {
  email: string;
  valid: boolean;
  isDuplicate?: boolean;
  error?: string;
}

export interface CsvValidationResult {
  total: number;
  valid: number;
  duplicates: number;
  invalid: number;
  leads: ParsedLead[];
}

export interface CampaignEstimatorResult {
  totalLeads: number;
  senderCount: number;
  limitPerSender: number;
  combinedCapacityPerHour: number;
  interSendDelaySec: number;
  bottleneck: 'RATE_LIMIT' | 'INTER_SEND_THROTTLE';
  estimatedDurationMinutes: number;
  estimatedDurationHuman: string;
}

export interface EmailMetricsDTO {
  scheduled: number;
  sent: number;
  rateLimited: number;
  failed: number;
}
