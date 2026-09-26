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
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 py-6 border-b border-slate-800">
      {/* Tab buttons */}
      <div className="flex items-center space-x-2 overflow-x-auto no-scrollbar">
        <button
          onClick={() => onTabChange('scheduled')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-medium transition ${
            activeTab === 'scheduled'
              ? 'bg-brand-600 text-white shadow-lg shadow-brand-600/30'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <Calendar className="w-4 h-4" />
          <span>Scheduled Emails</span>
          <span
            className={`text-xs px-2 py-0.5 rounded-full ${
              activeTab === 'scheduled' ? 'bg-white/20 text-white' : 'bg-slate-800 text-slate-400'
            }`}
          >
            {scheduledCount}
          </span>
        </button>

        <button
          onClick={() => onTabChange('sent')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-medium transition ${
            activeTab === 'sent'
              ? 'bg-brand-600 text-white shadow-lg shadow-brand-600/30'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <CheckCircle2 className="w-4 h-4" />
          <span>Sent Emails</span>
          <span
            className={`text-xs px-2 py-0.5 rounded-full ${
              activeTab === 'sent' ? 'bg-white/20 text-white' : 'bg-slate-800 text-slate-400'
            }`}
          >
            {sentCount}
          </span>
        </button>

        <button
          onClick={() => onTabChange('senders')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-medium transition ${
            activeTab === 'senders'
              ? 'bg-brand-600 text-white shadow-lg shadow-brand-600/30'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <Mail className="w-4 h-4" />
          <span>Mailboxes</span>
        </button>

        <button
          onClick={() => onTabChange('slack')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-medium transition ${
            activeTab === 'slack'
              ? 'bg-brand-600 text-white shadow-lg shadow-brand-600/30'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <Slack className="w-4 h-4" />
          <span>Slack Alerts</span>
        </button>
      </div>

      {/* Primary Call to Action */}
      <button
        onClick={onOpenCompose}
        className="inline-flex items-center justify-center space-x-2 px-4 py-2 rounded-lg bg-gradient-to-r from-brand-600 to-indigo-600 hover:from-brand-500 hover:to-indigo-500 text-white font-semibold text-sm shadow-lg shadow-brand-500/25 transition active:scale-95"
      >
        <Plus className="w-4 h-4" />
        <span>Compose Campaign</span>
      </button>
    </div>
  );
};
