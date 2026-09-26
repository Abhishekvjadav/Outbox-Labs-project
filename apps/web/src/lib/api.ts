import axios from 'axios';
import {
  CampaignCreateInput,
  EmailDTO,
  EmailEventDTO,
  SenderDTO,
  SystemHealthDTO,
  UserDTO,
} from '@reachflow/shared';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

export const api = axios.create({
  baseURL: `${API_BASE_URL}/api`,
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('reachflow_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const apiClient = {
  // Health
  getHealth: async (): Promise<SystemHealthDTO & { queueCounts: any }> => {
    const res = await api.get('/health');
    return res.data;
  },

  // Auth
  getMe: async (): Promise<UserDTO & { slackConnection: { isConnected: boolean; teamName?: string; channelName?: string } }> => {
    const res = await api.get('/auth/me');
    return res.data;
  },
  getGoogleAuthUrl: async (): Promise<{ url: string }> => {
    const res = await api.get('/auth/google/url');
    return res.data;
  },
  logout: async () => {
    localStorage.removeItem('reachflow_token');
    await api.post('/auth/logout');
  },

  // Senders & Campaigns
  getSenders: async (): Promise<{ senders: SenderDTO[] }> => {
    const res = await api.get('/senders');
    return res.data;
  },
  createSender: async (data: { name: string; hourlyLimit: number }): Promise<{ sender: SenderDTO }> => {
    const res = await api.post('/senders', data);
    return res.data;
  },
  createCampaign: async (data: CampaignCreateInput) => {
    const res = await api.post('/campaigns', data);
    return res.data;
  },

  // Emails
  getScheduledEmails: async (page = 1, limit = 20): Promise<{ emails: EmailDTO[]; total: number; totalPages: number }> => {
    const res = await api.get(`/emails/scheduled?page=${page}&limit=${limit}`);
    return res.data;
  },
  getSentEmails: async (page = 1, limit = 20): Promise<{ emails: EmailDTO[]; total: number; totalPages: number }> => {
    const res = await api.get(`/emails/sent?page=${page}&limit=${limit}`);
    return res.data;
  },
  getEmailTimeline: async (emailId: string): Promise<{ email: EmailDTO; timeline: EmailEventDTO[] }> => {
    const res = await api.get(`/emails/${emailId}/timeline`);
    return res.data;
  },
  searchEmails: async (q: string, status?: string): Promise<{ emails: EmailDTO[]; total: number; source: string }> => {
    const res = await api.get(`/emails/search?q=${encodeURIComponent(q)}${status ? `&status=${status}` : ''}`);
    return res.data;
  },
  cancelScheduledEmail: async (emailId: string) => {
    const res = await api.post(`/emails/${emailId}/cancel`);
    return res.data;
  },

  // Slack
  getSlackAuthUrl: async (): Promise<{ url: string }> => {
    const res = await api.get('/integrations/slack/url');
    return res.data;
  },
  disconnectSlack: async () => {
    const res = await api.post('/integrations/slack/disconnect');
    return res.data;
  },
  testSlackAlert: async () => {
    const res = await api.post('/integrations/slack/test');
    return res.data;
  },
};
