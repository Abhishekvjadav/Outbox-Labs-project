import React, { useState } from 'react';
import { EmailDTO, EmailStatus } from '@reachflow/shared';
import { Search, CheckCircle2, ListFilter, Eye, ExternalLink } from 'lucide-react';
import { format } from 'date-fns';

interface SentTableProps {
  emails: EmailDTO[];
  loading: boolean;
  onViewTimeline: (email: EmailDTO) => void;
  onSearch: (q: string) => void;
  total: number;
}

export const SentTable: React.FC<SentTableProps> = ({
  emails,
  loading,
  onViewTimeline,
  onSearch,
  total,
}) => {
  const [searchInput, setSearchInput] = useState('');

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchInput(val);
    onSearch(val);
  };

  const getStatusBadge = (status: EmailStatus) => {
    switch (status) {
      case EmailStatus.SENT:
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            Delivered
          </span>
        );
      case EmailStatus.FAILED:
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
            Failed (DLQ)
          </span>
        );
      default:
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-800 text-slate-400">
            {status}
          </span>
        );
    }
  };

  return (
    <div className="space-y-4">
      {/* Search & Header Stats */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchInput}
            onChange={handleSearchChange}
            placeholder="Search sent via Elasticsearch..."
            className="w-full pl-9 pr-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-brand-500"
          />
        </div>

        <div className="flex items-center space-x-2 text-xs text-slate-400">
          <ListFilter className="w-4 h-4" />
          <span>Total Dispatched: </span>
          <span className="font-semibold text-white font-mono">{total}</span>
        </div>
      </div>

      {/* Table Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/60 border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3">Recipient</th>
                <th className="px-4 py-3">Subject</th>
                <th className="px-4 py-3">Sender Mailbox</th>
                <th className="px-4 py-3">Delivered At</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Live SMTP Preview</th>
                <th className="px-4 py-3 text-right">Audit Trail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td colSpan={7} className="px-4 py-3.5">
                      <div className="h-4 bg-slate-800 rounded w-full" />
                    </td>
                  </tr>
                ))
              ) : emails.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-slate-500">
                    <div className="flex flex-col items-center space-y-2">
                      <CheckCircle2 className="w-8 h-8 text-slate-600 stroke-1" />
                      <p className="text-sm font-medium text-slate-400">No sent emails recorded yet</p>
                      <p className="text-xs text-slate-500">
                        Once BullMQ workers process scheduled dispatches, delivered messages appear here.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                emails.map((email) => (
                  <tr key={email.id} className="hover:bg-slate-800/40 transition">
                    <td className="px-4 py-3.5 font-medium text-slate-200 font-mono">{email.recipient}</td>
                    <td className="px-4 py-3.5 text-slate-300 truncate max-w-xs">{email.subject}</td>
                    <td className="px-4 py-3.5 text-slate-400 font-mono text-[11px]">
                      {email.senderEmail || 'Ethereal Sender'}
                    </td>
                    <td className="px-4 py-3.5 text-slate-300 font-mono">
                      {email.sentAt ? format(new Date(email.sentAt), 'MMM dd, HH:mm:ss') : '—'}
                    </td>
                    <td className="px-4 py-3.5">{getStatusBadge(email.status)}</td>
                    <td className="px-4 py-3.5">
                      {email.previewUrl ? (
                        <a
                          href={email.previewUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-brand-500/10 hover:bg-brand-500/20 text-brand-400 border border-brand-500/30 text-xs font-semibold transition"
                        >
                          <span>Open in Ethereal</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <span className="text-slate-500 text-[11px]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <button
                        onClick={() => onViewTimeline(email)}
                        className="inline-flex items-center space-x-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Timeline</span>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
