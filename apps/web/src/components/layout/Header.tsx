import React from 'react';
import { UserDTO, SystemHealthDTO } from '@reachflow/shared';
import { Activity, ExternalLink, LogOut, CheckCircle, AlertTriangle, XCircle } from 'lucide-react';

interface HeaderProps {
  user: UserDTO;
  health: (SystemHealthDTO & { queueCounts?: any }) | null;
  onLogout: () => void;
}

export const Header: React.FC<HeaderProps> = ({ user, health, onLogout }) => {
  return (
    <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-md sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand */}
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-tr from-brand-600 to-indigo-400 flex items-center justify-center shadow-lg shadow-brand-500/20">
            <span className="font-extrabold text-white text-lg tracking-wider">R</span>
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-bold text-white text-lg tracking-tight">ReachFlow</span>
              <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded bg-brand-500/10 text-brand-400 border border-brand-500/20">
                v2.1 Engine
              </span>
            </div>
            <p className="text-xs text-slate-400">Distributed Cold Email Scheduling</p>
          </div>
        </div>

        {/* Live System Health Telemetry Pills */}
        <div className="hidden lg:flex items-center space-x-2 bg-slate-950/60 border border-slate-800/80 px-3 py-1.5 rounded-full text-xs">
          <Activity className="w-3.5 h-3.5 text-brand-400 animate-pulse" />
          <span className="text-slate-400 font-medium mr-1">System Health:</span>

          {/* Postgres */}
          <div
            className="flex items-center space-x-1 px-2 py-0.5 rounded bg-slate-800/50"
            title={`PostgreSQL latency: ${health?.services.postgres.latencyMs || 0}ms`}
          >
            {health?.services.postgres.status === 'healthy' ? (
              <CheckCircle className="w-3 h-3 text-emerald-400" />
            ) : (
              <XCircle className="w-3 h-3 text-rose-400" />
            )}
            <span className="text-slate-300 font-mono">DB</span>
          </div>

          {/* Redis */}
          <div
            className="flex items-center space-x-1 px-2 py-0.5 rounded bg-slate-800/50"
            title={`Redis latency: ${health?.services.redis.latencyMs || 0}ms`}
          >
            {health?.services.redis.status === 'healthy' ? (
              <CheckCircle className="w-3 h-3 text-emerald-400" />
            ) : (
              <XCircle className="w-3 h-3 text-rose-400" />
            )}
            <span className="text-slate-300 font-mono">Redis</span>
          </div>

          {/* BullMQ Worker Fleet */}
          <div
            className="flex items-center space-x-1 px-2 py-0.5 rounded bg-slate-800/50"
            title={`BullMQ Worker Concurrency: ${health?.services.bullmqWorker.concurrency || 5}`}
          >
            <CheckCircle className="w-3 h-3 text-emerald-400" />
            <span className="text-slate-300 font-mono">Worker ({health?.services.bullmqWorker.concurrency || 5}x)</span>
          </div>

          {/* Elasticsearch */}
          <div className="flex items-center space-x-1 px-2 py-0.5 rounded bg-slate-800/50">
            {health?.services.elasticsearch.status === 'healthy' ? (
              <CheckCircle className="w-3 h-3 text-emerald-400" />
            ) : health?.services.elasticsearch.status === 'disabled' ? (
              <AlertTriangle className="w-3 h-3 text-amber-400" />
            ) : (
              <XCircle className="w-3 h-3 text-rose-400" />
            )}
            <span className="text-slate-300 font-mono">ES</span>
          </div>

          {/* Slack */}
          <div className="flex items-center space-x-1 px-2 py-0.5 rounded bg-slate-800/50">
            <span
              className={`w-2 h-2 rounded-full ${
                health?.services.slack.status === 'connected' ? 'bg-emerald-400' : 'bg-slate-500'
              }`}
            />
            <span className="text-slate-300 font-mono">Slack</span>
          </div>
        </div>

        {/* Right actions: Bull Board Link & User profile */}
        <div className="flex items-center space-x-4">
          <a
            href="/admin/queues"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:inline-flex items-center space-x-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
          >
            <span>Bull Board</span>
            <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
          </a>

          {/* User profile */}
          <div className="flex items-center space-x-3 pl-2 border-l border-slate-800">
            {user.avatar ? (
              <img src={user.avatar} alt={user.name} className="w-8 h-8 rounded-full border border-brand-500/40" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-brand-600 text-white flex items-center justify-center font-bold text-xs">
                {user.name.charAt(0)}
              </div>
            )}
            <div className="hidden md:block text-left">
              <p className="text-xs font-semibold text-slate-200 leading-tight">{user.name}</p>
              <p className="text-[11px] text-slate-400 leading-tight truncate max-w-[140px]">{user.email}</p>
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
