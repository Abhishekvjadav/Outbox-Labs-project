import { WebClient } from '@slack/web-api';
import { config } from '../config/env';
import { redisClient } from '../queues/redis';
import { prisma } from '../prisma/client';

export interface RateLimitAlertPayload {
  senderEmail: string;
  senderName: string;
  hourlyLimit: number;
  currentCount: number;
  windowKey: string;
  nextWindowTime: string;
  campaignName?: string;
}

export class SlackService {
  /**
   * Generates the Slack OAuth 2.0 authorization URL
   */
  public getAuthorizationUrl(state: string): string {
    const scopes = ['chat:write', 'chat:write.public', 'channels:read'];
    return `https://slack.com/oauth/v2/authorize?client_id=${encodeURIComponent(
      config.slackClientId
    )}&scope=${encodeURIComponent(scopes.join(','))}&redirect_uri=${encodeURIComponent(
      config.slackRedirectUri
    )}&state=${encodeURIComponent(state)}`;
  }

  /**
   * Exchanges authorization code for OAuth token and saves to database
   */
  public async handleOAuthCallback(code: string, userId: string): Promise<void> {
    const client = new WebClient();
    const response = await client.oauth.v2.access({
      client_id: config.slackClientId,
      client_secret: config.slackClientSecret,
      code,
      redirect_uri: config.slackRedirectUri,
    });

    if (!response.ok || !response.access_token) {
      throw new Error(`Slack OAuth exchange failed: ${response.error || 'Unknown error'}`);
    }

    const teamId = response.team?.id || 'unknown';
    const teamName = response.team?.name || 'Slack Workspace';
    const accessToken = response.access_token;
    const botUserId = response.bot_user_id;

    // Pick first public channel as default if available
    let channelId: string | undefined;
    let channelName: string | undefined;

    try {
      const authClient = new WebClient(accessToken);
      const convList = await authClient.conversations.list({
        types: 'public_channel',
        limit: 10,
      });
      if (convList.channels && convList.channels.length > 0) {
        channelId = convList.channels[0].id;
        channelName = convList.channels[0].name;
      }
    } catch (e) {
      console.warn('[Slack] Could not list channels:', (e as Error).message);
    }

    await prisma.slackConnection.upsert({
      where: { userId },
      update: {
        teamId,
        teamName,
        accessToken,
        botUserId,
        channelId,
        channelName,
      },
      create: {
        userId,
        teamId,
        teamName,
        accessToken,
        botUserId,
        channelId,
        channelName,
      },
    });
  }

  /**
   * Sends a rate-limit notification to the user's connected Slack workspace.
   * Enforces deduplication via Redis SET NX: strictly ONE alert per sender per hour window!
   */
  public async sendDeduplicatedRateLimitAlert(
    userId: string,
    senderId: string,
    payload: RateLimitAlertPayload
  ): Promise<boolean> {
    // 1. Enforce deduplication via Redis SET NX
    const alertKey = `reachflow:slack:alert:sender:${senderId}:window:${payload.windowKey}`;
    const acquired = await redisClient.set(alertKey, '1', 'EX', 3600, 'NX');

    if (acquired !== 'OK') {
      // Alert has already been sent for this sender in this hour window
      console.log(`[Slack] Skipping duplicate alert for sender ${payload.senderEmail} in window ${payload.windowKey}`);
      return false;
    }

    // 2. Query user's Slack connection
    const slackConnection = await prisma.slackConnection.findUnique({
      where: { userId },
    });

    if (!slackConnection || !slackConnection.accessToken) {
      console.log(`[Slack] User ${userId} has not connected Slack. Skipping notification.`);
      return false;
    }

    const client = new WebClient(slackConnection.accessToken);
    const targetChannel = slackConnection.channelId || '#general';

    // 3. Dispatch rich Slack Block Kit message
    try {
      await client.chat.postMessage({
        channel: targetChannel,
        text: `⚠️ Rate limit reached for sender ${payload.senderEmail}`,
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: '⚠️ ReachFlow: Mailbox Rate Limit Reached',
              emoji: true,
            },
          },
          {
            type: 'section',
            fields: [
              {
                type: 'mrkdwn',
                text: `*Sender:*\n\`${payload.senderEmail}\``,
              },
              {
                type: 'mrkdwn',
                text: `*Hourly Limit:*\n${payload.hourlyLimit} emails/hr`,
              },
              {
                type: 'mrkdwn',
                text: `*Window:*\n\`${payload.windowKey}\``,
              },
              {
                type: 'mrkdwn',
                text: `*Rescheduled Window:*\n<!date^${Math.floor(
                  new Date(payload.nextWindowTime).getTime() / 1000
                )}^{time}|${payload.nextWindowTime}>`,
              },
            ],
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: '🛡️ *Protection Active:* Remaining emails have been safely rescheduled into the next window to protect sender domain reputation.',
              },
            ],
          },
        ],
      });

      console.log(`[Slack] Successfully delivered rate-limit alert to ${slackConnection.teamName} (${targetChannel})`);
      return true;
    } catch (error) {
      console.error('[Slack] Failed to deliver alert to Slack API:', (error as Error).message);
      return false;
    }
  }
}

export const slackService = new SlackService();
