import { Request, Response } from 'express';
import { slackService } from '../services/slack';
import { prisma } from '../prisma/client';
import { config } from '../config/env';

export class SlackController {
  public static getAuthUrl(req: Request, res: Response) {
    const userId = req.user!.id;
    const url = slackService.getAuthorizationUrl(userId);
    return res.json({ url });
  }

  public static async handleCallback(req: Request, res: Response) {
    const { code, state: userId } = req.query;

    if (!code || typeof code !== 'string') {
      return res.redirect(`${config.frontendUrl}/dashboard?tab=settings&slack=error_missing_code`);
    }

    try {
      await slackService.handleOAuthCallback(code, (userId as string) || req.user?.id || '');
      return res.redirect(`${config.frontendUrl}/dashboard?tab=settings&slack=connected`);
    } catch (err) {
      console.error('[SlackController] Callback error:', (err as Error).message);
      return res.redirect(`${config.frontendUrl}/dashboard?tab=settings&slack=failed`);
    }
  }

  public static async disconnect(req: Request, res: Response) {
    const userId = req.user!.id;
    await prisma.slackConnection.deleteMany({
      where: { userId },
    });
    return res.json({ success: true, message: 'Slack disconnected successfully' });
  }

  public static async sendTestAlert(req: Request, res: Response) {
    const userId = req.user!.id;
    const connection = await prisma.slackConnection.findUnique({
      where: { userId },
    });

    if (!connection) {
      return res.status(400).json({ error: 'Please connect Slack first' });
    }

    const testSender = await prisma.sender.findFirst({ where: { userId } });

    const sent = await slackService.sendDeduplicatedRateLimitAlert(userId, testSender?.id || 'test-sender', {
      senderEmail: testSender?.email || 'test@reachflow.ethereal.email',
      senderName: testSender?.name || 'Test Sender',
      hourlyLimit: 50,
      currentCount: 50,
      windowKey: 'TEST-WINDOW',
      nextWindowTime: new Date(Date.now() + 3600000).toISOString(),
      campaignName: 'Test Campaign',
    });

    return res.json({ success: sent, message: sent ? 'Test alert delivered' : 'Alert deduplicated or failed' });
  }
}
