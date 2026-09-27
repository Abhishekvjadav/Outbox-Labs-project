import React from 'react';
import { Calendar, CheckCircle2, Mail, Plus, Slack } from 'lucide-react';

export type TabType = 'scheduled' | 'sent' | 'senders' | 'slack';

interface TabNavigationProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  scheduledCount: number;
  sentCount: number;
  onOpenCompose: () => void;
}

export const TabNavigation: React.FC<TabNavigationProps> = ({
  activeTab,
  onTabChange,
  scheduledCount,
  sentCount,
  onOpenCompose,
}) => {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2 pb-4 border-b border-white/[0.08]">
      {/* Precision Segmented Control */}
      <div className="p-1 rounded-xl bg-surface-card border border-white/[0.08] inline-flex items-center gap-1 overflow-x-auto no-scrollbar shadow-inset-subtle">
        <button
          onClick={() => onTabChange('scheduled')}
          className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs transition ${
            activeTab === 'scheduled'
              ? 'bg-surface-overlay text-white font-semibold border border-white/10 shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.03] font-medium'
          }`}
        >
          <Calendar className="w-3.5 h-3.5 text-sky-400" />
          <span>Scheduled Queue</span>
          <span
            className={`text-[10px] font-mono px-1.5 py-0.2 rounded ${
              activeTab === 'scheduled' ? 'bg-sky-500/20 text-sky-300' : 'bg-white/[0.05] text-slate-400'
            }`}
          >
            {scheduledCount}
          </span>
        </button>

        <button
          onClick={() => onTabChange('sent')}
          className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs transition ${
            activeTab === 'sent'
              ? 'bg-surface-overlay text-white font-semibold border border-white/10 shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.03] font-medium'
          }`}
        >
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          <span>Delivered Log</span>
          <span
            className={`text-[10px] font-mono px-1.5 py-0.2 rounded ${
              activeTab === 'sent' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/[0.05] text-slate-400'
            }`}
          >
            {sentCount}
          </span>
        </button>

        <button
          onClick={() => onTabChange('senders')}
          className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs transition ${
            activeTab === 'senders'
              ? 'bg-surface-overlay text-white font-semibold border border-white/10 shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.03] font-medium'
          }`}
        >
          <Mail className="w-3.5 h-3.5 text-brand-400" />
          <span>Sender Fleet</span>
        </button>

        <button
          onClick={() => onTabChange('slack')}
          className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs transition ${
            activeTab === 'slack'
              ? 'bg-surface-overlay text-white font-semibold border border-white/10 shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.03] font-medium'
          }`}
        >
          <Slack className="w-3.5 h-3.5 text-[#E01E5A]" />
          <span>Slack Webhook</span>
        </button>
      </div>

      {/* Primary Action Button */}
      <button
        onClick={onOpenCompose}
        className="inline-flex items-center justify-center space-x-2 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 text-white font-semibold text-xs shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_2px_4px_rgba(0,0,0,0.3)] transition active:scale-[0.98]"
      >
        <Plus className="w-3.5 h-3.5" />
        <span>Compose Campaign</span>
      </button>
    </div>
  );
};
