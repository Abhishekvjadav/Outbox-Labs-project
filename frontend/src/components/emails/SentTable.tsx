import React, { useState } from 'react';
import { EmailDTO, EmailStatus } from '@reachflow/shared';
import { Search, CheckCircle2, Eye, ExternalLink, Send, AlertTriangle } from 'lucide-react';
import { format, isToday, isYesterday } from 'date-fns';

interface SentTableProps {
  emails: EmailDTO[];
  loading: boolean;
  onViewTimeline: (email: EmailDTO) => void;
  onSearch: (q: string) => void;
  total: number;
  onOpenCompose?: () => void;
  onSelectEmail?: (email: EmailDTO) => void;
}

export const SentTable: React.FC<SentTableProps> = ({
  emails,
  loading,
  onViewTimeline,
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

  const formatSentDate = (dateStr?: string | null) => {
    if (!dateStr) return '—';
    try {
      const d = new Date(dateStr);
      if (isToday(d)) {
        return `Today ${format(d, 'h:mm a')}`;
      }
      if (isYesterday(d)) {
        return `Yesterday ${format(d, 'h:mm a')}`;
      }
      return format(d, 'MMM dd, yyyy');
    } catch (e) {
      return dateStr;
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
            placeholder="Search sent emails via Elasticsearch..."
            className="w-full pl-9 pr-3 py-1.5 bg-white border border-slate-200 hover:border-slate-300 focus:border-emerald-500 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:outline-none transition shadow-2xs"
          />
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="font-mono bg-white border border-slate-200 px-2 py-1 rounded-md text-[11px]">
            Total Sent: <strong className="text-slate-800 font-semibold">{total}</strong>
          </span>
        </div>
      </div>

      {/* Clean Email List */}
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
              <CheckCircle2 className="w-6 h-6 text-slate-400" />
            </div>
            <h3 className="text-sm font-semibold text-slate-800">No sent emails yet</h3>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              Emails dispatched through worker threads and confirmed via SMTP will appear here.
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
              const isDelivered = email.status === EmailStatus.SENT;
              const previewText = email.body
                ? email.body.replace(/\n+/g, ' ').slice(0, 100)
                : 'No message preview...';
              const sentDate = formatSentDate(email.sentAt);

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
                      {isDelivered ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 font-mono">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          <span>Sent</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-rose-50 text-rose-700 border border-rose-200 font-mono">
                          <AlertTriangle className="w-3 h-3 text-rose-600" />
                          <span>Failed</span>
                        </span>
                      )}
                      <span className="text-[11px] text-slate-400 font-mono">
                        {sentDate}
                      </span>
                    </div>

                    <div className="text-slate-700 font-medium truncate">
                      {email.subject || '(No subject)'}
                      <span className="font-normal text-slate-500 ml-2 text-[11px]">
                        — {previewText}
                      </span>
                    </div>
                  </div>

                  {/* Right Column: Inspect SMTP & Audit Actions */}
                  <div className="flex items-center space-x-2 flex-shrink-0 self-start sm:self-center">
                    {email.previewUrl && (
                      <a
                        href={email.previewUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-50 hover:bg-slate-100 text-slate-700 hover:text-slate-900 border border-slate-200 text-[11px] font-medium transition"
                        title="Inspect rendered message in Ethereal"
                      >
                        <span>Inspect SMTP</span>
                        <ExternalLink className="w-3 h-3 text-slate-400" />
                      </a>
                    )}

                    <div
                      className="inline-flex items-center space-x-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        onClick={() => onViewTimeline(email)}
                        title="View audit timeline"
                        className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 border border-transparent hover:border-slate-200 transition"
                      >
                        <Eye className="w-3.5 h-3.5" />
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
