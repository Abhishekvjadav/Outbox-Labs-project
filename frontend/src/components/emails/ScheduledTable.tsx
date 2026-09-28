import React, { useState } from 'react';
import { EmailDTO, EmailStatus } from '@reachflow/shared';
import { Search, Clock, Eye, XCircle, Send, ShieldAlert, Cpu } from 'lucide-react';
import { format, isToday, isTomorrow } from 'date-fns';

interface ScheduledTableProps {
  emails: EmailDTO[];
  loading: boolean;
  onViewTimeline: (email: EmailDTO) => void;
  onCancelEmail: (emailId: string) => void;
  onSearch: (q: string) => void;
  total: number;
  onOpenCompose?: () => void;
  onSelectEmail?: (email: EmailDTO) => void;
}

export const ScheduledTable: React.FC<ScheduledTableProps> = ({
  emails,
  loading,
  onViewTimeline,
  onCancelEmail,
  onSearch,
  total,
  onOpenCompose,
  onSelectEmail,
}) => {
  const [searchInput, setSearchInput] = useState('');

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchInput(val);
    onSearch(val);
  };

  const formatScheduleBadge = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      if (isToday(d)) {
        return `Today ${format(d, 'h:mm a')}`;
      }
      if (isTomorrow(d)) {
        return `Tomorrow ${format(d, 'h:mm a')}`;
      }
      return format(d, 'MMM dd, h:mm a');
    } catch (e) {
      return dateStr;
    }
  };

  const renderStatusBadge = (email: EmailDTO) => {
    switch (email.status) {
      case EmailStatus.SCHEDULED:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
            <Clock className="w-3 h-3 text-amber-500" />
            <span>Scheduled</span>
          </span>
        );
      case EmailStatus.QUEUED:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-sky-50 text-sky-700 border border-sky-200">
            <span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse" />
            <span>In Queue</span>
          </span>
        );
      case EmailStatus.PROCESSING:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
            <Cpu className="w-3 h-3 text-emerald-600 animate-spin" />
            <span>Sending</span>
          </span>
        );
      case EmailStatus.RATE_LIMITED:
      case EmailStatus.RESCHEDULED:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-indigo-50 text-indigo-700 border border-indigo-200">
            <ShieldAlert className="w-3 h-3 text-indigo-500" />
            <span>Rate Limited</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-600">
            {email.status}
          </span>
        );
    }
  };

  return (
    <div className="space-y-3 font-sans">
      {/* Top Search / Filter Row */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1 sm:max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchInput}
            onChange={handleSearchChange}
            placeholder="Search scheduled emails by recipient or subject..."
            className="w-full pl-9 pr-3 py-1.5 bg-white border border-slate-200 hover:border-slate-300 focus:border-emerald-500 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:outline-none transition shadow-2xs"
          />
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="font-mono bg-white border border-slate-200 px-2 py-1 rounded-md text-[11px]">
            Total Scheduled: <strong className="text-slate-800 font-semibold">{total}</strong>
          </span>
        </div>
      </div>

      {/* Clean Email List (Modern Email Client Style) */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
        {loading ? (
          <div className="divide-y divide-slate-100">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="p-4 flex items-center justify-between animate-pulse">
                <div className="space-y-2 flex-1 max-w-xl">
                  <div className="h-3.5 bg-slate-100 rounded w-48" />
                  <div className="h-3 bg-slate-100 rounded w-80" />
                </div>
                <div className="h-6 bg-slate-100 rounded w-24" />
              </div>
            ))}
          </div>
        ) : emails.length === 0 ? (
          <div className="text-center py-16 px-4">
            <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mx-auto mb-3">
              <Clock className="w-6 h-6 text-slate-400" />
            </div>
            <h3 className="text-sm font-semibold text-slate-800">No scheduled emails</h3>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              Your scheduled queue is empty. Use the Compose button to create and schedule a campaign sequence.
            </p>
            {onOpenCompose && (
              <button
                onClick={onOpenCompose}
                className="mt-4 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition shadow-2xs"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Compose Email</span>
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {emails.map((email) => {
              const scheduleBadge = formatScheduleBadge(email.scheduledAt);
              const previewText = email.body
                ? email.body.replace(/\n+/g, ' ').slice(0, 100)
                : 'No message preview...';

              return (
                <div
                  key={email.id}
                  onClick={() => onSelectEmail ? onSelectEmail(email) : onViewTimeline(email)}
                  className="group px-4 py-3 hover:bg-slate-50/80 transition-colors cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                >
                  {/* Left Column: Recipient & Subject & Snippet */}
                  <div className="min-w-0 flex-1 pr-4">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="font-semibold text-slate-900 text-xs">
                        To: {email.recipient}
                      </span>
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200/80 font-mono">
                        {scheduleBadge}
                      </span>
                    </div>

                    <div className="text-slate-700 font-medium truncate">
                      {email.subject || '(No subject)'}
                      <span className="font-normal text-slate-500 ml-2 text-[11px]">
                        — {previewText}
                      </span>
                    </div>
                  </div>

                  {/* Right Column: Status & Quick Actions */}
                  <div className="flex items-center space-x-3 flex-shrink-0 self-start sm:self-center">
                    {renderStatusBadge(email)}

                    <div
                      className="inline-flex items-center space-x-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        onClick={() => onViewTimeline(email)}
                        title="View timeline audit"
                        className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 border border-transparent hover:border-slate-200 transition"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>

                      <button
                        onClick={() => onCancelEmail(email.id)}
                        title="Cancel dispatch"
                        className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 border border-transparent hover:border-rose-200 transition"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
