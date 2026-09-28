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
        return <Clock className="w-3.5 h-3.5 text-blue-600" />;
      case EventType.WORKER_PICKED:
        return <Mail className="w-3.5 h-3.5 text-emerald-600" />;
      case EventType.RATE_LIMIT_CHECKED:
      case EventType.PROVIDER_DELAY_APPLIED:
        return <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />;
      case EventType.RATE_LIMIT_EXCEEDED:
      case EventType.RESCHEDULED_NEXT_WINDOW:
        return <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />;
      case EventType.SMTP_DELIVERED:
        return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />;
      case EventType.INDEXED_SEARCH:
        return <Search className="w-3.5 h-3.5 text-purple-600" />;
      case EventType.FAILED_ATTEMPT:
      case EventType.DLQ_MOVED:
        return <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />;
      default:
        return <Clock className="w-3.5 h-3.5 text-slate-500" />;
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 font-sans">
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-xl shadow-popover overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
              <span>Delivery Audit Trail</span>
              <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                Traceability
              </span>
            </h3>
            <p className="text-xs text-slate-500 font-mono truncate max-w-sm">{email.recipient}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Email Meta Info Card */}
        <div className="p-3.5 mx-5 mt-4 rounded-lg bg-slate-50 border border-slate-200 text-xs space-y-1">
          <div className="flex justify-between">
            <span className="text-slate-500">Subject:</span>
            <span className="text-slate-800 font-semibold">{email.subject}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Sender Mailbox:</span>
            <span className="text-slate-700 font-mono">{email.senderEmail || 'Default Ethereal'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">BullMQ Job ID:</span>
            <span className="text-emerald-700 font-mono text-[11px]">{email.jobId}</span>
          </div>
          {email.previewUrl && (
            <div className="flex justify-between items-center pt-1 border-t border-slate-200">
              <span className="text-slate-500">Ethereal Render:</span>
              <a
                href={email.previewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-emerald-700 hover:text-emerald-800 font-semibold flex items-center space-x-1"
              >
                <span>View Rendered Email</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}
        </div>

        {/* Vertical Audit Timeline */}
        <div className="p-5 max-h-[50vh] overflow-y-auto">
          <h4 className="text-xs uppercase font-bold tracking-wider text-slate-400 mb-3">Lifecycle Events</h4>

          {events.length === 0 ? (
            <p className="text-xs text-slate-400 italic">No events recorded yet for this email.</p>
          ) : (
            <div className="relative pl-6 space-y-4 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
              {events.map((ev, idx) => (
                <div key={ev.id || idx} className="relative">
                  <div className="absolute -left-6 top-0.5 w-5 h-5 rounded-full bg-white border border-slate-300 flex items-center justify-center">
                    {getEventIcon(ev.type)}
                  </div>

                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-800">
                        {ev.type.replace(/_/g, ' ')}
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {format(new Date(ev.createdAt), 'HH:mm:ss.SSS')}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 mt-0.5">{ev.message}</p>

                    {ev.metadata && Object.keys(ev.metadata).length > 0 && (
                      <div className="mt-1 p-2 rounded bg-slate-50 border border-slate-200 text-[10px] font-mono text-slate-600 overflow-x-auto">
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
        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 flex justify-end">
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition shadow-2xs"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
