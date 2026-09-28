import React from 'react';
import { UserDTO, SystemHealthDTO } from '@reachflow/shared';
import { RefreshCw, Plus, Search, Filter } from 'lucide-react';
import { NavigationTab } from './Sidebar';

interface HeaderProps {
  activeTab: NavigationTab;
  user: UserDTO;
  health: (SystemHealthDTO & { queueCounts?: any }) | null;
  onOpenStudio: () => void;
  onRefresh: () => void;
  refreshing?: boolean;
  searchQuery?: string;
  onSearchChange?: (q: string) => void;
}

const TAB_TITLES: Record<NavigationTab, { title: string; subtitle: string }> = {
  overview: { title: 'Outreach Overview', subtitle: 'Pipeline metrics & delivery summary' },
  scheduled: { title: 'Scheduled Emails', subtitle: 'Pending delivery jobs in queue' },
  sent: { title: 'Sent Emails', subtitle: 'Delivered outreach dispatches' },
  studio: { title: 'Compose New Email', subtitle: 'Design campaign & pacing parameters' },
  engine: { title: 'Engine Operations', subtitle: 'BullMQ queues & Lua rate limiters' },
  senders: { title: 'Connected Mailboxes', subtitle: 'Manage sender inboxes & quotas' },
  slack: { title: 'System Settings', subtitle: 'Slack alert integrations' },
};

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  health,
  onOpenStudio,
  onRefresh,
  refreshing = false,
  searchQuery = '',
  onSearchChange,
}) => {
  const isHealthy = health?.status === 'healthy';
  const tabInfo = TAB_TITLES[activeTab] || { title: 'ReachFlow', subtitle: 'Email Client' };

  return (
    <header className="h-14 border-b border-slate-200 bg-white sticky top-0 z-20 px-6 flex items-center justify-between font-sans">
      {/* Search Input (Email Client Style) */}
      <div className="flex-1 max-w-md mr-4">
        {onSearchChange ? (
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search in emails (recipient, subject, campaign)..."
              className="w-full pl-9 pr-8 py-1.5 bg-slate-50 hover:bg-slate-100/80 focus:bg-white border border-slate-200 focus:border-emerald-500 rounded-lg text-xs text-slate-900 placeholder-slate-400 focus:outline-none transition shadow-2xs"
            />
            <button
              type="button"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              title="Filters"
            >
              <Filter className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <div className="text-xs font-semibold text-slate-800">
            {tabInfo.title}
          </div>
        )}
      </div>

      {/* Right Controls: Cluster Telemetry & Quick Action */}
      <div className="flex items-center space-x-2.5">
        {/* Subtle Engine Status Badge */}
        <div className="hidden lg:flex items-center space-x-2 px-2.5 py-1 rounded-md bg-slate-50 border border-slate-200 text-xs font-mono">
          <div className="flex items-center space-x-1.5 pr-2 border-r border-slate-200">
            <span className={`w-2 h-2 rounded-full ${isHealthy ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            <span className="text-slate-600 text-[11px] font-medium font-sans">
              {isHealthy ? 'Engine Active' : 'Degraded'}
            </span>
          </div>
          <div className="text-[11px] text-slate-500">
            Workers: <span className="font-semibold text-slate-700">{health?.services.bullmqWorker.concurrency || 5}x</span>
          </div>
        </div>

        {/* Refresh Action */}
        <button
          onClick={onRefresh}
          title="Refresh emails & telemetry"
          className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 border border-slate-200 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-emerald-600' : ''}`} />
        </button>

        {/* Quick Compose CTA (when not in studio) */}
        {activeTab !== 'studio' && (
          <button
            onClick={onOpenStudio}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] transition shadow-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Compose</span>
          </button>
        )}
      </div>
    </header>
  );
};
