import { z } from 'zod';
import { CampaignEstimatorResult, CsvValidationResult, ParsedLead } from './types';

// RFC 5322 standard regex for email validation
export const EMAIL_REGEX =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

export const CampaignCreateSchema = z.object({
  name: z.string().min(1, 'Campaign name is required').max(100),
  subject: z.string().min(1, 'Subject is required').max(200),
  body: z.string().min(1, 'Body content is required'),
  senderIds: z.array(z.string().uuid()).min(1, 'At least one sender is required'),
  leads: z.array(z.string().regex(EMAIL_REGEX, 'Invalid email format')).min(1, 'At least one valid lead email is required'),
  startTime: z.string().datetime().or(z.date()).transform((val) => (typeof val === 'string' ? new Date(val) : val)),
  delayMs: z.number().int().min(500, 'Minimum delay is 500ms').default(2000),
  hourlyLimit: z.number().int().min(1, 'Hourly limit must be at least 1').default(100),
});

export type CampaignCreateInput = z.infer<typeof CampaignCreateSchema>;

export const EmailSearchQuerySchema = z.object({
  q: z.string().optional().default(''),
  status: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type EmailSearchQueryInput = z.infer<typeof EmailSearchQuerySchema>;

/**
 * Validates and deduplicates a list of raw email strings from CSV or text upload
 */
export function parseAndValidateLeads(rawLines: string[]): CsvValidationResult {
  const seen = new Set<string>();
  const parsedLeads: ParsedLead[] = [];
  let validCount = 0;
  let duplicateCount = 0;
  let invalidCount = 0;

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim().toLowerCase().replace(/^["']|["']$/g, '');
    if (!trimmed || trimmed === 'email' || trimmed === 'leads') {
      continue; // Skip headers or empty lines
    }

    if (!EMAIL_REGEX.test(trimmed)) {
      invalidCount++;
      parsedLeads.push({
        email: trimmed,
        valid: false,
        error: 'Invalid RFC 5322 format',
      });
      continue;
    }

    if (seen.has(trimmed)) {
      duplicateCount++;
      parsedLeads.push({
        email: trimmed,
        valid: false,
        isDuplicate: true,
        error: 'Duplicate in uploaded list',
      });
      continue;
    }

    seen.add(trimmed);
    validCount++;
    parsedLeads.push({
      email: trimmed,
      valid: true,
    });
  }

  return {
    total: parsedLeads.length,
    valid: validCount,
    duplicates: duplicateCount,
    invalid: invalidCount,
    leads: parsedLeads,
  };
}

/**
 * Calculates campaign completion time considering both rate limits and inter-send delay
 */
export function calculateCampaignEstimate(
  totalValidLeads: number,
  senderCount: number,
  limitPerSenderPerHour: number,
  delayMsPerSender: number
): CampaignEstimatorResult {
  if (totalValidLeads <= 0 || senderCount <= 0) {
    return {
      totalLeads: totalValidLeads,
      senderCount,
      limitPerSender: limitPerSenderPerHour,
      combinedCapacityPerHour: 0,
      interSendDelaySec: delayMsPerSender / 1000,
      bottleneck: 'RATE_LIMIT',
      estimatedDurationMinutes: 0,
      estimatedDurationHuman: '0 minutes',
    };
  }

  const combinedCapacity = senderCount * limitPerSenderPerHour;
  // Duration in hours dictated by hourly rate limits
  const rateLimitDurationHours = totalValidLeads / combinedCapacity;
  const rateLimitDurationSeconds = rateLimitDurationHours * 3600;

  // Duration dictated by serialized inter-send interval per sender
  const leadsPerSender = Math.ceil(totalValidLeads / senderCount);
  const throttleDurationSeconds = (leadsPerSender * delayMsPerSender) / 1000;

  const isRateLimitBottleneck = rateLimitDurationSeconds >= throttleDurationSeconds;
  const maxDurationSeconds = Math.max(rateLimitDurationSeconds, throttleDurationSeconds);
  const durationMinutes = Math.ceil(maxDurationSeconds / 60);

  const hours = Math.floor(durationMinutes / 60);
  const remainingMinutes = durationMinutes % 60;
  let human = '';
  if (hours > 0) {
    human += `${hours}h `;
  }
  human += `${remainingMinutes}m`;

  return {
    totalLeads: totalValidLeads,
    senderCount,
    limitPerSender: limitPerSenderPerHour,
    combinedCapacityPerHour: combinedCapacity,
    interSendDelaySec: delayMsPerSender / 1000,
    bottleneck: isRateLimitBottleneck ? 'RATE_LIMIT' : 'INTER_SEND_THROTTLE',
    estimatedDurationMinutes: durationMinutes,
    estimatedDurationHuman: human.trim(),
  };
}
