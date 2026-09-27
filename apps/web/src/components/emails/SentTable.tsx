import React, { useState } from 'react';
import { EmailDTO, EmailStatus } from '@reachflow/shared';
import { Search, CheckCircle2, ListFilter, Eye, ExternalLink, Send, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';

interface SentTableProps {
  emails: EmailDTO[];
  loading: boolean;
  onViewTimeline: (email: EmailDTO) => void;
  onSearch: (q: string) => void;
  total: number;
  onOpenCompose?: () => void;
}

export const SentTable: React.FC<SentTableProps> = ({
  emails,
  loading,
  onViewTimeline,
  onSearch,
  total,
  onOpenCompose,
}) => {
  const [searchInput, setSearchInput] = useState('');

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchInput(val);
    onSearch(val);
  };

  const renderStatusBadge = (email: EmailDTO) => {
    switch (email.status) {
      case EmailStatus.SENT:
        return (
          <div className="inline-flex flex-col">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-mono font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span>DELIVERED</span>
            </span>
            <span className="text-[10px] text-slate-400 font-mono mt-0.5">SMTP 250 Accepted</span>
          </div>
        );
      case EmailStatus.FAILED:
        return (
          <div className="inline-flex flex-col">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-mono font-medium bg-rose-500/10 text-rose-400 border border-rose-500/20">
              <AlertTriangle className="w-3 h-3 text-rose-400" />
              <span>FAILED (DLQ)</span>
            </span>
            <span className="text-[10px] text-rose-400/80 font-mono mt-0.5">Dead-Letter Isolated</span>
          </div>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-mono bg-surface-50 text-slate-400 border border-white/[0.06]">
            {email.status}
          </span>
        );
    }
  };

  return (
    <div className="space-y-3">
      {/* Control Bar: Filter, Total Telemetry & Query indicator */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchInput}
            onChange={handleSearchChange}
            placeholder="Search sent log via Elasticsearch..."
            className="w-full pl-8 pr-3 py-1.5 bg-surface-card border border-white/[0.08] hover:border-white/[0.15] focus:border-brand-500 rounded-lg text-xs text-white placeholder-slate-400 focus:outline-none transition font-mono shadow-inset-subtle"
          />
        </div>

        <div className="flex items-center gap-3 text-xs font-mono text-slate-400 self-end sm:self-auto">
          <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-surface-card border border-white/[0.06]">
            <ListFilter className="w-3 h-3 text-emerald-400" />
            <span className="text-[11px]">DISPATCHED TOTAL:</span>
            <span className="font-semibold text-white tabular-nums">{total}</span>
          </div>
        </div>
      </div>

      {/* High-Density Data Grid Card */}
      <div className="bg-surface-card border border-white/[0.08] rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-surface-overlay/80 border-b border-white/[0.06] text-[11px] text-slate-400 font-mono uppercase tracking-wider">
              <tr>
                <th className="px-3.5 py-2.5">Recipient & Entity</th>
                <th className="px-3.5 py-2.5">Subject & Delivery ID</th>
                <th className="px-3.5 py-2.5">Sender Mailbox</th>
                <th className="px-3.5 py-2.5">Delivered Timestamp</th>
                <th className="px-3.5 py-2.5">Engine Delivery State</th>
                <th className="px-3.5 py-2.5">Live SMTP Verification</th>
                <th className="px-3.5 py-2.5 text-right">Audit Trail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td className="px-3.5 py-3">
                      <div className="h-3.5 bg-surface-50 rounded w-36 mb-1" />
                      <div className="h-2.5 bg-surface-50/60 rounded w-20" />
                    </td>
                    <td className="px-3.5 py-3">
                      <div className="h-3.5 bg-surface-50 rounded w-48" />
                    </td>
                    <td className="px-3.5 py-3">
                      <div className="h-3.5 bg-surface-50 rounded w-32" />
                    </td>
                    <td className="px-3.5 py-3">
                      <div className="h-3.5 bg-surface-50 rounded w-28" />
                    </td>
                    <td className="px-3.5 py-3">
                      <div className="h-3.5 bg-surface-50 rounded w-24" />
                    </td>
                    <td className="px-3.5 py-3">
                      <div className="h-3.5 bg-surface-50 rounded w-24" />
                    </td>
                    <td className="px-3.5 py-3 text-right">
                      <div className="h-6 bg-surface-50 rounded w-16 ml-auto" />
                    </td>
                  </tr>
                ))
              ) : emails.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-16 px-4">
                    <div className="flex flex-col items-center justify-center max-w-sm mx-auto space-y-3">
                      <div className="w-10 h-10 rounded-xl bg-surface-overlay border border-white/[0.08] flex items-center justify-center text-slate-400 shadow-inset-subtle">
                        <CheckCircle2 className="w-5 h-5 text-slate-400" />
                      </div>
                      <div>
                        <h4 className="text-xs font-semibold text-slate-200">No Dispatches Finalized Yet</h4>
                        <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                          Once worker threads process scheduled dispatches and receive SMTP 250 responses, verified events appear here.
                        </p>
                      </div>
                      {onOpenCompose && (
                        <button
                          onClick={onOpenCompose}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-overlay hover:bg-surface-50 text-slate-200 border border-white/[0.08] hover:border-white/[0.15] text-xs font-medium transition shadow-inset-subtle"
                        >
                          <Send className="w-3.5 h-3.5 text-brand-400" />
                          <span>Dispatch Test Campaign</span>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                emails.map((email) => {
                  const [username, domain] = email.recipient.split('@');

                  return (
                    <tr
                      key={email.id}
                      onClick={() => onViewTimeline(email)}
                      className="group hover:bg-white/[0.025] transition-colors cursor-pointer"
                      title="Click row to inspect live Delivery Audit Trail"
                    >
                      {/* Recipient & Domain Chip */}
                      <td className="px-3.5 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-medium text-slate-200 group-hover:text-white transition-colors">
                            {username}@<strong className="font-bold text-slate-100">{domain}</strong>
                          </span>
                          {domain && (
                            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-surface-overlay text-slate-400 border border-white/[0.06] hidden md:inline-block">
                              {domain}
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                          Attempts: {email.attempts} | Job: {email.jobId.slice(0, 12)}...
                        </div>
                      </td>

                      {/* Subject & Delivery ID */}
                      <td className="px-3.5 py-2.5">
                        <div className="text-slate-200 font-medium truncate max-w-xs text-xs">
                          {email.subject}
                        </div>
                        <div className="text-[10px] font-mono text-slate-400 mt-0.5 truncate max-w-[200px]" title={email.messageId || ''}>
                          MsgID: <span className="text-slate-400">{email.messageId || 'Generated'}</span>
                        </div>
                      </td>

                      {/* Sender Mailbox */}
                      <td className="px-3.5 py-2.5">
                        <div className="text-slate-300 font-mono text-[11px] truncate max-w-[180px]">
                          {email.senderEmail || 'Default Ethereal'}
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono">
                          Sender ID: {email.senderId.slice(0, 8)}
                        </div>
                      </td>

                      {/* Delivered Timestamp */}
                      <td className="px-3.5 py-2.5 font-mono text-[11px] tabular-nums">
                        <div className="text-slate-200 font-medium">
                          {email.sentAt ? format(new Date(email.sentAt), 'MMM dd, HH:mm:ss') : '—'}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {email.sentAt ? 'Delivered to SMTP' : 'Pending finalization'}
                        </div>
                      </td>

                      {/* Engine Delivery State */}
                      <td className="px-3.5 py-2.5">
                        {renderStatusBadge(email)}
                      </td>

                      {/* Live SMTP Preview Link */}
                      <td className="px-3.5 py-2.5" onClick={(e) => e.stopPropagation()}>
                        {email.previewUrl ? (
                          <a
                            href={email.previewUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-brand-500/10 hover:bg-brand-500/20 text-brand-300 hover:text-brand-200 border border-brand-500/25 text-[11px] font-mono font-medium transition shadow-sm"
                            title="Open raw MIME message in Ethereal web viewer"
                          >
                            <span>Inspect SMTP</span>
                            <ExternalLink className="w-3 h-3 text-brand-400" />
                          </a>
                        ) : (
                          <span className="text-slate-400 font-mono text-[11px]">—</span>
                        )}
                      </td>

                      {/* Audit Trail Contextual Action */}
                      <td className="px-3.5 py-2.5 text-right whitespace-nowrap">
                        <div
                          className="inline-flex items-center gap-1.5 opacity-80 group-hover:opacity-100 transition-opacity"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={() => onViewTimeline(email)}
                            title="Inspect Audit Timeline"
                            className="p-1.5 rounded-md bg-surface-overlay hover:bg-surface-50 text-slate-300 hover:text-white border border-white/[0.06] transition"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

