import React from 'react';
import { EmailDTO, EmailEventDTO, EventType } from '@reachflow/shared';
import { X, CheckCircle2, Clock, AlertTriangle, ShieldCheck, Mail, Search, ExternalLink } from 'lucide-react';
import { format } from 'date-fns';

interface DeliveryTimelineModalProps {
  email: EmailDTO | null;
  events: EmailEventDTO[];
  isOpen: boolean;
  onClose: () => void;
}

export const DeliveryTimelineModal: React.FC<DeliveryTimelineModalProps> = ({
  email,
  events,
  isOpen,
  onClose,
}) => {
  if (!isOpen || !email) return null;

  const getEventIcon = (type: EventType) => {
    switch (type) {
      case EventType.CAMPAIGN_CREATED:
      case EventType.JOB_ENQUEUED:
        return <Clock className="w-4 h-4 text-blue-400" />;
      case EventType.WORKER_PICKED:
        return <Mail className="w-4 h-4 text-brand-400" />;
      case EventType.RATE_LIMIT_CHECKED:
      case EventType.PROVIDER_DELAY_APPLIED:
        return <ShieldCheck className="w-4 h-4 text-emerald-400" />;
      case EventType.RATE_LIMIT_EXCEEDED:
      case EventType.RESCHEDULED_NEXT_WINDOW:
        return <AlertTriangle className="w-4 h-4 text-amber-400" />;
      case EventType.SMTP_DELIVERED:
        return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
      case EventType.INDEXED_SEARCH:
        return <Search className="w-4 h-4 text-purple-400" />;
      case EventType.FAILED_ATTEMPT:
      case EventType.DLQ_MOVED:
        return <AlertTriangle className="w-4 h-4 text-rose-400" />;
      default:
        return <Clock className="w-4 h-4 text-slate-400" />;
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/40">
          <div>
            <h3 className="text-base font-bold text-white flex items-center space-x-2">
              <span>Delivery Audit Trail</span>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-brand-500/20 text-brand-400">
                Traceability
              </span>
            </h3>
            <p className="text-xs text-slate-400 font-mono truncate max-w-sm">{email.recipient}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Email Meta Info Card */}
        <div className="p-4 mx-6 mt-4 rounded-xl bg-slate-950 border border-slate-800/80 text-xs space-y-1.5">
          <div className="flex justify-between">
            <span className="text-slate-400">Subject:</span>
            <span className="text-slate-200 font-semibold">{email.subject}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Sender Mailbox:</span>
            <span className="text-slate-300 font-mono">{email.senderEmail || 'Ethereal Sender'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Deterministic Job ID:</span>
            <span className="text-brand-400 font-mono text-[11px]">{email.jobId}</span>
          </div>
          {email.previewUrl && (
            <div className="flex justify-between items-center pt-1 border-t border-slate-800/60">
              <span className="text-slate-400">Ethereal Render:</span>
              <a
                href={email.previewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-400 hover:text-brand-300 font-semibold flex items-center space-x-1"
              >
                <span>View Rendered Email</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}
        </div>

        {/* Vertical Audit Timeline */}
        <div className="p-6 max-h-[60vh] overflow-y-auto">
          <h4 className="text-xs uppercase font-bold tracking-wider text-slate-400 mb-4">Lifecycle Events</h4>

          {events.length === 0 ? (
            <p className="text-xs text-slate-500 italic">No events recorded yet for this email.</p>
          ) : (
            <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-800">
              {events.map((ev, idx) => (
                <div key={ev.id || idx} className="relative group">
                  {/* Event icon dot */}
                  <div className="absolute -left-6 top-0.5 w-5 h-5 rounded-full bg-slate-900 border border-slate-700 flex items-center justify-center">
                    {getEventIcon(ev.type)}
                  </div>

                  {/* Event description */}
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-200">
                        {ev.type.replace(/_/g, ' ')}
                      </span>
                      <span className="text-[10px] text-slate-500 font-mono">
                        {format(new Date(ev.createdAt), 'HH:mm:ss.SSS')}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">{ev.message}</p>

                    {/* Metadata pill */}
                    {ev.metadata && Object.keys(ev.metadata).length > 0 && (
                      <div className="mt-1.5 p-2 rounded bg-slate-950/80 border border-slate-800 text-[10px] font-mono text-slate-400 overflow-x-auto">
                        <pre>{JSON.stringify(ev.metadata, null, 2)}</pre>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-800 bg-slate-950/40 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 text-slate-300 hover:bg-slate-700 transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
