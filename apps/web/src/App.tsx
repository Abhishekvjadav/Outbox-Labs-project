import { useState, useEffect, useCallback } from 'react';
import { apiClient } from './lib/api';
import { UserDTO, SenderDTO, EmailDTO, EmailEventDTO, SystemHealthDTO, EmailMetricsDTO } from '@reachflow/shared';
import { Header } from './components/layout/Header';
import { TabNavigation, TabType } from './components/layout/TabNavigation';
import { ControlCenterOverview } from './components/dashboard/ControlCenterOverview';
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

  // Telemetry & Metrics
  const [health, setHealth] = useState<(SystemHealthDTO & { queueCounts?: any }) | null>(null);
  const [metrics, setMetrics] = useState<EmailMetricsDTO | null>(null);

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

  // Telemetry & Metrics Poll
  const poll = useCallback(async () => {
    if (!user) return;
    try {
      const [h, m] = await Promise.all([
        apiClient.getHealth(),
        apiClient.getEmailMetrics(),
      ]);
      setHealth(h);
      setMetrics(m);
    } catch (e) {}
  }, [user]);

  // Poll Health, Metrics & Tables every 4s
  useEffect(() => {
    if (!user) return;

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
  }, [user, activeTab, poll, fetchSenders, fetchScheduled, fetchSent]);

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
      poll();
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
      <div className="min-h-screen bg-canvas flex items-center justify-center p-4">
        <div className="bg-surface-card border border-white/[0.08] p-6 rounded-2xl shadow-elevated max-w-sm w-full space-y-4 text-center">
          <div className="mx-auto w-10 h-10 rounded-xl bg-brand-600/20 border border-brand-500/30 flex items-center justify-center">
            <div className="w-4 h-4 border-2 border-brand-400 border-t-transparent rounded-full animate-spin" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white tracking-tight">Initializing ReachFlow Engine</h3>
            <p className="text-[11px] text-slate-400 font-mono mt-1">Verifying cluster session & telemetry...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage onLoginSuccess={fetchUser} />;
  }

  return (
    <div className="min-h-screen bg-canvas text-slate-100 flex flex-col selection:bg-brand-500/30 selection:text-brand-200">
      {/* Precision Infrastructure Header */}
      <Header user={user} health={health} onLogout={handleLogout} />

      {/* Main Control Center Canvas */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Outbound Infrastructure Overview & Metrics */}
        <ControlCenterOverview
          health={health}
          metrics={metrics}
          scheduledTotal={scheduledTotal}
          sentTotal={sentTotal}
          scheduledEmails={scheduledEmails}
          sentEmails={sentEmails}
          senders={senders}
          onOpenCompose={() => setIsComposeOpen(true)}
        />

        {/* Tab Navigation & Sub-views */}
        <TabNavigation
          activeTab={activeTab}
          onTabChange={setActiveTab}
          scheduledCount={metrics?.scheduled ?? scheduledTotal}
          sentCount={metrics?.sent ?? sentTotal}
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
            onOpenCompose={() => setIsComposeOpen(true)}
          />
        )}

        {activeTab === 'sent' && (
          <SentTable
            emails={sentEmails}
            loading={tableLoading}
            onViewTimeline={handleViewTimeline}
            onSearch={(q) => fetchSent(q)}
            total={sentTotal}
            onOpenCompose={() => setIsComposeOpen(true)}
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
          poll();
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
