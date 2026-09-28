import React from 'react';
import { 
  Send,
  Clock, 
  CheckCircle2, 
  Plus, 
  LayoutDashboard,
  Mail, 
  Settings, 
  Cpu, 
  LogOut, 
  ChevronDown,
  ExternalLink
} from 'lucide-react';
import { UserDTO, SystemHealthDTO, SenderDTO } from '@reachflow/shared';

export type NavigationTab = 'overview' | 'scheduled' | 'sent' | 'studio' | 'engine' | 'senders' | 'slack';

interface SidebarProps {
  activeTab: NavigationTab;
  onTabChange: (tab: NavigationTab) => void;
  scheduledCount: number;
  sentCount: number;
  sendersCount: number;
  senders?: SenderDTO[];
  user: UserDTO;
  health: SystemHealthDTO | null;
  onLogout: () => void;
  onOpenStudio: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onTabChange,
  scheduledCount,
  sentCount,
  sendersCount,
  senders = [],
  user,
  health,
  onLogout,
  onOpenStudio,
}) => {
  const isHealthy = health?.status === 'healthy';
  const defaultSender = senders[0];

  const mainNav = [
    {
      id: 'scheduled' as NavigationTab,
      label: 'Scheduled',
      icon: Clock,
      count: scheduledCount,
      badgeColor: 'bg-amber-50 text-amber-700 border-amber-200',
    },
    {
      id: 'sent' as NavigationTab,
      label: 'Sent',
      icon: CheckCircle2,
      count: sentCount,
      badgeColor: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    },
  ];

  const secondaryNav = [
    {
      id: 'overview' as NavigationTab,
      label: 'Overview',
      icon: LayoutDashboard,
    },
    {
      id: 'senders' as NavigationTab,
      label: 'Mailboxes',
      icon: Mail,
      count: sendersCount > 0 ? sendersCount : undefined,
    },
    {
      id: 'engine' as NavigationTab,
      label: 'Engine Telemetry',
      icon: Cpu,
      status: isHealthy ? 'healthy' : 'warn',
    },
    {
      id: 'slack' as NavigationTab,
      label: 'Settings',
      icon: Settings,
    },
  ];

  return (
    <aside className="w-60 flex-shrink-0 bg-white border-r border-slate-200 flex flex-col h-screen select-none sticky top-0 z-30 font-sans">
      {/* 1. Header: Wordmark & Cluster Status */}
      <div className="h-14 px-4 flex items-center justify-between border-b border-slate-100">
        <div className="flex items-center space-x-2.5">
          <div className="w-7 h-7 rounded-lg bg-emerald-600 flex items-center justify-center text-white shadow-sm shadow-emerald-600/20">
            <Send className="w-3.5 h-3.5" />
          </div>
          <div className="flex items-center space-x-1.5">
            <span className="font-bold text-sm tracking-tight text-slate-900 font-sans">ReachFlow</span>
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200/60 font-mono">
              v2.4
            </span>
          </div>
        </div>

        {/* Subtle Live Engine Indicator */}
        <div 
          className="flex items-center" 
          title={isHealthy ? 'Outbound Engine is healthy' : 'Engine status degraded'}
        >
          <span className="relative flex h-2 w-2">
            {isHealthy && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            )}
            <span className={`relative inline-flex rounded-full h-2 w-2 ${isHealthy ? 'bg-emerald-500' : 'bg-amber-500'}`} />
          </span>
        </div>
      </div>

      {/* 2. Sender / Account Dropdown Box */}
      <div className="px-3.5 py-3 border-b border-slate-100 bg-slate-50/50">
        <div 
          onClick={() => onTabChange('senders')}
          className="group flex items-center justify-between p-2 rounded-lg bg-white border border-slate-200/80 hover:border-slate-300 transition-all cursor-pointer shadow-xs"
        >
          <div className="flex items-center space-x-2.5 min-w-0">
            <div className="w-7 h-7 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700 font-semibold text-xs flex-shrink-0">
              {defaultSender?.name ? defaultSender.name.charAt(0).toUpperCase() : 'M'}
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-slate-800 truncate leading-snug">
                {defaultSender?.name || 'Primary Mailbox'}
              </div>
              <div className="text-[11px] text-slate-500 truncate font-mono">
                {defaultSender?.email || 'outreach@reachflow.dev'}
              </div>
            </div>
          </div>
          <ChevronDown className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-600 transition-colors flex-shrink-0" />
        </div>
      </div>

      {/* 3. Primary Action: Compose Button */}
      <div className="p-3">
        <button
          onClick={onOpenStudio}
          className={`w-full flex items-center justify-center space-x-2 px-3.5 py-2.5 rounded-lg text-xs font-semibold transition-all shadow-xs ${
            activeTab === 'studio'
              ? 'bg-emerald-700 text-white shadow-emerald-700/20'
              : 'bg-emerald-600 hover:bg-emerald-700 text-white active:scale-[0.99] shadow-emerald-600/10'
          }`}
        >
          <Plus className="w-4 h-4" />
          <span>Compose</span>
        </button>
      </div>

      {/* 4. Navigation Links */}
      <div className="flex-1 overflow-y-auto px-2.5 space-y-4 py-1">
        {/* Core Email Client Views */}
        <div className="space-y-0.5">
          <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Outreach
          </div>

          {mainNav.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onTabChange(item.id)}
                className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-emerald-50 text-emerald-900 font-semibold'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/70'
                }`}
              >
                <div className="flex items-center space-x-2.5">
                  <Icon className={`w-4 h-4 ${isActive ? 'text-emerald-600' : 'text-slate-400'}`} />
                  <span>{item.label}</span>
                </div>
                {item.count !== undefined && item.count > 0 && (
                  <span
                    className={`text-[11px] font-medium font-mono px-2 py-0.5 rounded-full border ${
                      isActive ? 'bg-white text-emerald-700 border-emerald-200' : item.badgeColor
                    }`}
                  >
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Secondary / Admin Views */}
        <div className="space-y-0.5 pt-2 border-t border-slate-100">
          <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Workspace
          </div>

          {secondaryNav.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onTabChange(item.id)}
                className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-emerald-50 text-emerald-900 font-semibold'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/70'
                }`}
              >
                <div className="flex items-center space-x-2.5">
                  <Icon className={`w-4 h-4 ${isActive ? 'text-emerald-600' : 'text-slate-400'}`} />
                  <span>{item.label}</span>
                </div>
                {item.count !== undefined && (
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                    {item.count}
                  </span>
                )}
                {item.status && (
                  <span className={`w-1.5 h-1.5 rounded-full ${isHealthy ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                )}
              </button>
            );
          })}

          <a
            href="/admin/queues"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs font-medium text-slate-500 hover:text-slate-800 hover:bg-slate-100/70 transition-colors"
          >
            <div className="flex items-center space-x-2.5">
              <ExternalLink className="w-4 h-4 text-slate-400" />
              <span>Bull Board</span>
            </div>
          </a>
        </div>
      </div>

      {/* 5. User Profile Footer */}
      <div className="p-3 border-t border-slate-100 bg-slate-50/60">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2.5 min-w-0">
            {user.avatar ? (
              <img
                src={user.avatar}
                alt={user.name}
                className="w-7 h-7 rounded-full border border-slate-200 flex-shrink-0 object-cover"
              />
            ) : (
              <div className="w-7 h-7 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center justify-center font-bold text-xs flex-shrink-0">
                {user.name ? user.name.charAt(0).toUpperCase() : 'U'}
              </div>
            )}
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-800 truncate leading-tight">{user.name}</p>
              <p className="text-[10px] text-slate-500 truncate font-mono">{user.email}</p>
            </div>
          </div>
          <button
            onClick={onLogout}
            title="Log out"
            className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
};
