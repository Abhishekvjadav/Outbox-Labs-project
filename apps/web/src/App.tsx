import { useState, useEffect, useCallback } from 'react';
import { apiClient } from './lib/api';
import { UserDTO, SenderDTO, EmailDTO, EmailEventDTO, SystemHealthDTO } from '@reachflow/shared';
import { Header } from './components/layout/Header';
import { TabNavigation, TabType } from './components/layout/TabNavigation';
import { ScheduledTable } from './components/emails/ScheduledTable';
import { SentTable } from './components/emails/SentTable';
import { SendersView } from './components/senders/SendersView';
import { SlackSettingsCard } from './components/integrations/SlackSettingsCard';
import { ComposeModal } from './components/campaign/ComposeModal';
import { DeliveryTimelineModal } from './components/emails/DeliveryTimelineModal';
import { LoginPage } from './components/auth/LoginPage';

export function App() {
  const [user, setUser] = useState<(UserDTO & { slackConnection?: any }) | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabType>('scheduled');

  // Telemetry
  const [health, setHealth] = useState<(SystemHealthDTO & { queueCounts?: any }) | null>(null);

  // Core Data
  const [senders, setSenders] = useState<SenderDTO[]>([]);
  const [scheduledEmails, setScheduledEmails] = useState<EmailDTO[]>([]);
  const [sentEmails, setSentEmails] = useState<EmailDTO[]>([]);
  const [scheduledTotal, setScheduledTotal] = useState(0);
  const [sentTotal, setSentTotal] = useState(0);
  const [tableLoading, setTableLoading] = useState(false);

  // Modals
  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const [timelineEmail, setTimelineEmail] = useState<EmailDTO | null>(null);
  const [timelineEvents, setTimelineEvents] = useState<EmailEventDTO[]>([]);
  const [isTimelineOpen, setIsTimelineOpen] = useState(false);

  // Handle OAuth callback token in URL query
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    const tabParam = params.get('tab');
    if (token) {
      localStorage.setItem('reachflow_token', token);
      window.history.replaceState({}, document.title, window.location.pathname);
    }
    if (tabParam === 'settings' || tabParam === 'slack') {
      setActiveTab('slack');
    }
  }, []);

  // Fetch current user
  const fetchUser = useCallback(async () => {
    try {
      const u = await apiClient.getMe();
      setUser(u);
    } catch (e) {
      setUser(null);
    } finally {
      setAuthLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  // Fetch Senders
  const fetchSenders = useCallback(async () => {
    if (!user) return;
    try {
      const res = await apiClient.getSenders();
      setSenders(res.senders);
    } catch (e) {}
  }, [user]);

  // Fetch Scheduled Emails
  const fetchScheduled = useCallback(async (q?: string) => {
    if (!user) return;
    setTableLoading(true);
    try {
      if (q && q.trim().length > 0) {
        const res = await apiClient.searchEmails(q, 'SCHEDULED');
        setScheduledEmails(res.emails);
        setScheduledTotal(res.total);
      } else {
        const res = await apiClient.getScheduledEmails(1, 50);
        setScheduledEmails(res.emails);
        setScheduledTotal(res.total);
      }
    } catch (e) {
    } finally {
      setTableLoading(false);
    }
  }, [user]);

  // Fetch Sent Emails
  const fetchSent = useCallback(async (q?: string) => {
    if (!user) return;
    setTableLoading(true);
    try {
      if (q && q.trim().length > 0) {
        const res = await apiClient.searchEmails(q, 'SENT');
        setSentEmails(res.emails);
        setSentTotal(res.total);
      } else {
        const res = await apiClient.getSentEmails(1, 50);
        setSentEmails(res.emails);
        setSentTotal(res.total);
      }
    } catch (e) {
    } finally {
      setTableLoading(false);
    }
  }, [user]);

  // Poll Health & Tables every 5s
  useEffect(() => {
    if (!user) return;

    const poll = async () => {
      try {
        const h = await apiClient.getHealth();
        setHealth(h);
      } catch (e) {}
    };

    poll();
    fetchSenders();
    fetchScheduled();
    fetchSent();

    const interval = setInterval(() => {
      poll();
      if (activeTab === 'scheduled') fetchScheduled();
      if (activeTab === 'sent') fetchSent();
    }, 4000);

    return () => clearInterval(interval);
  }, [user, activeTab, fetchSenders, fetchScheduled, fetchSent]);

  // View Timeline Action
  const handleViewTimeline = async (email: EmailDTO) => {
    try {
      const res = await apiClient.getEmailTimeline(email.id);
      setTimelineEmail(res.email);
      setTimelineEvents(res.timeline);
      setIsTimelineOpen(true);
    } catch (e) {
      alert('Could not load email delivery timeline');
    }
  };

  // Cancel Scheduled Email Action
  const handleCancelEmail = async (emailId: string) => {
    if (!confirm('Are you sure you want to cancel this scheduled email dispatch?')) return;
    try {
      await apiClient.cancelScheduledEmail(emailId);
      fetchScheduled();
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleLogout = async () => {
    await apiClient.logout();
    setUser(null);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="flex flex-col items-center space-y-3">
          <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-xs text-slate-400 font-mono">Initializing ReachFlow Engine...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage onLoginSuccess={fetchUser} />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Header */}
      <Header user={user} health={health} onLogout={handleLogout} />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Tab Navigation & Compose CTA */}
        <TabNavigation
          activeTab={activeTab}
          onTabChange={setActiveTab}
          scheduledCount={scheduledTotal}
          sentCount={sentTotal}
          onOpenCompose={() => setIsComposeOpen(true)}
        />

        {/* Tab Views */}
        {activeTab === 'scheduled' && (
          <ScheduledTable
            emails={scheduledEmails}
            loading={tableLoading}
            onViewTimeline={handleViewTimeline}
            onCancelEmail={handleCancelEmail}
            onSearch={(q) => fetchScheduled(q)}
            total={scheduledTotal}
          />
        )}

        {activeTab === 'sent' && (
          <SentTable
            emails={sentEmails}
            loading={tableLoading}
            onViewTimeline={handleViewTimeline}
            onSearch={(q) => fetchSent(q)}
            total={sentTotal}
          />
        )}

        {activeTab === 'senders' && (
          <SendersView senders={senders} onSenderCreated={fetchSenders} />
        )}

        {activeTab === 'slack' && (
          <SlackSettingsCard slackConnection={user.slackConnection} onRefresh={fetchUser} />
        )}
      </main>

      {/* Compose Campaign Modal */}
      <ComposeModal
        isOpen={isComposeOpen}
        onClose={() => setIsComposeOpen(false)}
        senders={senders}
        onCampaignCreated={() => {
          fetchScheduled();
          setActiveTab('scheduled');
        }}
      />

      {/* Delivery Timeline Audit Modal */}
      <DeliveryTimelineModal
        isOpen={isTimelineOpen}
        onClose={() => setIsTimelineOpen(false)}
        email={timelineEmail}
        events={timelineEvents}
      />
    </div>
  );
}

export default App;
