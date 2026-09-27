import React, { useMemo } from 'react';
import { 
  Plus, 
  Clock, 
  CheckCircle2, 
  ShieldCheck, 
  AlertTriangle, 
  Mail, 
  ArrowRight, 
  Activity, 
  Cpu, 
  ChevronRight
} from 'lucide-react';
import { UserDTO, SenderDTO, EmailDTO, EmailMetricsDTO } from '@reachflow/shared';
import { NavigationTab } from '../layout/Sidebar';
import { formatDistanceToNow, format } from 'date-fns';

interface OverviewViewProps {
  user: UserDTO;
  metrics: EmailMetricsDTO | null;
  scheduledTotal: number;
  sentTotal: number;
  scheduledEmails: EmailDTO[];
  sentEmails: EmailDTO[];
  senders: SenderDTO[];
  onOpenStudio: () => void;
  onViewTimeline: (email: EmailDTO) => void;
  onNavigate: (tab: NavigationTab) => void;
}

export const OverviewView: React.FC<OverviewViewProps> = ({
  user,
  metrics,
  scheduledTotal,
  sentTotal,
  scheduledEmails,
  sentEmails,
  senders,
  onOpenStudio,
  onViewTimeline,
  onNavigate,
}) => {
  // Metrics semantics:
  const scheduledCount = metrics?.scheduled ?? scheduledTotal;
  const sentCount = metrics?.sent ?? sentTotal;
  const rateLimitedCount = metrics?.rateLimited ?? scheduledEmails.filter(
    (e) => e.status === 'RATE_LIMITED' || e.status === 'RESCHEDULED'
  ).length;
  const failedCount = metrics?.failed ?? 0;

  const totalHourlyCapacity = senders.reduce((acc, s) => acc + s.hourlyLimit, 0);

  // Time-based greeting
  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  }, []);

  const firstName = user.name ? user.name.split(' ')[0] : 'there';

  // Merge and sort recent activity (most recent first)
  const recentActivity = useMemo(() => {
    const combined: (EmailDTO & { activityType: 'sent' | 'scheduled' })[] = [
      ...sentEmails.slice(0, 10).map((e) => ({ ...e, activityType: 'sent' as const })),
      ...scheduledEmails.slice(0, 10).map((e) => ({ ...e, activityType: 'scheduled' as const })),
    ];

    return combined
      .sort((a, b) => {
        const timeA = new Date(a.sentAt || a.scheduledAt || (a as any).createdAt || 0).getTime();
        const timeB = new Date(b.sentAt || b.scheduledAt || (b as any).createdAt || 0).getTime();
        return timeB - timeA;
      })
      .slice(0, 7);
  }, [sentEmails, scheduledEmails]);

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Homepage Greeting & Primary New Campaign CTA */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-1">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <span>{greeting}, {firstName}</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Your outbound campaigns, delivery pipelines, and sender fleet capacity at a glance.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => onNavigate('engine')}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-slate-300 bg-surface-card hover:bg-surface-50 border border-white/[0.08] hover:border-white/[0.15] transition-colors shadow-sm"
          >
            <Cpu className="w-3.5 h-3.5 text-brand-400" />
            <span>Engine Telemetry</span>
          </button>
        </div>
      </div>

      {/* 4 Primary KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        {/* KPI 1: Scheduled */}
        <div 
          onClick={() => onNavigate('scheduled')}
          className="p-4 rounded-xl bg-surface-card border border-white/[0.07] hover:border-white/[0.15] transition-all cursor-pointer shadow-sm group"
        >
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span className="font-medium text-slate-300 group-hover:text-white transition-colors">
              Scheduled
            </span>
            <div className="w-7 h-7 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
              <Clock className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-white tabular-nums">
              {scheduledCount}
            </span>
            <span className="text-[11px] text-sky-400/80 font-mono">
              In Pipeline
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400 pt-2 border-t border-white/[0.04]">
            <span>Awaiting delivery window</span>
            <ChevronRight className="w-3 h-3 text-slate-400 group-hover:text-slate-200 transition-colors" />
          </div>
        </div>

        {/* KPI 2: Sent */}
        <div 
          onClick={() => onNavigate('sent')}
          className="p-4 rounded-xl bg-surface-card border border-white/[0.07] hover:border-white/[0.15] transition-all cursor-pointer shadow-sm group"
        >
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span className="font-medium text-slate-300 group-hover:text-white transition-colors">
              Delivered (Sent)
            </span>
            <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-white tabular-nums">
              {sentCount}
            </span>
            <span className="text-[11px] text-emerald-400/80 font-mono">
              PostgreSQL Verified
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400 pt-2 border-t border-white/[0.04]">
            <span>100% SMTP confirmed</span>
            <ChevronRight className="w-3 h-3 text-slate-400 group-hover:text-slate-200 transition-colors" />
          </div>
        </div>

        {/* KPI 3: Rate Limited / Rescheduled */}
        <div 
          onClick={() => onNavigate('scheduled')}
          className="p-4 rounded-xl bg-surface-card border border-white/[0.07] hover:border-white/[0.15] transition-all cursor-pointer shadow-sm group"
        >
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span className="font-medium text-slate-300 group-hover:text-white transition-colors">
              Rate Limited
            </span>
            <div className="w-7 h-7 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <ShieldCheck className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-white tabular-nums">
              {rateLimitedCount}
            </span>
            <span className="text-[11px] text-indigo-400/80 font-mono">
              Auto-Rollover
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400 pt-2 border-t border-white/[0.04]">
            <span>Queued for next window</span>
            <ChevronRight className="w-3 h-3 text-slate-400 group-hover:text-slate-200 transition-colors" />
          </div>
        </div>

        {/* KPI 4: Failed / DLQ */}
        <div 
          onClick={() => onNavigate('sent')}
          className="p-4 rounded-xl bg-surface-card border border-white/[0.07] hover:border-white/[0.15] transition-all cursor-pointer shadow-sm group"
        >
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span className="font-medium text-slate-300 group-hover:text-white transition-colors">
              Failed / DLQ
            </span>
            <div className={`w-7 h-7 rounded-lg flex items-center justify-center border ${
              failedCount === 0 
                ? 'bg-slate-800/40 border-slate-700/50 text-slate-400' 
                : 'bg-rose-500/10 border-rose-500/20 text-rose-400'
            }`}>
              <AlertTriangle className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-white tabular-nums">
              {failedCount}
            </span>
            <span className={`text-[11px] font-mono ${failedCount === 0 ? 'text-slate-400' : 'text-rose-400'}`}>
              {failedCount === 0 ? 'Zero Errors' : 'Requires Review'}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400 pt-2 border-t border-white/[0.04]">
            <span>{failedCount === 0 ? 'Healthy pipeline' : 'Failed dispatches'}</span>
            <ChevronRight className="w-3 h-3 text-slate-400 group-hover:text-slate-200 transition-colors" />
          </div>
        </div>
      </div>

      {/* Main 2-Column Section: Recent Activity + Delivery Capacity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left Column (2 spans): Recent Activity Feed */}
        <div className="lg:col-span-2 p-5 rounded-xl bg-surface-card border border-white/[0.08] shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b border-white/[0.06] pb-3 mb-3">
              <div className="flex items-center space-x-2">
                <Activity className="w-4 h-4 text-brand-400" />
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                  Recent Campaign Activity
                </h2>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => onNavigate('scheduled')}
                  className="text-xs font-medium text-slate-400 hover:text-brand-400 transition-colors flex items-center gap-1"
                >
                  <span>Scheduled ({scheduledCount})</span>
                  <ArrowRight className="w-3 h-3" />
                </button>
                <span className="text-slate-700">|</span>
                <button
                  onClick={() => onNavigate('sent')}
                  className="text-xs font-medium text-slate-400 hover:text-brand-400 transition-colors flex items-center gap-1"
                >
                  <span>Sent ({sentCount})</span>
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            </div>

            {recentActivity.length === 0 ? (
              <div className="py-12 text-center space-y-3">
                <div className="w-10 h-10 rounded-xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center text-slate-400 mx-auto">
                  <Mail className="w-5 h-5 text-slate-400" />
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-300">No outbound activity yet</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Launch your first campaign sequence to see real-time delivery telemetry.
                  </p>
                </div>
                <button
                  onClick={onOpenStudio}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-brand-400 hover:text-brand-300 bg-brand-500/10 hover:bg-brand-500/20 border border-brand-500/20 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Launch Campaign</span>
                </button>
              </div>
            ) : (
              <div className="divide-y divide-white/[0.04]">
                {recentActivity.map((email) => {
                  const isSent = email.status === 'SENT';
                  const isRescheduled = email.status === 'RESCHEDULED' || email.status === 'RATE_LIMITED';
                  const isProcessing = email.status === 'PROCESSING';

                  const timeString = isSent && email.sentAt
                    ? format(new Date(email.sentAt), 'HH:mm:ss')
                    : email.scheduledAt
                    ? format(new Date(email.scheduledAt), 'HH:mm:ss')
                    : 'Pending';

                  const relativeTime = isSent && email.sentAt
                    ? formatDistanceToNow(new Date(email.sentAt), { addSuffix: true })
                    : email.scheduledAt
                    ? `in ${formatDistanceToNow(new Date(email.scheduledAt))}`
                    : '';

                  return (
                    <div
                      key={email.id}
                      onClick={() => onViewTimeline(email)}
                      className="py-2.5 px-2 -mx-2 rounded-lg hover:bg-white/[0.03] transition-colors cursor-pointer flex items-center justify-between gap-3 group"
                    >
                      <div className="min-w-0 flex items-center gap-3">
                        <div className="w-7 h-7 rounded-lg bg-surface-overlay border border-white/[0.06] flex items-center justify-center flex-shrink-0 text-slate-400 group-hover:text-white transition-colors">
                          <Mail className="w-3.5 h-3.5" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-slate-200 truncate group-hover:text-brand-300 transition-colors">
                            {email.recipient}
                          </p>
                          <p className="text-[11px] text-slate-400 truncate">
                            {email.subject || 'No subject'}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 flex-shrink-0 text-right">
                        <div>
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-medium border ${
                              isSent
                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                : isRescheduled
                                ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20'
                                : isProcessing
                                ? 'bg-sky-500/10 text-sky-400 border-sky-500/20'
                                : 'bg-slate-800 text-slate-300 border-slate-700'
                            }`}
                          >
                            {email.status}
                          </span>
                          <p className="text-[10px] font-mono text-slate-400 mt-0.5">
                            {timeString} <span className="opacity-75">({relativeTime})</span>
                          </p>
                        </div>
                        <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-300 transition-colors" />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="pt-3 mt-2 border-t border-white/[0.04] flex items-center justify-between text-xs text-slate-400">
            <span>Showing recent delivery dispatches</span>
            <span className="font-mono text-[11px] text-slate-400">Click row for full timeline</span>
          </div>
        </div>

        {/* Right Column (1 span): Delivery Capacity & Mailbox Fleet */}
        <div className="p-5 rounded-xl bg-surface-card border border-white/[0.08] shadow-sm flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center justify-between border-b border-white/[0.06] pb-3 mb-3">
              <div className="flex items-center space-x-2">
                <Mail className="w-4 h-4 text-brand-400" />
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                  Delivery Capacity
                </h2>
              </div>
              <button
                onClick={() => onNavigate('senders')}
                className="text-[11px] font-medium text-brand-400 hover:text-brand-300 transition-colors"
              >
                Manage
              </button>
            </div>

            {/* Capacity Highlight Box */}
            <div className="p-3.5 rounded-lg bg-surface-overlay/80 border border-white/[0.06] space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">Total Fleet Throughput</span>
                <span className="text-xs font-bold font-mono text-emerald-400">Active</span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold font-mono text-white tabular-nums">
                  {totalHourlyCapacity}
                </span>
                <span className="text-xs text-slate-400 font-mono">emails / hour</span>
              </div>
              <div className="text-[11px] text-slate-400 pt-1 border-t border-white/[0.04]">
                <span>Paced with <strong>2,000ms</strong> inter-send throttle interval</span>
              </div>
            </div>

            {/* Mailbox List */}
            <div className="mt-4 space-y-2">
              <p className="text-[10px] font-mono font-semibold uppercase tracking-wider text-slate-400">
                Connected Mailboxes ({senders.length})
              </p>
              <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                {senders.map((s) => (
                  <div
                    key={s.id}
                    className="p-2.5 rounded-lg bg-surface-overlay/40 border border-white/[0.04] flex items-center justify-between text-xs"
                  >
                    <div className="min-w-0 pr-2">
                      <div className="flex items-center space-x-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
                        <span className="font-medium text-slate-200 truncate">{s.name}</span>
                      </div>
                      <p className="text-[10px] font-mono text-slate-400 truncate pl-3">{s.email}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <span className="text-[11px] font-mono font-semibold text-slate-300">
                        {s.hourlyLimit}/hr
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Quick Engine Link */}
          <div className="pt-3 border-t border-white/[0.04]">
            <button
              onClick={() => onNavigate('engine')}
              className="w-full flex items-center justify-between p-2 rounded-lg bg-white/[0.02] hover:bg-white/[0.05] border border-white/[0.06] text-xs text-slate-300 hover:text-white transition-colors"
            >
              <div className="flex items-center space-x-2">
                <Cpu className="w-3.5 h-3.5 text-brand-400" />
                <span>Outbound Engine Status</span>
              </div>
              <span className="text-[10px] font-mono text-emerald-400 flex items-center gap-1">
                <span>Healthy</span>
                <ChevronRight className="w-3 h-3 text-slate-400" />
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
