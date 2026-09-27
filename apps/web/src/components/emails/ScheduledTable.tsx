import React, { useState } from 'react';
import { EmailDTO, EmailStatus } from '@reachflow/shared';
import { Search, Clock, ListFilter, Eye, XCircle, Send, ShieldAlert, Cpu } from 'lucide-react';
import { format } from 'date-fns';

interface ScheduledTableProps {
  emails: EmailDTO[];
  loading: boolean;
  onViewTimeline: (email: EmailDTO) => void;
  onCancelEmail: (emailId: string) => void;
  onSearch: (q: string) => void;
  total: number;
  onOpenCompose?: () => void;
}

export const ScheduledTable: React.FC<ScheduledTableProps> = ({
  emails,
  loading,
  onViewTimeline,
  onCancelEmail,
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
      case EmailStatus.SCHEDULED:
        return (
          <div className="inline-flex flex-col">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-mono font-medium bg-sky-500/10 text-sky-400 border border-sky-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
              <span>SCHEDULED</span>
            </span>
            <span className="text-[10px] text-slate-400 font-mono mt-0.5">BullMQ Delayed ZSET</span>
          </div>
        );
      case EmailStatus.QUEUED:
        return (
          <div className="inline-flex flex-col">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-mono font-medium bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
              <span>READY_IN_QUEUE</span>
            </span>
            <span className="text-[10px] text-slate-400 font-mono mt-0.5">Awaiting Worker Pick</span>
          </div>
        );
      case EmailStatus.PROCESSING:
        return (
          <div className="inline-flex flex-col">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-mono font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <Cpu className="w-3 h-3 text-amber-400 animate-spin" />
              <span>PROCESSING</span>
            </span>
            <span className="text-[10px] text-amber-400/80 font-mono mt-0.5">Active Worker Lease</span>
          </div>
        );
      case EmailStatus.RATE_LIMITED:
      case EmailStatus.RESCHEDULED:
        return (
          <div className="inline-flex flex-col">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-mono font-medium bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <ShieldAlert className="w-3 h-3 text-indigo-400" />
              <span>RATE_LIMITED</span>
            </span>
            <span className="text-[10px] text-indigo-300 font-mono mt-0.5 flex items-center gap-1">
              <Clock className="w-2.5 h-2.5" />
              <span>Rollover: {format(new Date(email.scheduledAt), 'HH:mm:ss')}</span>
            </span>
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
            placeholder="Filter by recipient, subject, or domain..."
            className="w-full pl-8 pr-3 py-1.5 bg-surface-card border border-white/[0.08] hover:border-white/[0.15] focus:border-brand-500 rounded-lg text-xs text-white placeholder-slate-400 focus:outline-none transition font-mono shadow-inset-subtle"
          />
        </div>

        <div className="flex items-center gap-3 text-xs font-mono text-slate-400 self-end sm:self-auto">
          <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-surface-card border border-white/[0.06]">
            <ListFilter className="w-3 h-3 text-brand-400" />
            <span className="text-[11px]">ACTIVE QUEUE:</span>
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
                <th className="px-3.5 py-2.5">Subject & Campaign</th>
                <th className="px-3.5 py-2.5">Assigned Mailbox</th>
                <th className="px-3.5 py-2.5">Scheduled Dispatch</th>
                <th className="px-3.5 py-2.5">Engine Subsystem State</th>
                <th className="px-3.5 py-2.5 text-right">Actions</th>
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
                    <td className="px-3.5 py-3 text-right">
                      <div className="h-6 bg-surface-50 rounded w-16 ml-auto" />
                    </td>
                  </tr>
                ))
              ) : emails.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-16 px-4">
                    <div className="flex flex-col items-center justify-center max-w-sm mx-auto space-y-3">
                      <div className="w-10 h-10 rounded-xl bg-surface-overlay border border-white/[0.08] flex items-center justify-center text-slate-400 shadow-inset-subtle">
                        <Clock className="w-5 h-5 text-slate-400" />
                      </div>
                      <div>
                        <h4 className="text-xs font-semibold text-slate-200">No Pending Dispatches in BullMQ</h4>
                        <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                          All outbound emails have completed or no campaigns are currently queued.
                        </p>
                      </div>
                      {onOpenCompose && (
                        <button
                          onClick={onOpenCompose}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-overlay hover:bg-surface-50 text-slate-200 border border-white/[0.08] hover:border-white/[0.15] text-xs font-medium transition shadow-inset-subtle"
                        >
                          <Send className="w-3.5 h-3.5 text-brand-400" />
                          <span>Compose Outbound Campaign</span>
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
                          Job: <span className="text-slate-400">{email.jobId.slice(0, 18)}...</span>
                        </div>
                      </td>

                      {/* Subject & Campaign Metadata */}
                      <td className="px-3.5 py-2.5">
                        <div className="text-slate-200 font-medium truncate max-w-xs text-xs">
                          {email.subject}
                        </div>
                        <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                          Attempt: <span className="text-slate-400">{email.attempts} / 3</span>
                        </div>
                      </td>

                      {/* Assigned Mailbox */}
                      <td className="px-3.5 py-2.5">
                        <div className="text-slate-300 font-mono text-[11px] truncate max-w-[180px]">
                          {email.senderEmail || 'Default Ethereal'}
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono">
                          Sender ID: {email.senderId.slice(0, 8)}
                        </div>
                      </td>

                      {/* Scheduled Time & Rollover */}
                      <td className="px-3.5 py-2.5 font-mono text-[11px] tabular-nums">
                        <div className="text-slate-200 font-medium">
                          {format(new Date(email.scheduledAt), 'MMM dd, HH:mm:ss')}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {new Date(email.scheduledAt) > new Date() ? 'Delayed Trigger' : 'Immediate Dispatch'}
                        </div>
                      </td>

                      {/* Engine Subsystem State */}
                      <td className="px-3.5 py-2.5">
                        {renderStatusBadge(email)}
                      </td>

                      {/* Actions: Compact contextual group */}
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
                          <button
                            onClick={() => onCancelEmail(email.id)}
                            title="Cancel Scheduled Dispatch"
                            className="p-1.5 rounded-md bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 hover:text-rose-300 border border-rose-500/20 transition"
                          >
                            <XCircle className="w-3.5 h-3.5" />
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

