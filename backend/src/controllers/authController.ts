import { Request, Response } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { config } from '../config/env';
import { prisma } from '../prisma/client';
import { generateToken } from '../middleware/auth';

const googleClient = new OAuth2Client(
  config.googleClientId,
  config.googleClientSecret,
  config.googleCallbackUrl
);

export class AuthController {
  /**
   * Generates Google OAuth authorization URL
   */
  public static getGoogleAuthUrl(req: Request, res: Response) {
    if (!config.googleClientId) {
      return res.status(400).json({
        error: 'GOOGLE_CLIENT_ID is not configured in .env',
      });
    }

    const url = googleClient.generateAuthUrl({
      access_type: 'offline',
      scope: ['profile', 'email'],
      prompt: 'consent',
    });

    return res.json({ url });
  }

  /**
   * Google OAuth Callback
   */
  public static async handleGoogleCallback(req: Request, res: Response) {
    const { code } = req.query;

    if (!code || typeof code !== 'string') {
      return res.redirect(`${config.frontendUrl}/login?error=missing_code`);
    }

    try {
      const { tokens } = await googleClient.getToken(code);
      googleClient.setCredentials(tokens);

      const ticket = await googleClient.verifyIdToken({
        idToken: tokens.id_token!,
        audience: config.googleClientId,
      });

      const payload = ticket.getPayload();
      if (!payload || !payload.email) {
        return res.redirect(`${config.frontendUrl}/login?error=invalid_token`);
      }

      // Upsert User in PostgreSQL
      const user = await prisma.user.upsert({
        where: { email: payload.email },
        update: {
          name: payload.name || payload.email.split('@')[0],
          avatar: payload.picture || null,
          googleId: payload.sub,
        },
        create: {
          email: payload.email,
          name: payload.name || payload.email.split('@')[0],
          avatar: payload.picture || null,
          googleId: payload.sub,
        },
      });

      const token = generateToken({
        id: user.id,
        email: user.email,
        name: user.name,
        avatar: user.avatar,
      });

      res.cookie('reachflow_token', token, {
        httpOnly: true,
        secure: config.nodeEnv === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      return res.redirect(`${config.frontendUrl}/dashboard?token=${token}`);
    } catch (error) {
      console.error('[Auth] Google OAuth callback error:', (error as Error).message);
      return res.redirect(`${config.frontendUrl}/login?error=auth_failed`);
    }
  }

  /**
   * Directly verifies Google ID Token sent from frontend Google Identity Services
   */
  public static async verifyGoogleIdToken(req: Request, res: Response) {
    const { idToken } = req.body;
    if (!idToken) {
      return res.status(400).json({ error: 'idToken is required' });
    }

    try {
      const ticket = await googleClient.verifyIdToken({
        idToken,
        audience: config.googleClientId,
      });

      const payload = ticket.getPayload();
      if (!payload || !payload.email) {
        return res.status(400).json({ error: 'Invalid Google token payload' });
      }

      const user = await prisma.user.upsert({
        where: { email: payload.email },
        update: {
          name: payload.name || payload.email.split('@')[0],
          avatar: payload.picture || null,
          googleId: payload.sub,
        },
        create: {
          email: payload.email,
          name: payload.name || payload.email.split('@')[0],
          avatar: payload.picture || null,
          googleId: payload.sub,
        },
      });

      const token = generateToken({
        id: user.id,
        email: user.email,
        name: user.name,
        avatar: user.avatar,
      });

      res.cookie('reachflow_token', token, {
        httpOnly: true,
        secure: config.nodeEnv === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      return res.json({
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          avatar: user.avatar,
        },
      });
    } catch (err) {
      return res.status(401).json({ error: 'Token verification failed', details: (err as Error).message });
    }
  }

  /**
   * Returns authenticated user profile
   */
  public static async getMe(req: Request, res: Response) {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: {
        slackConnection: {
          select: {
            teamName: true,
            channelName: true,
            createdAt: true,
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      avatar: user.avatar,
      createdAt: user.createdAt,
      slackConnection: user.slackConnection ? {
        isConnected: true,
        teamName: user.slackConnection.teamName,
        channelName: user.slackConnection.channelName,
      } : { isConnected: false },
    });
  }

  /**
   * Logs out user
   */
  public static async logout(req: Request, res: Response) {
    res.clearCookie('reachflow_token');
    return res.json({ success: true, message: 'Logged out successfully' });
  }
}
