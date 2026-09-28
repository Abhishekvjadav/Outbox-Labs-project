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
    <div className="space-y-6 font-sans animate-in fade-in duration-150">
      {/* Top Banner: Engine Header & State */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <div className="flex items-center space-x-2.5">
            <h1 className="text-xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
              <Cpu className="w-5 h-5 text-emerald-600" />
              <span>Outbound Engine Telemetry</span>
            </h1>
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-mono font-medium border ${
                isHealthy
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : isDegraded
                  ? 'bg-amber-50 text-amber-700 border-amber-200'
                  : 'bg-rose-50 text-rose-700 border-rose-200'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${isHealthy ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
              {isHealthy ? 'ENGINE OPERATIONAL' : isDegraded ? 'ENGINE DEGRADED' : 'SYSTEM OFFLINE'}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1 max-w-2xl">
            Real-time infrastructure health, BullMQ cluster queues, and atomic Lua throttle reservations.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <a
            href="/admin/queues"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 transition shadow-2xs"
          >
            <span>Bull Board UI</span>
            <ArrowUpRight className="w-3.5 h-3.5 text-slate-400" />
          </a>
        </div>
      </div>

      {/* 4 Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="p-3.5 rounded-xl bg-white border border-slate-200 shadow-2xs">
          <div className="flex items-center justify-between text-slate-500 text-xs">
            <span className="font-medium text-slate-700">Scheduled Queue</span>
            <Clock className="w-4 h-4 text-amber-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-slate-900 tabular-nums">
              {scheduledCount}
            </span>
            <span className="text-[11px] text-slate-500 font-mono">
              ({queueCounts.delayed || scheduledCount} delayed)
            </span>
          </div>
          <div className="mt-1.5 text-[11px] text-slate-400">
            {processingCount > 0 ? `${processingCount} processing now` : 'BullMQ ZSET standby'}
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-white border border-slate-200 shadow-2xs">
          <div className="flex items-center justify-between text-slate-500 text-xs">
            <span className="font-medium text-slate-700">Delivered (Sent)</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-slate-900 tabular-nums">
              {deliveredCount}
            </span>
            <span className="text-[11px] text-emerald-700 font-medium">
              PostgreSQL SENT
            </span>
          </div>
          <div className="mt-1.5 text-[11px] text-slate-400">
            SMTP 250 confirmed
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-white border border-slate-200 shadow-2xs">
          <div className="flex items-center justify-between text-slate-500 text-xs">
            <span className="font-medium text-slate-700">Rate Limited</span>
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
          <div className="mt-1.5 text-[11px] text-slate-400">
            Rollover to next hourly window
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-white border border-slate-200 shadow-2xs">
          <div className="flex items-center justify-between text-slate-500 text-xs">
            <span className="font-medium text-slate-700">Failed / DLQ</span>
            <AlertTriangle className={`w-4 h-4 ${failedCount > 0 ? 'text-rose-500' : 'text-slate-400'}`} />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-slate-900 tabular-nums">
              {failedCount}
            </span>
            <span className={`text-[11px] font-medium ${failedCount === 0 ? 'text-slate-500' : 'text-rose-600'}`}>
              {failedCount === 0 ? '0 dropped' : 'User emails failed'}
            </span>
          </div>
          <div className="mt-1.5 text-[11px] text-slate-400">
            {failedCount === 0 ? 'User delivery healthy' : 'PostgreSQL FAILED records'}
          </div>
        </div>
      </div>

      {/* 5 Core Subsystems Grid */}
      <div className="p-5 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center space-x-2">
            <Server className="w-4 h-4 text-emerald-600" />
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800">
              Core Subsystem Nodes
            </h2>
          </div>
          <div className="text-xs font-mono text-slate-500">
            Fleet Capacity: <strong className="text-slate-900">{totalHourlyCapacity}/hr</strong>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {/* PostgreSQL */}
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-slate-500" />
                <span>PostgreSQL 16</span>
              </span>
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
            </div>
            <div className="text-[11px] text-slate-500 flex justify-between pt-1 font-mono">
              <span>Latency:</span>
              <span className="text-slate-800 font-semibold">{health?.services.postgres.latencyMs ?? 1}ms</span>
            </div>
            <div className="text-[10px] text-slate-400">ACID Event Log</div>
          </div>

          {/* Redis */}
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-slate-500" />
                <span>Redis 7.2</span>
              </span>
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
            </div>
            <div className="text-[11px] text-slate-500 flex justify-between pt-1 font-mono">
              <span>Latency:</span>
              <span className="text-slate-800 font-semibold">{health?.services.redis.latencyMs ?? 0}ms</span>
            </div>
            <div className="text-[10px] text-slate-400">Lua Rate Limiter</div>
          </div>

          {/* BullMQ Worker */}
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5 text-emerald-600" />
                <span>BullMQ Worker</span>
              </span>
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            </div>
            <div className="text-[11px] text-slate-500 flex justify-between pt-1 font-mono">
              <span>Concurrency:</span>
              <span className="text-slate-800 font-semibold">{health?.services.bullmqWorker.concurrency ?? 5} slots</span>
            </div>
            <div className="text-[10px] text-slate-400">{queueCounts.active} active jobs</div>
          </div>

          {/* Elasticsearch */}
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                <Search className="w-3.5 h-3.5 text-slate-500" />
                <span>Elasticsearch</span>
              </span>
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
            </div>
            <div className="text-[11px] text-slate-500 flex justify-between pt-1 font-mono">
              <span>Cluster:</span>
              <span className="text-slate-800 font-semibold">v8.14.0</span>
            </div>
            <div className="text-[10px] text-slate-400">Full-Text Inverted Index</div>
          </div>

          {/* Slack */}
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1 col-span-2 sm:col-span-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                <Slack className="w-3.5 h-3.5 text-slate-500" />
                <span>Slack Alerts</span>
              </span>
              <span className={`w-2 h-2 rounded-full ${health?.services.slack.status === 'connected' ? 'bg-emerald-500' : 'bg-slate-400'}`} />
            </div>
            <div className="text-[11px] text-slate-500 flex justify-between pt-1 font-mono">
              <span>Status:</span>
              <span className="text-slate-800 font-semibold">{health?.services.slack.status === 'connected' ? 'Active' : 'Standby'}</span>
            </div>
            <div className="text-[10px] text-slate-400">Rate Limit Incident Feed</div>
          </div>
        </div>
      </div>

      {/* BullMQ Breakdown */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center space-x-2">
            <Radio className="w-4 h-4 text-emerald-600" />
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800">
              BullMQ Queue Breakdown
            </h2>
          </div>
          <span className="text-xs font-mono text-slate-500">
            Queue: <strong className="text-slate-800">reachflow-email-queue</strong>
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-center">
            <p className="text-[10px] font-mono uppercase tracking-wider text-slate-500">Waiting</p>
            <p className="text-xl font-bold font-mono text-slate-900 mt-1">{queueCounts.waiting}</p>
          </div>
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-center">
            <p className="text-[10px] font-mono uppercase tracking-wider text-sky-700">Active</p>
            <p className="text-xl font-bold font-mono text-sky-800 mt-1">{queueCounts.active}</p>
          </div>
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-center">
            <p className="text-[10px] font-mono uppercase tracking-wider text-amber-700">Delayed</p>
            <p className="text-xl font-bold font-mono text-amber-800 mt-1">{queueCounts.delayed}</p>
          </div>
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-center">
            <p className="text-[10px] font-mono uppercase tracking-wider text-emerald-700">Completed</p>
            <p className="text-xl font-bold font-mono text-emerald-800 mt-1">{queueCounts.completed}</p>
          </div>
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-center">
            <p className="text-[10px] font-mono uppercase tracking-wider text-rose-700">Failed</p>
            <p className="text-xl font-bold font-mono text-rose-800 mt-1">{queueCounts.failed}</p>
          </div>
        </div>
      </div>
    </div>
  );
};
