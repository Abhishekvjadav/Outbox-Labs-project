import React from 'react';
import { UserDTO, SystemHealthDTO } from '@reachflow/shared';
import { RefreshCw, Plus, ChevronRight } from 'lucide-react';
import { NavigationTab } from './Sidebar';

interface HeaderProps {
  activeTab: NavigationTab;
  user: UserDTO;
  health: (SystemHealthDTO & { queueCounts?: any }) | null;
  onOpenStudio: () => void;
  onRefresh: () => void;
  refreshing?: boolean;
}

const TAB_TITLES: Record<NavigationTab, { section: string; title: string }> = {
  overview: { section: 'ReachFlow', title: 'Overview' },
  scheduled: { section: 'Campaigns', title: 'Scheduled Pipeline' },
  sent: { section: 'Campaigns', title: 'Delivered (Sent)' },
  studio: { section: 'Campaigns', title: 'Campaign Studio' },
  engine: { section: 'Operations', title: 'Engine Telemetry' },
  senders: { section: 'Operations', title: 'Mailboxes' },
  slack: { section: 'System', title: 'Settings' },
};

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  health,
  onOpenStudio,
  onRefresh,
  refreshing = false,
}) => {
  const isHealthy = health?.status === 'healthy';
  const currentTabInfo = TAB_TITLES[activeTab] || { section: 'ReachFlow', title: 'Dashboard' };

  return (
    <header className="h-16 border-b border-white/[0.07] bg-canvas/90 backdrop-blur-md sticky top-0 z-20 px-6 flex items-center justify-between">
      {/* Breadcrumb Path */}
      <div className="flex items-center space-x-2 text-xs">
        <span className="font-mono text-slate-400 font-medium">{currentTabInfo.section}</span>
        <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
        <span className="font-semibold text-white tracking-tight">{currentTabInfo.title}</span>
      </div>

      {/* Cluster Telemetry Strip & Quick Actions */}
      <div className="flex items-center space-x-3">
        {/* Live System Telemetry Strip */}
        <div className="hidden md:flex items-center space-x-2 bg-surface-card border border-white/[0.08] px-3 py-1.5 rounded-lg text-xs shadow-inset-subtle">
          <div className="flex items-center space-x-1.5 pr-2 border-r border-white/[0.08]">
            <span className={`w-1.5 h-1.5 rounded-full ${isHealthy ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
            <span className="text-slate-300 font-medium font-mono text-[11px]">
              {isHealthy ? 'CLUSTER HEALTHY' : 'DEGRADED'}
            </span>
          </div>

          <div
            className="flex items-center space-x-1 px-1.5 py-0.5 rounded bg-surface-overlay text-slate-300 font-mono text-[11px]"
            title={`PostgreSQL latency: ${health?.services.postgres.latencyMs || 0}ms`}
          >
            <span className="text-slate-400">DB:</span>
            <span className="text-emerald-400">{health?.services.postgres.latencyMs ?? 1}ms</span>
          </div>

          <div
            className="flex items-center space-x-1 px-1.5 py-0.5 rounded bg-surface-overlay text-slate-300 font-mono text-[11px]"
            title={`Redis latency: ${health?.services.redis.latencyMs || 0}ms`}
          >
            <span className="text-slate-400">Redis:</span>
            <span className="text-emerald-400">{health?.services.redis.latencyMs ?? 1}ms</span>
          </div>

          <div
            className="flex items-center space-x-1 px-1.5 py-0.5 rounded bg-surface-overlay text-slate-300 font-mono text-[11px]"
            title={`Worker Concurrency: ${health?.services.bullmqWorker.concurrency || 5}x`}
          >
            <span className="text-slate-400">Fleet:</span>
            <span className="text-slate-200">{health?.services.bullmqWorker.concurrency || 5}x parallel</span>
          </div>
        </div>

        {/* Refresh Action */}
        <button
          onClick={onRefresh}
          title="Refresh telemetry & pipeline data"
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.04] border border-white/[0.06] transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-brand-400' : ''}`} />
        </button>

        {/* Quick New Campaign CTA (if not on studio) */}
        {activeTab !== 'studio' && (
          <button
            onClick={onOpenStudio}
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-brand-600 hover:bg-brand-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_2px_4px_rgba(0,0,0,0.3)] transition active:scale-[0.98] border border-brand-400/30"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Campaign</span>
          </button>
        )}
      </div>
    </header>
  );
};
