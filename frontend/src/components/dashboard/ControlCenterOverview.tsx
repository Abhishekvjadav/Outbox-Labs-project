import React from 'react';
import { SystemHealthDTO, SenderDTO, EmailDTO, EmailMetricsDTO } from '@reachflow/shared';
import { 
  Database, 
  Cpu, 
  Radio, 
  Search, 
  Slack, 
  Clock, 
  CheckCircle2, 
  AlertTriangle, 
  ShieldCheck, 
  Send, 
  Layers,
  Activity,
  ArrowUpRight
} from 'lucide-react';

interface ControlCenterOverviewProps {
  health: (SystemHealthDTO & { queueCounts?: any }) | null;
  metrics: EmailMetricsDTO | null;
  scheduledTotal: number;
  sentTotal: number;
  scheduledEmails: EmailDTO[];
  sentEmails: EmailDTO[];
  senders: SenderDTO[];
  onOpenCompose: () => void;
}

export const ControlCenterOverview: React.FC<ControlCenterOverviewProps> = ({
  health,
  metrics,
  scheduledTotal,
  sentTotal: _sentTotal,
  scheduledEmails,
  sentEmails,
  senders,
  onOpenCompose,
}) => {
  // Metric semantics:
  // 1. Scheduled: backend aggregate of scheduled/queued/processing/rate-limited/rescheduled emails
  const scheduledCount = metrics ? metrics.scheduled : scheduledTotal;

  // 2. Delivered: PostgreSQL SENT only (does not count FAILED or BullMQ completed jobs)
  const deliveredCount = metrics ? metrics.sent : sentEmails.filter((e) => e.status === 'SENT').length;

  // 3. Rate Limited: backend aggregate count across entire DB (not limited to first 50 emails)
  const rateLimitedCount = metrics ? metrics.rateLimited : scheduledEmails.filter(
    (e) => e.status === 'RATE_LIMITED' || e.status === 'RESCHEDULED'
  ).length;

  // 4. Failed / DLQ: user FAILED emails only (without adding global cluster BullMQ failed count)
  const failedCount = metrics ? metrics.failed : sentEmails.filter((e) => e.status === 'FAILED').length;

  const processingCount = scheduledEmails.filter((e) => e.status === 'PROCESSING').length;

  const totalHourlyCapacity = senders.reduce((acc, s) => acc + s.hourlyLimit, 0);

  const isHealthy = health?.status === 'healthy';
  const isDegraded = health?.status === 'degraded';

  const queueCounts = health?.queueCounts || {
    active: 0,
    delayed: 0,
    waiting: 0,
    completed: 0,
    failed: 0,
  };

  return (
    <div className="space-y-4">
      {/* Top Banner: Control Center Header & Engine State */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-1">
        <div>
          <div className="flex items-center space-x-2.5">
            <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
              <span>ReachFlow Control Center</span>
            </h1>
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-medium border ${
                isHealthy
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  : isDegraded
                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                  : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${isHealthy ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
              {isHealthy ? 'ENGINE OPERATIONAL' : isDegraded ? 'ENGINE DEGRADED' : 'SYSTEM OFFLINE'}
            </span>
            <span className="text-[10px] font-mono text-slate-500 hidden sm:inline-block">
              LIVE TELEMETRY (4S TICK)
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl leading-relaxed">
            Autonomous cold email infrastructure. Zero-loss PostgreSQL persistence, BullMQ Redis delayed queues, and atomic Lua rate limiting.
          </p>
        </div>

        <div className="flex items-center gap-2.5 self-start md:self-auto">
          <a
            href="/admin/queues"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-300 bg-surface-card hover:bg-surface-50 border border-white/[0.08] hover:border-white/[0.15] transition shadow-inset-subtle"
          >
            <span>Bull Board</span>
            <ArrowUpRight className="w-3.5 h-3.5 text-slate-400" />
          </a>
          <button
            onClick={onOpenCompose}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-brand-600 hover:bg-brand-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_2px_4px_rgba(0,0,0,0.3)] transition active:scale-[0.98]"
          >
            <Send className="w-3.5 h-3.5" />
            <span>New Dispatch</span>
          </button>
        </div>
      </div>

      {/* 4 High-Density Operational Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Metric 1: Scheduled / Queued */}
        <div className="p-3.5 rounded-xl bg-surface-card border border-white/[0.07] shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span className="font-medium text-slate-300">Scheduled Queue</span>
            <Clock className="w-4 h-4 text-sky-400/80" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-white tabular-nums">
              {scheduledCount}
            </span>
            <span className="text-[11px] text-slate-400 font-mono">
              ({queueCounts.delayed || scheduledCount} delayed)
            </span>
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-400">
            <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
            <span>{processingCount > 0 ? `${processingCount} processing now` : 'BullMQ ZSET standby'}</span>
          </div>
        </div>

        {/* Metric 2: Delivered */}
        <div className="p-3.5 rounded-xl bg-surface-card border border-white/[0.07] shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span className="font-medium text-slate-300">Delivered (Sent)</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400/80" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-white tabular-nums">
              {deliveredCount}
            </span>
            <span className="text-[11px] text-emerald-400/80 font-mono">
              PostgreSQL SENT
            </span>
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-400 truncate">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span>SMTP 250 confirmed (Sent only)</span>
          </div>
        </div>

        {/* Metric 3: Rate Limited / Rescheduled */}
        <div className="p-3.5 rounded-xl bg-surface-card border border-white/[0.07] shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span className="font-medium text-slate-300">Rate Limited</span>
            <ShieldCheck className="w-4 h-4 text-indigo-400/80" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-white tabular-nums">
              {rateLimitedCount}
            </span>
            <span className="text-[11px] text-indigo-400/80 font-mono">
              Auto-Rollover
            </span>
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-400">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
            <span>Backend aggregate (next window)</span>
          </div>
        </div>

        {/* Metric 4: Failed / DLQ */}
        <div className="p-3.5 rounded-xl bg-surface-card border border-white/[0.07] shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span className="font-medium text-slate-300">Failed / DLQ</span>
            <AlertTriangle className="w-4 h-4 text-rose-400/80" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-white tabular-nums">
              {failedCount}
            </span>
            <span className={`text-[11px] font-mono ${failedCount === 0 ? 'text-slate-400' : 'text-rose-400'}`}>
              {failedCount === 0 ? '0 dropped' : 'User emails failed'}
            </span>
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-400">
            <span className={`w-1.5 h-1.5 rounded-full ${failedCount === 0 ? 'bg-emerald-400' : 'bg-rose-400'}`} />
            <span>{failedCount === 0 ? 'User delivery healthy' : 'PostgreSQL FAILED records'}</span>
          </div>
        </div>
      </div>

      {/* Prominent "Outbound Engine" Telemetry Deck */}
      <div className="p-4 rounded-xl bg-surface-card border border-white/[0.08] shadow-sm space-y-3.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/[0.06] pb-3">
          <div className="flex items-center space-x-2">
            <Activity className="w-4 h-4 text-brand-400" />
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-200">
              Outbound Engine Infrastructure
            </h2>
            <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-white/[0.04] text-slate-400 border border-white/[0.06]">
              5 Core Subsystems
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs font-mono text-slate-400">
            <span>Fleet Capacity: <strong className="text-white">{totalHourlyCapacity}/hr</strong></span>
            <span className="text-slate-600">|</span>
            <span>Mailboxes: <strong className="text-white">{senders.length} active</strong></span>
          </div>
        </div>

        {/* 5 Core Nodes Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
          {/* Node 1: PostgreSQL */}
          <div className="p-3 rounded-lg bg-surface-overlay/80 border border-white/[0.05] space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-slate-400" />
                <span>PostgreSQL 16</span>
              </span>
              {health?.services.postgres.status === 'healthy' ? (
                <span className="w-2 h-2 rounded-full bg-emerald-400" title="Connected" />
              ) : (
                <span className="w-2 h-2 rounded-full bg-rose-400" title="Error" />
              )}
            </div>
            <div className="text-[11px] text-slate-400 flex justify-between pt-1">
              <span>Latency:</span>
              <span className="font-mono text-slate-200">{health?.services.postgres.latencyMs ?? 1}ms</span>
            </div>
            <div className="text-[10px] text-slate-400 truncate">ACID Event Log</div>
          </div>

          {/* Node 2: Redis */}
          <div className="p-3 rounded-lg bg-surface-overlay/80 border border-white/[0.05] space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-slate-400" />
                <span>Redis 7.2</span>
              </span>
              {health?.services.redis.status === 'healthy' ? (
                <span className="w-2 h-2 rounded-full bg-emerald-400" title="Connected" />
              ) : (
                <span className="w-2 h-2 rounded-full bg-rose-400" title="Error" />
              )}
            </div>
            <div className="text-[11px] text-slate-400 flex justify-between pt-1">
              <span>Latency:</span>
              <span className="font-mono text-slate-200">{health?.services.redis.latencyMs ?? 1}ms</span>
            </div>
            <div className="text-[10px] text-slate-400 truncate">Lua Rate Limiter</div>
          </div>

          {/* Node 3: BullMQ Workers */}
          <div className="p-3 rounded-lg bg-surface-overlay/80 border border-white/[0.05] space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5 text-slate-400" />
                <span>BullMQ Fleet</span>
              </span>
              <span className="w-2 h-2 rounded-full bg-emerald-400" title="Healthy" />
            </div>
            <div className="text-[11px] text-slate-400 flex justify-between pt-1">
              <span>Concurrency:</span>
              <span className="font-mono text-slate-200">{health?.services.bullmqWorker.concurrency || 5}x</span>
            </div>
            <div className="text-[10px] text-slate-400 truncate">
              {queueCounts.active} active / {queueCounts.delayed} delayed
            </div>
          </div>

          {/* Node 4: Elasticsearch */}
          <div className="p-3 rounded-lg bg-surface-overlay/80 border border-white/[0.05] space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
                <Search className="w-3.5 h-3.5 text-slate-400" />
                <span>Elasticsearch</span>
              </span>
              {health?.services.elasticsearch.status === 'healthy' ? (
                <span className="w-2 h-2 rounded-full bg-emerald-400" title="Healthy" />
              ) : health?.services.elasticsearch.status === 'disabled' ? (
                <span className="w-2 h-2 rounded-full bg-amber-400" title="Fallback active" />
              ) : (
                <span className="w-2 h-2 rounded-full bg-slate-500" title="Offline" />
              )}
            </div>
            <div className="text-[11px] text-slate-400 flex justify-between pt-1">
              <span>Status:</span>
              <span className="font-mono text-slate-200">
                {health?.services.elasticsearch.status === 'healthy' ? 'Indexed' : 'Standby'}
              </span>
            </div>
            <div className="text-[10px] text-slate-400 truncate">Full-Text Ingestion</div>
          </div>

          {/* Node 5: Slack Alerts */}
          <div className="p-3 rounded-lg bg-surface-overlay/80 border border-white/[0.05] space-y-1 col-span-2 sm:col-span-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
                <Slack className="w-3.5 h-3.5 text-slate-400" />
                <span>Slack Alerts</span>
              </span>
              <span
                className={`w-2 h-2 rounded-full ${
                  health?.services.slack.status === 'connected' ? 'bg-emerald-400' : 'bg-slate-500'
                }`}
                title={health?.services.slack.status}
              />
            </div>
            <div className="text-[11px] text-slate-400 flex justify-between pt-1">
              <span>Alert Hook:</span>
              <span className="font-mono text-slate-200">
                {health?.services.slack.status === 'connected' ? 'Armed' : 'Standby'}
              </span>
            </div>
            <div className="text-[10px] text-slate-400 truncate">1-Hr Dedup Lock</div>
          </div>
        </div>

        {/* Live BullMQ Queue Breakdown Bar */}
        <div className="pt-1 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-400 bg-surface-overlay/40 px-3 py-2 rounded-lg border border-white/[0.04]">
          <div className="flex items-center gap-1.5 text-slate-300 font-sans text-xs">
            <Radio className="w-3.5 h-3.5 text-brand-400 animate-pulse" />
            <span className="font-semibold">BullMQ Queue Pipeline</span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/[0.05] text-slate-400 border border-white/[0.06]">
              Cluster Telemetry
            </span>
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            <span title="Pending execution in memory">
              Waiting: <strong className="text-white">{queueCounts.waiting}</strong>
            </span>
            <span title="Currently being processed by workers">
              Active: <strong className="text-amber-400">{queueCounts.active}</strong>
            </span>
            <span title="Scheduled in BullMQ delayed set">
              Delayed: <strong className="text-sky-400">{queueCounts.delayed}</strong>
            </span>
            <span title="Cluster-level BullMQ job completions (Redis queue telemetry, distinct from user emails sent)">
              BullMQ Completed: <strong className="text-emerald-400">{queueCounts.completed}</strong>
            </span>
            <span title="Cluster-level BullMQ job failures (Redis queue telemetry, distinct from user email failures)">
              BullMQ Failed: <strong className={queueCounts.failed > 0 ? 'text-rose-400' : 'text-slate-400'}>{queueCounts.failed}</strong>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
