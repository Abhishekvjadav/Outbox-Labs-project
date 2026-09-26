import { Request, Response } from 'express';
import { CampaignCreateSchema, calculateCampaignEstimate } from '@reachflow/shared';
import { prisma } from '../prisma/client';
import { emailQueue, esIndexQueue } from '../queues/emailQueue';
import { etherealService } from '../services/ethereal';
import { EmailStatus, EventType } from '@reachflow/shared';
import { v4 as uuidv4 } from 'uuid';

export class CampaignController {
  /**
   * Schedules a new email outreach campaign
   */
  public static async createCampaign(req: Request, res: Response) {
    const userId = req.user!.id;

    // 1. Validate request body against Zod schema
    const parseResult = CampaignCreateSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: parseResult.error.flatten(),
      });
    }

    const { name, subject, body, senderIds, leads, startTime, delayMs, hourlyLimit } = parseResult.data;

    // 2. Verify all specified senders belong to this user
    const senders = await prisma.sender.findMany({
      where: {
        id: { in: senderIds },
        userId,
      },
    });

    if (senders.length === 0) {
      return res.status(400).json({ error: 'At least one valid sender mailbox is required' });
    }

    // 3. Database transaction: Create Campaign, CampaignSenders, Emails, and initial Events
    const startTimestamp = startTime.getTime();
    const emailsToCreate: any[] = [];
    const eventsToCreate: any[] = [];
    const jobEnqueues: { emailId: string; jobId: string; delay: number }[] = [];

    const campaign = await prisma.$transaction(async (tx) => {
      // Create campaign record
      const createdCampaign = await tx.campaign.create({
        data: {
          userId,
          name,
          subject,
          body,
          startTime,
          delayMs,
          hourlyLimit,
          totalEmails: leads.length,
          status: 'ACTIVE',
        },
      });

      // Link senders via CampaignSender join table
      await tx.campaignSender.createMany({
        data: senders.map((s) => ({
          campaignId: createdCampaign.id,
          senderId: s.id,
        })),
      });

      // Distribute leads across senders (round-robin)
      for (let i = 0; i < leads.length; i++) {
        const leadEmail = leads[i];
        const assignedSender = senders[i % senders.length];
        const emailId = uuidv4();
        const deterministicJobId = `email-send-${emailId}`;

        // Stagger scheduledAt by delayMs per sender so each sender respects inter-send interval
        const senderSlotIndex = Math.floor(i / senders.length);
        const scheduledTimeMs = Math.max(Date.now(), startTimestamp + senderSlotIndex * delayMs);
        const scheduledAt = new Date(scheduledTimeMs);
        const delay = Math.max(0, scheduledTimeMs - Date.now());

        emailsToCreate.push({
          id: emailId,
          campaignId: createdCampaign.id,
          userId,
          senderId: assignedSender.id,
          recipient: leadEmail,
          subject,
          body,
          status: EmailStatus.SCHEDULED,
          scheduledAt,
          jobId: deterministicJobId,
        });

        eventsToCreate.push({
          emailId,
          type: EventType.CAMPAIGN_CREATED,
          message: `Campaign '${name}' created. Assigned sender: ${assignedSender.email}`,
          metadata: { campaignId: createdCampaign.id, assignedSender: assignedSender.email },
        });

        eventsToCreate.push({
          emailId,
          type: EventType.JOB_ENQUEUED,
          message: `Delayed BullMQ job enqueued. Scheduled dispatch in ${Math.round(delay / 1000)}s`,
          metadata: { jobId: deterministicJobId, delayMs: delay },
        });

        jobEnqueues.push({
          emailId,
          jobId: deterministicJobId,
          delay,
        });
      }

      await tx.email.createMany({ data: emailsToCreate });
      await tx.emailEvent.createMany({ data: eventsToCreate });

      return createdCampaign;
    });

    // 4. Enqueue BullMQ delayed jobs in Redis (Strictly NO CRON)
    for (const job of jobEnqueues) {
      await emailQueue.add(
        'send-email',
        { emailId: job.emailId },
        {
          jobId: job.jobId,
          delay: job.delay, // BullMQ delayed zset
          attempts: 3,
        }
      );

      // Async index into Elasticsearch
      esIndexQueue
        .add('index-email', { emailId: job.emailId, action: 'index' }, { jobId: `es-index-${job.emailId}` })
        .catch(() => {});
    }

    // 5. Calculate pre-flight estimation metrics
    const estimate = calculateCampaignEstimate(leads.length, senders.length, hourlyLimit, delayMs);

    return res.status(201).json({
      success: true,
      campaign: {
        id: campaign.id,
        name: campaign.name,
        totalEmails: campaign.totalEmails,
        startTime: campaign.startTime,
        delayMs: campaign.delayMs,
        hourlyLimit: campaign.hourlyLimit,
        senders: senders.map((s) => ({ id: s.id, email: s.email, name: s.name })),
        estimate,
      },
    });
  }

  /**
   * Retrieves all senders configured for the authenticated user
   */
  public static async getSenders(req: Request, res: Response) {
    const userId = req.user!.id;
    let senders = await prisma.sender.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    // If user has no senders yet, automatically provision one via Ethereal!
    if (senders.length === 0) {
      try {
        const testAccount = await etherealService.createTestSender();
        const newSender = await prisma.sender.create({
          data: {
            userId,
            email: testAccount.email,
            name: `${req.user!.name.split(' ')[0]} (Outbox Mailbox)`,
            etherealUser: testAccount.user,
            etherealPass: testAccount.pass,
            hourlyLimit: 100,
          },
        });
        senders = [newSender];
      } catch (e) {
        console.warn('[CampaignController] Could not auto-provision Ethereal sender:', (e as Error).message);
      }
    }

    return res.json({ senders });
  }

  /**
   * Provisions a brand new Ethereal sender mailbox on demand
   */
  public static async createSender(req: Request, res: Response) {
    const userId = req.user!.id;
    const { name, hourlyLimit } = req.body;

    try {
      const testAccount = await etherealService.createTestSender();
      const newSender = await prisma.sender.create({
        data: {
          userId,
          email: testAccount.email,
          name: name || `Mailbox ${testAccount.email.split('@')[0]}`,
          etherealUser: testAccount.user,
          etherealPass: testAccount.pass,
          hourlyLimit: hourlyLimit ? parseInt(hourlyLimit, 10) : 100,
        },
      });

      return res.status(201).json({ sender: newSender });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to provision test mailbox', details: (err as Error).message });
    }
  }

  /**
   * Retrieves list of campaigns for user
   */
  public static async getCampaigns(req: Request, res: Response) {
    const userId = req.user!.id;
    const campaigns = await prisma.campaign.findMany({
      where: { userId },
      include: {
        senders: {
          include: { sender: { select: { id: true, email: true, name: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.json({ campaigns });
  }
}
