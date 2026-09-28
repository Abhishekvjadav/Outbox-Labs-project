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
  onSelectEmail?: (email: EmailDTO) => void;
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
  onSelectEmail,
}) => {
  const scheduledCount = metrics?.scheduled ?? scheduledTotal;
  const sentCount = metrics?.sent ?? sentTotal;
  const rateLimitedCount = metrics?.rateLimited ?? scheduledEmails.filter(
    (e) => e.status === 'RATE_LIMITED' || e.status === 'RESCHEDULED'
  ).length;
  const failedCount = metrics?.failed ?? 0;

  const totalHourlyCapacity = senders.reduce((acc, s) => acc + s.hourlyLimit, 0);

  const firstName = user.name ? user.name.split(' ')[0] : 'there';

  // Merge and sort recent activity
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
      .slice(0, 6);
  }, [sentEmails, scheduledEmails]);

  return (
    <div className="space-y-6 font-sans">
      {/* Top Welcome & Quick Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200/80">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            Welcome back, {firstName}
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Your outbound outreach overview and mailbox throughput.
          </p>
        </div>

        <div className="flex items-center space-x-2.5">
          <button
            onClick={() => onNavigate('engine')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 transition shadow-2xs"
          >
            <Cpu className="w-3.5 h-3.5 text-emerald-600" />
            <span>Engine Operations</span>
          </button>

          <button
            onClick={onOpenStudio}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 transition shadow-2xs active:scale-[0.99]"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Compose Email</span>
          </button>
        </div>
      </div>

      {/* 4 Compact Stat Pills (Clean, minimal cards) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        {/* Scheduled */}
        <div 
          onClick={() => onNavigate('scheduled')}
          className="p-3.5 rounded-xl bg-white border border-slate-200 hover:border-slate-300 transition cursor-pointer shadow-2xs group"
        >
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span className="font-medium text-slate-700 group-hover:text-emerald-700 transition-colors">
              Scheduled
            </span>
            <Clock className="w-4 h-4 text-amber-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-slate-900 tabular-nums">
              {scheduledCount}
            </span>
            <span className="text-[11px] text-amber-700 font-medium">
              In Queue
            </span>
          </div>
          <div className="mt-1.5 text-[11px] text-slate-400 flex items-center justify-between">
            <span>Pending delivery window</span>
            <ChevronRight className="w-3 h-3 text-slate-400 group-hover:text-slate-600 transition" />
          </div>
        </div>

        {/* Sent */}
        <div 
          onClick={() => onNavigate('sent')}
          className="p-3.5 rounded-xl bg-white border border-slate-200 hover:border-slate-300 transition cursor-pointer shadow-2xs group"
        >
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span className="font-medium text-slate-700 group-hover:text-emerald-700 transition-colors">
              Delivered
            </span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-slate-900 tabular-nums">
              {sentCount}
            </span>
            <span className="text-[11px] text-emerald-700 font-medium">
              SMTP Confirmed
            </span>
          </div>
          <div className="mt-1.5 text-[11px] text-slate-400 flex items-center justify-between">
            <span>100% Verified</span>
            <ChevronRight className="w-3 h-3 text-slate-400 group-hover:text-slate-600 transition" />
          </div>
        </div>

        {/* Rate Limited */}
        <div 
          onClick={() => onNavigate('scheduled')}
          className="p-3.5 rounded-xl bg-white border border-slate-200 hover:border-slate-300 transition cursor-pointer shadow-2xs group"
        >
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span className="font-medium text-slate-700 group-hover:text-emerald-700 transition-colors">
              Rate Limited
            </span>
            <ShieldCheck className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-slate-900 tabular-nums">
              {rateLimitedCount}
            </span>
            <span className="text-[11px] text-indigo-700 font-medium">
              Auto-Rollover
            </span>
          </div>
          <div className="mt-1.5 text-[11px] text-slate-400 flex items-center justify-between">
            <span>Next hourly window</span>
            <ChevronRight className="w-3 h-3 text-slate-400 group-hover:text-slate-600 transition" />
          </div>
        </div>

        {/* Failed */}
        <div 
          onClick={() => onNavigate('sent')}
          className="p-3.5 rounded-xl bg-white border border-slate-200 hover:border-slate-300 transition cursor-pointer shadow-2xs group"
        >
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span className="font-medium text-slate-700 group-hover:text-emerald-700 transition-colors">
              Failed / DLQ
            </span>
            <AlertTriangle className={`w-4 h-4 ${failedCount > 0 ? 'text-rose-500' : 'text-slate-400'}`} />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-slate-900 tabular-nums">
              {failedCount}
            </span>
            <span className={`text-[11px] font-medium ${failedCount === 0 ? 'text-slate-500' : 'text-rose-600'}`}>
              {failedCount === 0 ? 'Zero Errors' : 'Isolated'}
            </span>
          </div>
          <div className="mt-1.5 text-[11px] text-slate-400 flex items-center justify-between">
            <span>{failedCount === 0 ? 'Healthy fleet' : 'Requires review'}</span>
            <ChevronRight className="w-3 h-3 text-slate-400 group-hover:text-slate-600 transition" />
          </div>
        </div>
      </div>

      {/* Main Workspace 2-Column Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left Column (2 spans): Recent Activity List in Email-Client Row Format */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Activity className="w-4 h-4 text-emerald-600" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                Recent Outreach Activity
              </h2>
            </div>
            <div className="flex items-center space-x-3 text-xs">
              <button
                onClick={() => onNavigate('scheduled')}
                className="text-slate-500 hover:text-emerald-700 font-medium flex items-center gap-1"
              >
                <span>Scheduled ({scheduledCount})</span>
                <ArrowRight className="w-3 h-3" />
              </button>
              <span className="text-slate-200">|</span>
              <button
                onClick={() => onNavigate('sent')}
                className="text-slate-500 hover:text-emerald-700 font-medium flex items-center gap-1"
              >
                <span>Sent ({sentCount})</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          </div>

          {recentActivity.length === 0 ? (
            <div className="py-12 text-center space-y-2">
              <Mail className="w-8 h-8 text-slate-300 mx-auto" />
              <p className="text-xs font-medium text-slate-700">No outbound activity yet</p>
              <p className="text-[11px] text-slate-400">Launch a campaign to see live delivery updates.</p>
              <button
                onClick={onOpenStudio}
                className="mt-2 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Compose Campaign</span>
              </button>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 text-xs">
              {recentActivity.map((email) => {
                const isSent = email.status === 'SENT';
                const timeString = isSent && email.sentAt
                  ? format(new Date(email.sentAt), 'h:mm a')
                  : email.scheduledAt
                  ? format(new Date(email.scheduledAt), 'h:mm a')
                  : 'Pending';

                const relative = isSent && email.sentAt
                  ? formatDistanceToNow(new Date(email.sentAt), { addSuffix: true })
                  : email.scheduledAt
                  ? `in ${formatDistanceToNow(new Date(email.scheduledAt))}`
                  : '';

                return (
                  <div
                    key={email.id}
                    onClick={() => onSelectEmail ? onSelectEmail(email) : onViewTimeline(email)}
                    className="px-4 py-2.5 hover:bg-slate-50/80 transition-colors cursor-pointer flex items-center justify-between gap-3 group"
                  >
                    <div className="min-w-0 flex items-center space-x-3">
                      <div className="w-6 h-6 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600 font-semibold text-[10px] flex-shrink-0">
                        {email.recipient.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-900 truncate group-hover:text-emerald-700 transition-colors">
                          {email.recipient}
                        </p>
                        <p className="text-[11px] text-slate-500 truncate">
                          {email.subject || '(No Subject)'}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center space-x-2 flex-shrink-0 text-right">
                      <div>
                        <span
                          className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium border ${
                            isSent
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-amber-50 text-amber-700 border-amber-200'
                          }`}
                        >
                          {email.status}
                        </span>
                        <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                          {timeString} ({relative})
                        </p>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-600 transition" />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Column (1 span): Delivery Capacity & Mailboxes */}
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <div className="flex items-center space-x-1.5">
                <Mail className="w-4 h-4 text-emerald-600" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                  Fleet Capacity
                </h3>
              </div>
              <button
                onClick={() => onNavigate('senders')}
                className="text-[11px] font-medium text-emerald-700 hover:text-emerald-800"
              >
                Manage
              </button>
            </div>

            {/* Capacity Total */}
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
              <div className="text-xs text-slate-500">Total Throughput</div>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="text-xl font-bold font-mono text-slate-900 tabular-nums">
                  {totalHourlyCapacity}
                </span>
                <span className="text-xs text-slate-500 font-mono">emails / hr</span>
              </div>
              <p className="text-[10px] text-slate-400 mt-1 font-mono">
                Paced with 2,000ms inter-send delay
              </p>
            </div>

            {/* Mailbox List */}
            <div className="space-y-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block">
                Connected Inboxes ({senders.length})
              </span>
              <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                {senders.map((s) => (
                  <div
                    key={s.id}
                    className="p-2 rounded-lg bg-slate-50/70 border border-slate-100 flex items-center justify-between text-xs"
                  >
                    <div className="min-w-0 pr-2">
                      <div className="font-semibold text-slate-800 truncate">{s.name}</div>
                      <div className="text-[10px] text-slate-400 font-mono truncate">{s.email}</div>
                    </div>
                    <span className="text-[10px] font-mono text-slate-600 font-semibold bg-white px-1.5 py-0.5 rounded border border-slate-200">
                      {s.hourlyLimit}/hr
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
