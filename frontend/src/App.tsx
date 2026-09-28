import { useState, useEffect, useCallback } from 'react';
import { apiClient } from './lib/api';
import { UserDTO, SenderDTO, EmailDTO, EmailEventDTO, SystemHealthDTO, EmailMetricsDTO } from '@reachflow/shared';
import { Sidebar, NavigationTab } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { OverviewView } from './components/dashboard/OverviewView';
import { EngineView } from './components/engine/EngineView';
import { CampaignStudio } from './components/campaign/CampaignStudio';
import { ScheduledTable } from './components/emails/ScheduledTable';
import { SentTable } from './components/emails/SentTable';
import { EmailDetailView } from './components/emails/EmailDetailView';
import { SendersView } from './components/senders/SendersView';
import { SlackSettingsCard } from './components/integrations/SlackSettingsCard';
import { DeliveryTimelineModal } from './components/emails/DeliveryTimelineModal';
import { LoginPage } from './components/auth/LoginPage';

export function App() {
  const [user, setUser] = useState<(UserDTO & { slackConnection?: any }) | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<NavigationTab>('scheduled');

  // Telemetry & Metrics
  const [health, setHealth] = useState<(SystemHealthDTO & { queueCounts?: any }) | null>(null);
  const [metrics, setMetrics] = useState<EmailMetricsDTO | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Core Data
  const [senders, setSenders] = useState<SenderDTO[]>([]);
  const [scheduledEmails, setScheduledEmails] = useState<EmailDTO[]>([]);
  const [sentEmails, setSentEmails] = useState<EmailDTO[]>([]);
  const [scheduledTotal, setScheduledTotal] = useState(0);
  const [sentTotal, setSentTotal] = useState(0);
  const [tableLoading, setTableLoading] = useState(false);

  // Selected Email (Reading / Detail View)
  const [selectedEmail, setSelectedEmail] = useState<EmailDTO | null>(null);

  // Global Header Search
  const [searchQuery, setSearchQuery] = useState('');

  // Delivery Timeline Modal
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
    } else if (tabParam === 'engine') {
      setActiveTab('engine');
    } else if (tabParam === 'scheduled') {
      setActiveTab('scheduled');
    } else if (tabParam === 'sent') {
      setActiveTab('sent');
    } else if (tabParam === 'overview') {
      setActiveTab('overview');
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
      const query = q !== undefined ? q : searchQuery;
      if (query && query.trim().length > 0) {
        const res = await apiClient.searchEmails(query, 'SCHEDULED');
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
  }, [user, searchQuery]);

  // Fetch Sent Emails
  const fetchSent = useCallback(async (q?: string) => {
    if (!user) return;
    setTableLoading(true);
    try {
      const query = q !== undefined ? q : searchQuery;
      if (query && query.trim().length > 0) {
        const res = await apiClient.searchEmails(query, 'SENT');
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
  }, [user, searchQuery]);

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

  const handleManualRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        poll(),
        fetchSenders(),
        fetchScheduled(),
        fetchSent(),
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  // Poll Health, Metrics & Tables every 4s
  useEffect(() => {
    if (!user) return;

    poll();
    fetchSenders();
    fetchScheduled();
    fetchSent();

    const interval = setInterval(() => {
      poll();
      if (activeTab === 'scheduled' || activeTab === 'overview') fetchScheduled();
      if (activeTab === 'sent' || activeTab === 'overview') fetchSent();
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
      if (selectedEmail?.id === emailId) {
        setSelectedEmail(null);
      }
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleLogout = async () => {
    await apiClient.logout();
    setUser(null);
  };

  const handleTabChange = (tab: NavigationTab) => {
    setActiveTab(tab);
    setSelectedEmail(null);
    setSearchQuery('');
  };

  const handleSearch = (q: string) => {
    setSearchQuery(q);
    if (activeTab === 'scheduled') {
      fetchScheduled(q);
    } else if (activeTab === 'sent') {
      fetchSent(q);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-sans">
        <div className="bg-white border border-slate-200 p-6 rounded-xl shadow-card max-w-xs w-full space-y-3 text-center">
          <div className="mx-auto w-9 h-9 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center">
            <div className="w-4 h-4 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-slate-900 tracking-tight">Starting ReachFlow</h3>
            <p className="text-[11px] text-slate-500 font-mono mt-0.5">Connecting to message queue...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage onLoginSuccess={fetchUser} />;
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex selection:bg-emerald-500 selection:text-white font-sans antialiased">
      {/* 1. Persistent Left Sidebar (Narrow & Clean) */}
      <Sidebar
        activeTab={activeTab}
        onTabChange={handleTabChange}
        scheduledCount={metrics?.scheduled ?? scheduledTotal}
        sentCount={metrics?.sent ?? sentTotal}
        sendersCount={senders.length}
        senders={senders}
        user={user}
        health={health}
        onLogout={handleLogout}
        onOpenStudio={() => {
          setActiveTab('studio');
          setSelectedEmail(null);
        }}
      />

      {/* 2. Main Workspace Canvas */}
      <div className="flex-1 min-w-0 flex flex-col min-h-screen bg-slate-50">
        {/* Top Header Bar */}
        <Header
          activeTab={activeTab}
          user={user}
          health={health}
          onOpenStudio={() => {
            setActiveTab('studio');
            setSelectedEmail(null);
          }}
          onRefresh={handleManualRefresh}
          refreshing={refreshing}
          searchQuery={searchQuery}
          onSearchChange={activeTab === 'scheduled' || activeTab === 'sent' ? handleSearch : undefined}
        />

        {/* Workspace Content View */}
        <main className="flex-1 p-5 lg:p-6 max-w-6xl w-full mx-auto">
          {/* Detail Reading View (if email is selected) */}
          {selectedEmail ? (
            <EmailDetailView
              email={selectedEmail}
              onBack={() => setSelectedEmail(null)}
              onCancelEmail={handleCancelEmail}
              onViewTimeline={handleViewTimeline}
            />
          ) : (
            <>
              {/* View: Scheduled Pipeline */}
              {activeTab === 'scheduled' && (
                <ScheduledTable
                  emails={scheduledEmails}
                  loading={tableLoading}
                  onViewTimeline={handleViewTimeline}
                  onCancelEmail={handleCancelEmail}
                  onSearch={(q) => fetchScheduled(q)}
                  total={scheduledTotal}
                  onOpenCompose={() => setActiveTab('studio')}
                  onSelectEmail={(email) => setSelectedEmail(email)}
                />
              )}

              {/* View: Delivered (Sent) */}
              {activeTab === 'sent' && (
                <SentTable
                  emails={sentEmails}
                  loading={tableLoading}
                  onViewTimeline={handleViewTimeline}
                  onSearch={(q) => fetchSent(q)}
                  total={sentTotal}
                  onOpenCompose={() => setActiveTab('studio')}
                  onSelectEmail={(email) => setSelectedEmail(email)}
                />
              )}

              {/* View: Compose New Email (Campaign Studio) */}
              {activeTab === 'studio' && (
                <CampaignStudio
                  senders={senders}
                  onCampaignCreated={() => {
                    poll();
                    fetchScheduled();
                    setActiveTab('scheduled');
                  }}
                  onCancel={() => setActiveTab('scheduled')}
                />
              )}

              {/* View: Overview Summary */}
              {activeTab === 'overview' && (
                <OverviewView
                  user={user}
                  metrics={metrics}
                  scheduledTotal={scheduledTotal}
                  sentTotal={sentTotal}
                  scheduledEmails={scheduledEmails}
                  sentEmails={sentEmails}
                  senders={senders}
                  onOpenStudio={() => setActiveTab('studio')}
                  onViewTimeline={handleViewTimeline}
                  onNavigate={(tab) => handleTabChange(tab)}
                  onSelectEmail={(email) => setSelectedEmail(email)}
                />
              )}

              {/* View: Engine Telemetry (Operations -> Engine) */}
              {activeTab === 'engine' && (
                <EngineView
                  health={health}
                  metrics={metrics}
                  scheduledTotal={scheduledTotal}
                  sentTotal={sentTotal}
                  scheduledEmails={scheduledEmails}
                  sentEmails={sentEmails}
                  senders={senders}
                />
              )}

              {/* View: Mailboxes (Connected Senders) */}
              {activeTab === 'senders' && (
                <SendersView senders={senders} onSenderCreated={fetchSenders} />
              )}

              {/* View: Settings (Slack Integration) */}
              {activeTab === 'slack' && (
                <SlackSettingsCard slackConnection={user.slackConnection} onRefresh={fetchUser} />
              )}
            </>
          )}
        </main>
      </div>

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
