import { Request, Response } from 'express';
import { prisma } from '../prisma/client';
import { elasticsearchService } from '../services/elasticsearch';
import { emailQueue } from '../queues/emailQueue';
import { EmailStatus } from '@reachflow/shared';

export class EmailController {
  /**
   * Retrieves paginated scheduled/queued/rescheduled emails
   */
  public static async getScheduledEmails(req: Request, res: Response) {
    const userId = req.user!.id;
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 20;
    const skip = (page - 1) * limit;

    const where = {
      userId,
      status: {
        in: [EmailStatus.SCHEDULED, EmailStatus.QUEUED, EmailStatus.PROCESSING, EmailStatus.RATE_LIMITED, EmailStatus.RESCHEDULED],
      },
    };

    const [total, emails] = await Promise.all([
      prisma.email.count({ where }),
      prisma.email.findMany({
        where,
        include: {
          sender: { select: { id: true, email: true, name: true } },
          campaign: { select: { id: true, name: true } },
          events: { orderBy: { createdAt: 'asc' } },
        },
        orderBy: { scheduledAt: 'asc' },
        skip,
        take: limit,
      }),
    ]);

    return res.json({
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      emails,
    });
  }

  /**
   * Retrieves paginated sent & failed emails
   */
  public static async getSentEmails(req: Request, res: Response) {
    const userId = req.user!.id;
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 20;
    const skip = (page - 1) * limit;

    const where = {
      userId,
      status: {
        in: [EmailStatus.SENT, EmailStatus.FAILED],
      },
    };

    const [total, emails] = await Promise.all([
      prisma.email.count({ where }),
      prisma.email.findMany({
        where,
        include: {
          sender: { select: { id: true, email: true, name: true } },
          campaign: { select: { id: true, name: true } },
          events: { orderBy: { createdAt: 'asc' } },
        },
        orderBy: { sentAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return res.json({
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      emails,
    });
  }

  /**
   * Retrieves aggregated email metric counts for the dashboard
   */
  public static async getMetrics(req: Request, res: Response) {
    const userId = req.user!.id;

    const [scheduled, sent, rateLimited, failed] = await Promise.all([
      prisma.email.count({
        where: {
          userId,
          status: {
            in: [
              EmailStatus.SCHEDULED,
              EmailStatus.QUEUED,
              EmailStatus.PROCESSING,
              EmailStatus.RATE_LIMITED,
              EmailStatus.RESCHEDULED,
            ],
          },
        },
      }),
      prisma.email.count({
        where: {
          userId,
          status: EmailStatus.SENT,
        },
      }),
      prisma.email.count({
        where: {
          userId,
          status: {
            in: [EmailStatus.RATE_LIMITED, EmailStatus.RESCHEDULED],
          },
        },
      }),
      prisma.email.count({
        where: {
          userId,
          status: EmailStatus.FAILED,
        },
      }),
    ]);

    return res.json({
      scheduled,
      sent,
      rateLimited,
      failed,
    });
  }

  /**
   * Retrieves the detailed Delivery Timeline audit trail for an email
   */
  public static async getEmailTimeline(req: Request, res: Response) {
    const userId = req.user!.id;
    const { id } = req.params;

    const email = await prisma.email.findFirst({
      where: { id, userId },
      include: {
        sender: true,
        campaign: true,
        events: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!email) {
      return res.status(404).json({ error: 'Email record not found' });
    }

    return res.json({
      email,
      timeline: email.events,
    });
  }

  /**
   * Searches emails via Elasticsearch with PostgreSQL fallback
   */
  public static async search(req: Request, res: Response) {
    const userId = req.user!.id;
    const query = (req.query.q as string) || '';
    const status = (req.query.status as string) || undefined;
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 20;

    const result = await elasticsearchService.searchEmails({
      userId,
      query,
      status,
      page,
      limit,
    });

    return res.json(result);
  }

  /**
   * Cancels a scheduled email before it is sent
   */
  public static async cancelScheduledEmail(req: Request, res: Response) {
    const userId = req.user!.id;
    const { id } = req.params;

    const email = await prisma.email.findFirst({
      where: { id, userId },
    });

    if (!email) {
      return res.status(404).json({ error: 'Email not found' });
    }

    if (email.status === EmailStatus.SENT) {
      return res.status(400).json({ error: 'Cannot cancel an email that has already been sent' });
    }

    // Attempt to remove job from BullMQ
    try {
      const job = await emailQueue.getJob(email.jobId);
      if (job) {
        await job.remove();
      }
    } catch (e) {
      // Ignore if job already removed or missing
    }

    await prisma.email.update({
      where: { id },
      data: { status: EmailStatus.FAILED, error: 'Cancelled by user' },
    });

    return res.json({ success: true, message: 'Email scheduled job cancelled' });
  }
}
