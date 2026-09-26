import { Router } from 'express';
import { AuthController } from '../controllers/authController';
import { CampaignController } from '../controllers/campaignController';
import { EmailController } from '../controllers/emailController';
import { SlackController } from '../controllers/slackController';
import { HealthController } from '../controllers/healthController';
import { authMiddleware } from '../middleware/auth';

export const apiRouter = Router();

// Public / Health
apiRouter.get('/health', HealthController.getHealth);

// Google OAuth
apiRouter.get('/auth/google/url', AuthController.getGoogleAuthUrl);
apiRouter.get('/auth/google/callback', AuthController.handleGoogleCallback);
apiRouter.post('/auth/google/verify', AuthController.verifyGoogleIdToken);
apiRouter.post('/auth/logout', AuthController.logout);

// Protected routes (Google user session)
apiRouter.get('/auth/me', authMiddleware, AuthController.getMe);

// Campaigns & Senders
apiRouter.post('/campaigns', authMiddleware, CampaignController.createCampaign);
apiRouter.get('/campaigns', authMiddleware, CampaignController.getCampaigns);
apiRouter.get('/senders', authMiddleware, CampaignController.getSenders);
apiRouter.post('/senders', authMiddleware, CampaignController.createSender);

// Emails & Search
apiRouter.get('/emails/scheduled', authMiddleware, EmailController.getScheduledEmails);
apiRouter.get('/emails/sent', authMiddleware, EmailController.getSentEmails);
apiRouter.get('/emails/search', authMiddleware, EmailController.search);
apiRouter.get('/emails/:id/timeline', authMiddleware, EmailController.getEmailTimeline);
apiRouter.post('/emails/:id/cancel', authMiddleware, EmailController.cancelScheduledEmail);

// Slack Integration
apiRouter.get('/integrations/slack/url', authMiddleware, SlackController.getAuthUrl);
apiRouter.get('/integrations/slack/callback', SlackController.handleCallback);
apiRouter.post('/integrations/slack/disconnect', authMiddleware, SlackController.disconnect);
apiRouter.post('/integrations/slack/test', authMiddleware, SlackController.sendTestAlert);
