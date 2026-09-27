import React from 'react';
import { 
  SystemHealthDTO, 
  SenderDTO, 
  EmailDTO, 
  EmailMetricsDTO 
} from '@reachflow/shared';
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
  Layers,
  ArrowUpRight,
  Server
} from 'lucide-react';

interface EngineViewProps {
  health: (SystemHealthDTO & { queueCounts?: any }) | null;
  metrics: EmailMetricsDTO | null;
  scheduledTotal: number;
  sentTotal: number;
  scheduledEmails: EmailDTO[];
  sentEmails: EmailDTO[];
  senders: SenderDTO[];
}

export const EngineView: React.FC<EngineViewProps> = ({
  health,
  metrics,
  scheduledTotal,
  sentTotal: _sentTotal,
  scheduledEmails,
  sentEmails,
  senders,
}) => {
  const scheduledCount = metrics ? metrics.scheduled : scheduledTotal;
  const deliveredCount = metrics ? metrics.sent : sentEmails.filter((e) => e.status === 'SENT').length;
  const rateLimitedCount = metrics ? metrics.rateLimited : scheduledEmails.filter(
    (e) => e.status === 'RATE_LIMITED' || e.status === 'RESCHEDULED'
  ).length;
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
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Top Banner: Engine Header & State */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-1">
        <div>
          <div className="flex items-center space-x-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
              <Cpu className="w-6 h-6 text-brand-400" />
              <span>Outbound Engine Telemetry</span>
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
            Real-time infrastructure health, BullMQ cluster queues, and atomic Lua throttle reservations.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <a
            href="/admin/queues"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-300 bg-surface-card hover:bg-surface-50 border border-white/[0.08] hover:border-white/[0.15] transition shadow-inset-subtle"
          >
            <span>Bull Board UI</span>
            <ArrowUpRight className="w-3.5 h-3.5 text-slate-400" />
          </a>
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
      <div className="p-5 rounded-xl bg-surface-card border border-white/[0.08] shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/[0.06] pb-3">
          <div className="flex items-center space-x-2">
            <Server className="w-4 h-4 text-brand-400" />
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-200">
              Core Subsystem Health
            </h2>
            <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-white/[0.04] text-slate-400 border border-white/[0.06]">
              5 Distributed Nodes
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs font-mono text-slate-400">
            <span>Fleet Capacity: <strong className="text-white">{totalHourlyCapacity}/hr</strong></span>
            <span className="text-slate-600">|</span>
            <span>Mailboxes: <strong className="text-white">{senders.length} active</strong></span>
          </div>
        </div>

        {/* 5 Core Nodes Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {/* Node 1: PostgreSQL */}
          <div className="p-3.5 rounded-lg bg-surface-overlay/80 border border-white/[0.05] space-y-1">
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
          <div className="p-3.5 rounded-lg bg-surface-overlay/80 border border-white/[0.05] space-y-1">
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
              <span className="font-mono text-slate-200">{health?.services.redis.latencyMs ?? 0}ms</span>
            </div>
            <div className="text-[10px] text-slate-400 truncate">Atomic Lua Mutex</div>
          </div>

          {/* Node 3: BullMQ Worker */}
          <div className="p-3.5 rounded-lg bg-surface-overlay/80 border border-white/[0.05] space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5 text-brand-400" />
                <span>BullMQ Worker</span>
              </span>
              {health?.services.bullmqWorker.status === 'healthy' ? (
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" title="Running" />
              ) : (
                <span className="w-2 h-2 rounded-full bg-rose-400" title="Offline" />
              )}
            </div>
            <div className="text-[11px] text-slate-400 flex justify-between pt-1">
              <span>Concurrency:</span>
              <span className="font-mono text-slate-200">{health?.services.bullmqWorker.concurrency ?? 5} slots</span>
            </div>
            <div className="text-[10px] text-slate-400 truncate">
              {health?.services.bullmqWorker.activeJobs ?? processingCount} active jobs
            </div>
          </div>

          {/* Node 4: Elasticsearch */}
          <div className="p-3.5 rounded-lg bg-surface-overlay/80 border border-white/[0.05] space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
                <Search className="w-3.5 h-3.5 text-slate-400" />
                <span>Elasticsearch</span>
              </span>
              {health?.services.elasticsearch.status === 'healthy' ? (
                <span className="w-2 h-2 rounded-full bg-emerald-400" title="Green" />
              ) : (
                <span className="w-2 h-2 rounded-full bg-amber-400" title="Yellow/Disabled" />
              )}
            </div>
            <div className="text-[11px] text-slate-400 flex justify-between pt-1">
              <span>Cluster:</span>
              <span className="font-mono text-slate-200">v8.14.0</span>
            </div>
            <div className="text-[10px] text-slate-400 truncate">Full-Text Inverted Index</div>
          </div>

          {/* Node 5: Slack */}
          <div className="p-3.5 rounded-lg bg-surface-overlay/80 border border-white/[0.05] space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
                <Slack className="w-3.5 h-3.5 text-slate-400" />
                <span>Slack Alerts</span>
              </span>
              {health?.services.slack.status === 'connected' ? (
                <span className="w-2 h-2 rounded-full bg-emerald-400" title="Connected" />
              ) : (
                <span className="w-2 h-2 rounded-full bg-slate-500" title="Not configured" />
              )}
            </div>
            <div className="text-[11px] text-slate-400 flex justify-between pt-1">
              <span>Channel:</span>
              <span className="font-mono text-slate-200">
                {health?.services.slack.status === 'connected' ? 'Active' : 'Standby'}
              </span>
            </div>
            <div className="text-[10px] text-slate-400 truncate">Rate Limit Incident Feed</div>
          </div>
        </div>
      </div>

      {/* BullMQ Queue Deep Dive & Reliability Invariants */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left Column (2 spans): BullMQ Queue Telemetry */}
        <div className="lg:col-span-2 p-5 rounded-xl bg-surface-card border border-white/[0.08] shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
            <div className="flex items-center space-x-2">
              <Radio className="w-4 h-4 text-brand-400" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                BullMQ Distributed Queue Telemetry
              </h2>
            </div>
            <span className="text-[11px] font-mono text-slate-400">
              Queue: <span className="text-slate-200 font-semibold">reachflow-email-queue</span>
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="p-3 rounded-lg bg-surface-overlay border border-white/[0.05] text-center">
              <p className="text-[10px] font-mono uppercase tracking-wider text-slate-400">Waiting</p>
              <p className="text-xl font-bold font-mono text-white mt-1">{queueCounts.waiting}</p>
              <p className="text-[10px] text-slate-400 mt-0.5">Ready for pickup</p>
            </div>

            <div className="p-3 rounded-lg bg-surface-overlay border border-white/[0.05] text-center">
              <p className="text-[10px] font-mono uppercase tracking-wider text-sky-400">Active</p>
              <p className="text-xl font-bold font-mono text-sky-300 mt-1">{queueCounts.active}</p>
              <p className="text-[10px] text-slate-400 mt-0.5">In worker loop</p>
            </div>

            <div className="p-3 rounded-lg bg-surface-overlay border border-white/[0.05] text-center">
              <p className="text-[10px] font-mono uppercase tracking-wider text-indigo-400">Delayed</p>
              <p className="text-xl font-bold font-mono text-indigo-300 mt-1">{queueCounts.delayed}</p>
              <p className="text-[10px] text-slate-400 mt-0.5">Throttled / ZSET</p>
            </div>

            <div className="p-3 rounded-lg bg-surface-overlay border border-white/[0.05] text-center">
              <p className="text-[10px] font-mono uppercase tracking-wider text-emerald-400">Completed</p>
              <p className="text-xl font-bold font-mono text-emerald-300 mt-1">{queueCounts.completed}</p>
              <p className="text-[10px] text-slate-400 mt-0.5">Queue events done</p>
            </div>

            <div className="p-3 rounded-lg bg-surface-overlay border border-white/[0.05] text-center">
              <p className="text-[10px] font-mono uppercase tracking-wider text-rose-400">Failed</p>
              <p className="text-xl font-bold font-mono text-rose-300 mt-1">{queueCounts.failed}</p>
              <p className="text-[10px] text-slate-400 mt-0.5">Cluster DLQ jobs</p>
            </div>
          </div>

          {/* Throttle Mechanism Explanation */}
          <div className="p-3.5 rounded-lg bg-surface-overlay/50 border border-white/[0.05] text-xs text-slate-400 space-y-1.5">
            <div className="font-semibold text-slate-200 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>Hybrid Sender Throttle Rescheduling</span>
            </div>
            <p className="leading-relaxed text-[11px]">
              When an inter-send delay requires <strong className="text-slate-300">&gt; 1,000ms</strong> wait, 
              ReachFlow automatically enqueues a deterministic BullMQ delayed job in Redis and marks the email 
              <span className="text-indigo-400 font-mono font-medium"> RESCHEDULED</span>. This instantly frees the 
              worker concurrency slot so other emails continue dispatching without sleeping threads. Micro-waits 
              (&le; 1,000ms) execute in-worker with zero queue overhead.
            </p>
          </div>
        </div>

        {/* Right Column (1 span): Reliability Invariants */}
        <div className="p-5 rounded-xl bg-surface-card border border-white/[0.08] shadow-sm space-y-3.5">
          <div className="border-b border-white/[0.06] pb-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-200">
              Reliability Invariants
            </h2>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Production fault tolerance specifications
            </p>
          </div>

          <div className="space-y-3 text-xs">
            <div className="space-y-1">
              <div className="font-semibold text-slate-200 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span>Zero-Loss State Machine</span>
              </div>
              <p className="text-[11px] text-slate-400 pl-3">
                PostgreSQL is the source of truth. Every transition (SCHEDULED &rarr; PROCESSING &rarr; SENT) is transactionally logged with full audit events.
              </p>
            </div>

            <div className="space-y-1">
              <div className="font-semibold text-slate-200 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
                <span>F3 Lease-Based Recovery</span>
              </div>
              <p className="text-[11px] text-slate-400 pl-3">
                Abandoned worker processes are recovered solely when their heartbeat lease expires, guaranteeing no duplicate dispatches under node crash.
              </p>
            </div>

            <div className="space-y-1">
              <div className="font-semibold text-slate-200 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                <span>F7 Ambiguous SMTP Isolation</span>
              </div>
              <p className="text-[11px] text-slate-400 pl-3">
                Once bytes cross the SMTP transport, network dropouts never trigger blind retries. Dispatches are quarantined to protect sender reputation.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
