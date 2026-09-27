import React from 'react';
import { UserDTO, SystemHealthDTO } from '@reachflow/shared';
import { ExternalLink, LogOut } from 'lucide-react';

interface HeaderProps {
  user: UserDTO;
  health: (SystemHealthDTO & { queueCounts?: any }) | null;
  onLogout: () => void;
}

export const Header: React.FC<HeaderProps> = ({ user, health, onLogout }) => {
  const isHealthy = health?.status === 'healthy';

  return (
    <header className="border-b border-white/[0.08] bg-canvas/80 backdrop-blur-md sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-15 flex items-center justify-between">
        {/* Brand */}
        <div className="flex items-center space-x-3 py-3">
          <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] border border-brand-400/30">
            <span className="font-extrabold text-white text-base tracking-wider font-mono">R</span>
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-bold text-white text-base tracking-tight">ReachFlow</span>
              <span className="text-[10px] uppercase font-mono font-semibold px-1.5 py-0.5 rounded bg-brand-500/10 text-brand-400 border border-brand-500/20">
                v2.1
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-mono">Distributed Outbound Engine</p>
          </div>
        </div>

        {/* Live System Telemetry Strip */}
        <div className="hidden lg:flex items-center space-x-2.5 bg-surface-card border border-white/[0.08] px-3 py-1.5 rounded-lg text-xs shadow-inset-subtle">
          <div className="flex items-center space-x-1.5 pr-2 border-r border-white/[0.08]">
            <span className={`w-2 h-2 rounded-full ${isHealthy ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
            <span className="text-slate-300 font-medium font-mono text-[11px]">
              {isHealthy ? 'CLUSTER HEALTHY' : 'DEGRADED'}
            </span>
          </div>

          {/* Postgres */}
          <div
            className="flex items-center space-x-1 px-1.5 py-0.5 rounded bg-surface-overlay text-slate-300 font-mono text-[11px]"
            title={`PostgreSQL latency: ${health?.services.postgres.latencyMs || 0}ms`}
          >
            <span className="text-slate-400">DB:</span>
            <span className="text-emerald-400">{health?.services.postgres.latencyMs ?? 1}ms</span>
          </div>

          {/* Redis */}
          <div
            className="flex items-center space-x-1 px-1.5 py-0.5 rounded bg-surface-overlay text-slate-300 font-mono text-[11px]"
            title={`Redis latency: ${health?.services.redis.latencyMs || 0}ms`}
          >
            <span className="text-slate-400">Redis:</span>
            <span className="text-emerald-400">{health?.services.redis.latencyMs ?? 1}ms</span>
          </div>

          {/* Worker fleet */}
          <div
            className="flex items-center space-x-1 px-1.5 py-0.5 rounded bg-surface-overlay text-slate-300 font-mono text-[11px]"
            title={`Worker Concurrency: ${health?.services.bullmqWorker.concurrency || 5}x`}
          >
            <span className="text-slate-400">Fleet:</span>
            <span className="text-slate-200">{health?.services.bullmqWorker.concurrency || 5}x parallel</span>
          </div>
        </div>

        {/* Right actions: Bull Board Link & User profile */}
        <div className="flex items-center space-x-3">
          <a
            href="/admin/queues"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:inline-flex items-center space-x-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-surface-card hover:bg-surface-50 text-slate-300 border border-white/[0.08] hover:border-white/[0.15] transition shadow-inset-subtle"
          >
            <span>Bull Board</span>
            <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
          </a>

          {/* User profile */}
          <div className="flex items-center space-x-2.5 pl-3 border-l border-white/[0.08]">
            {user.avatar ? (
              <img src={user.avatar} alt={user.name} className="w-7 h-7 rounded-full border border-white/20" />
            ) : (
              <div className="w-7 h-7 rounded-full bg-surface-50 text-white flex items-center justify-center font-bold text-xs border border-white/10">
                {user.name.charAt(0)}
              </div>
            )}
            <div className="hidden md:block text-left">
              <p className="text-xs font-medium text-slate-200 leading-tight">{user.name}</p>
              <p className="text-[11px] text-slate-400 leading-tight truncate max-w-[130px] font-mono">{user.email}</p>
            </div>
            <button
              onClick={onLogout}
              title="Logout"
              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
