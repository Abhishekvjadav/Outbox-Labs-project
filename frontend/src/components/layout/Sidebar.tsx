import React from 'react';
import { 
  LayoutDashboard, 
  Clock, 
  CheckCircle2, 
  Plus, 
  Cpu, 
  Mail, 
  Settings, 
  LogOut, 
  Radio,
  ChevronRight,
  ExternalLink
} from 'lucide-react';
import { UserDTO, SystemHealthDTO } from '@reachflow/shared';

export type NavigationTab = 'overview' | 'scheduled' | 'sent' | 'studio' | 'engine' | 'senders' | 'slack';

interface SidebarProps {
  activeTab: NavigationTab;
  onTabChange: (tab: NavigationTab) => void;
  scheduledCount: number;
  sentCount: number;
  sendersCount: number;
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
  user,
  health,
  onLogout,
  onOpenStudio,
}) => {
  const isHealthy = health?.status === 'healthy';

  const navItems = [
    {
      id: 'overview' as NavigationTab,
      label: 'Overview',
      icon: LayoutDashboard,
      badge: null,
    },
    {
      id: 'scheduled' as NavigationTab,
      label: 'Scheduled',
      icon: Clock,
      badge: scheduledCount > 0 ? scheduledCount : null,
      badgeColor: 'bg-sky-500/15 text-sky-400 border-sky-500/20',
    },
    {
      id: 'sent' as NavigationTab,
      label: 'Sent',
      icon: CheckCircle2,
      badge: sentCount > 0 ? sentCount : null,
      badgeColor: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
    },
  ];

  const operationsItems = [
    {
      id: 'engine' as NavigationTab,
      label: 'Engine',
      icon: Cpu,
      badge: isHealthy ? 'LIVE' : 'WARN',
      badgeColor: isHealthy 
        ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25' 
        : 'bg-amber-500/15 text-amber-400 border-amber-500/25',
    },
    {
      id: 'senders' as NavigationTab,
      label: 'Mailboxes',
      icon: Mail,
      badge: sendersCount > 0 ? sendersCount : null,
      badgeColor: 'bg-slate-700/60 text-slate-300 border-slate-600/40',
    },
  ];

  return (
    <aside className="w-64 flex-shrink-0 bg-surface-card border-r border-white/[0.07] flex flex-col h-screen select-none sticky top-0 z-30">
      {/* Brand Header */}
      <div className="h-16 px-5 flex items-center justify-between border-b border-white/[0.06]">
        <div className="flex items-center space-x-2.5">
          <div className="w-8 h-8 rounded-lg bg-brand-600/20 border border-brand-500/30 flex items-center justify-center text-brand-400 shadow-sm">
            <Radio className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center space-x-1.5">
              <span className="font-bold text-sm tracking-tight text-white font-mono">ReachFlow</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/[0.06] text-slate-400 border border-white/[0.08]">
                v2.4
              </span>
            </div>
            <p className="text-[10px] text-slate-400 tracking-tight">Email Delivery Engine</p>
          </div>
        </div>

        {/* Engine Pulse Indicator */}
        <div 
          className="flex items-center" 
          title={isHealthy ? 'Outbound Engine is healthy' : 'Engine status degraded'}
        >
          <span className="relative flex h-2 w-2">
            {isHealthy && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            )}
            <span className={`relative inline-flex rounded-full h-2 w-2 ${isHealthy ? 'bg-emerald-400' : 'bg-amber-400'}`} />
          </span>
        </div>
      </div>

      {/* Primary Action: New Campaign CTA */}
      <div className="p-3.5 pb-2">
        <button
          onClick={onOpenStudio}
          className="w-full flex items-center justify-center space-x-2 px-3.5 py-2.5 rounded-xl text-xs font-semibold text-white bg-brand-600 hover:bg-brand-500 active:scale-[0.98] transition-all shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_2px_4px_rgba(0,0,0,0.3)] border border-brand-400/30"
        >
          <Plus className="w-4 h-4" />
          <span>New Campaign</span>
        </button>
      </div>

      {/* Navigation Sections */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-6">
        {/* Core Navigation */}
        <div className="space-y-1">
          <p className="px-2.5 text-[10px] font-mono font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
            Campaigns
          </p>
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onTabChange(item.id)}
                className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-surface-overlay text-white border border-white/[0.08] shadow-sm font-semibold'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
                }`}
              >
                <div className="flex items-center space-x-2.5">
                  <Icon className={`w-4 h-4 ${isActive ? 'text-brand-400' : 'text-slate-400'}`} />
                  <span>{item.label}</span>
                </div>
                {item.badge !== null && (
                  <span
                    className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                      item.badgeColor || 'bg-white/[0.06] text-slate-300 border-white/[0.08]'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Operations Section */}
        <div className="space-y-1">
          <p className="px-2.5 text-[10px] font-mono font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
            Operations
          </p>
          {operationsItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onTabChange(item.id)}
                className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-surface-overlay text-white border border-white/[0.08] shadow-sm font-semibold'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
                }`}
              >
                <div className="flex items-center space-x-2.5">
                  <Icon className={`w-4 h-4 ${isActive ? 'text-brand-400' : 'text-slate-400'}`} />
                  <span>{item.label}</span>
                </div>
                {item.badge !== null && (
                  <span
                    className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${item.badgeColor}`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Configuration Section */}
        <div className="space-y-1">
          <p className="px-2.5 text-[10px] font-mono font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
            System
          </p>
          <button
            onClick={() => onTabChange('slack')}
            className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs font-medium transition-colors ${
              activeTab === 'slack'
                ? 'bg-surface-overlay text-white border border-white/[0.08] shadow-sm font-semibold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
            }`}
          >
            <div className="flex items-center space-x-2.5">
              <Settings className={`w-4 h-4 ${activeTab === 'slack' ? 'text-brand-400' : 'text-slate-400'}`} />
              <span>Settings</span>
            </div>
            <span className="text-[10px] font-mono text-slate-400">Slack</span>
          </button>

          <a
            href="/admin/queues"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-white/[0.04] transition-colors"
          >
            <div className="flex items-center space-x-2.5">
              <ExternalLink className="w-4 h-4 text-slate-400" />
              <span>Bull Board</span>
            </div>
            <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
          </a>
        </div>
      </div>

      {/* User Profile & Logout Footer */}
      <div className="p-3 border-t border-white/[0.06] bg-surface-overlay/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2.5 min-w-0">
            {user.avatar ? (
              <img
                src={user.avatar}
                alt={user.name}
                className="w-7 h-7 rounded-full border border-white/10 flex-shrink-0"
              />
            ) : (
              <div className="w-7 h-7 rounded-full bg-brand-500/20 text-brand-300 border border-brand-500/30 flex items-center justify-center font-bold text-xs flex-shrink-0">
                {user.name.charAt(0)}
              </div>
            )}
            <div className="min-w-0">
              <p className="text-xs font-medium text-white truncate">{user.name}</p>
              <p className="text-[10px] text-slate-400 truncate font-mono">{user.email}</p>
            </div>
          </div>
          <button
            onClick={onLogout}
            title="Log out"
            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
};
