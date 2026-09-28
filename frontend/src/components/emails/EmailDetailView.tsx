import React, { useState, useEffect } from 'react';
import { EmailDTO, EmailEventDTO, EmailStatus } from '@reachflow/shared';
import { apiClient } from '../../lib/api';
import { 
  ArrowLeft, 
  ExternalLink, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  FileText,
  Paperclip,
  Calendar,
  Activity
} from 'lucide-react';
import { format } from 'date-fns';

interface EmailDetailViewProps {
  email: EmailDTO;
  onBack: () => void;
  onCancelEmail?: (id: string) => void;
  onViewTimeline?: (email: EmailDTO) => void;
}

export const EmailDetailView: React.FC<EmailDetailViewProps> = ({
  email,
  onBack,
  onCancelEmail,
  onViewTimeline,
}) => {
  const [events, setEvents] = useState<EmailEventDTO[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [showEvents, setShowEvents] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const loadTimeline = async () => {
      setLoadingEvents(true);
      try {
        const res = await apiClient.getEmailTimeline(email.id);
        if (isMounted) {
          setEvents(res.timeline);
        }
      } catch (e) {
        // Fallback
      } finally {
        if (isMounted) setLoadingEvents(false);
      }
    };
    loadTimeline();
    return () => { isMounted = false; };
  }, [email.id]);

  const isSent = email.status === EmailStatus.SENT;
  const isScheduled = email.status === EmailStatus.SCHEDULED || email.status === EmailStatus.QUEUED || email.status === EmailStatus.RATE_LIMITED || email.status === EmailStatus.RESCHEDULED;

  const senderInitial = (email.senderEmail || 'O').charAt(0).toUpperCase();

  return (
    <div className="max-w-4xl mx-auto bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden font-sans">
      {/* Top Action Bar */}
      <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
        <div className="flex items-center space-x-3">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 hover:text-slate-900 transition shadow-2xs"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to list</span>
          </button>
          <span className="text-xs text-slate-400">|</span>
          <span className="text-xs font-mono text-slate-500">ID: {email.id.slice(0, 8)}</span>
        </div>

        <div className="flex items-center space-x-2">
          {email.previewUrl && (
            <a
              href={email.previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 transition"
              title="Open message in Ethereal live preview"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Inspect SMTP</span>
            </a>
          )}

          {isScheduled && onCancelEmail && (
            <button
              onClick={() => onCancelEmail(email.id)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-rose-600 hover:bg-rose-50 border border-rose-200 transition"
            >
              <XCircle className="w-3.5 h-3.5" />
              <span>Cancel Dispatch</span>
            </button>
          )}

          {onViewTimeline && (
            <button
              onClick={() => onViewTimeline(email)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 border border-slate-200 transition"
              title="View full audit trail"
            >
              <Activity className="w-3.5 h-3.5 text-slate-500" />
              <span>Audit Log</span>
            </button>
          )}
        </div>
      </div>

      {/* Email Header Block */}
      <div className="p-6 border-b border-slate-100 space-y-4">
        <h1 className="text-xl font-bold text-slate-900 tracking-tight leading-snug">
          {email.subject || '(No Subject)'}
        </h1>

        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center space-x-3.5">
            <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-800 font-bold text-sm flex items-center justify-center border border-emerald-200 flex-shrink-0">
              {senderInitial}
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-semibold text-sm text-slate-900">
                  {email.senderEmail || 'Default Mailbox'}
                </span>
                <span className="text-xs text-slate-400 font-mono">
                  &lt;{email.senderEmail || 'outreach@reachflow.dev'}&gt;
                </span>
              </div>
              <div className="text-xs text-slate-500 mt-0.5 flex items-center space-x-1.5">
                <span className="font-medium text-slate-600">To:</span>
                <span className="text-slate-800 font-mono bg-slate-100 px-1.5 py-0.5 rounded text-[11px]">
                  {email.recipient}
                </span>
              </div>
            </div>
          </div>

          <div className="text-right flex-shrink-0">
            {isSent && email.sentAt ? (
              <div className="inline-flex flex-col items-end">
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Delivered</span>
                </span>
                <span className="text-[11px] text-slate-500 font-mono mt-1">
                  {format(new Date(email.sentAt), 'MMM dd, yyyy · HH:mm:ss')}
                </span>
              </div>
            ) : (
              <div className="inline-flex flex-col items-end">
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
                  <Clock className="w-3.5 h-3.5" />
                  <span>Scheduled</span>
                </span>
                <span className="text-[11px] text-slate-500 font-mono mt-1">
                  {format(new Date(email.scheduledAt), 'MMM dd, yyyy · HH:mm:ss')}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Email Body Content */}
      <div className="p-6 text-slate-800 text-sm leading-relaxed whitespace-pre-wrap font-sans min-h-[220px]">
        {email.body || 'No message body provided.'}
      </div>

      {/* Simulated / Displayed Attachments (if any attached) */}
      <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/40">
        <div className="text-xs font-semibold text-slate-500 mb-2.5 flex items-center space-x-1.5">
          <Paperclip className="w-3.5 h-3.5 text-slate-400" />
          <span>Attachments & Transmission Data</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div className="p-2.5 rounded-lg bg-white border border-slate-200 flex items-center justify-between text-xs">
            <div className="flex items-center space-x-2.5 min-w-0">
              <FileText className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              <div className="min-w-0">
                <p className="font-medium text-slate-800 truncate">dispatch-manifest.json</p>
                <p className="text-[10px] text-slate-400 font-mono">Job: {email.jobId.slice(0, 16)}...</p>
              </div>
            </div>
            <span className="text-[10px] font-mono text-slate-400">1.2 KB</span>
          </div>

          <div className="p-2.5 rounded-lg bg-white border border-slate-200 flex items-center justify-between text-xs">
            <div className="flex items-center space-x-2.5 min-w-0">
              <Calendar className="w-4 h-4 text-slate-500 flex-shrink-0" />
              <div className="min-w-0">
                <p className="font-medium text-slate-800 truncate">pacing-rate.dat</p>
                <p className="text-[10px] text-slate-400 font-mono">Attempts: {email.attempts} / 3</p>
              </div>
            </div>
            <span className="text-[10px] font-mono text-slate-400">0.8 KB</span>
          </div>
        </div>
      </div>

      {/* Timeline Toggle & Preview */}
      <div className="px-6 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-between text-xs">
        <button
          onClick={() => setShowEvents(!showEvents)}
          className="font-medium text-emerald-700 hover:text-emerald-800 flex items-center space-x-1"
        >
          <span>{showEvents ? 'Hide Delivery Lifecycle Events' : `Show Delivery Events (${events.length})`}</span>
        </button>

        <span className="text-[11px] text-slate-400 font-mono">
          Status: <strong className="text-slate-700 font-semibold">{email.status}</strong>
        </span>
      </div>

      {/* Expanded Lifecycle Events in Detail View */}
      {showEvents && (
        <div className="p-6 border-t border-slate-200 bg-white space-y-3">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Audit History</h4>
          {loadingEvents ? (
            <p className="text-xs text-slate-400">Loading timeline...</p>
          ) : events.length === 0 ? (
            <p className="text-xs text-slate-400 italic">No events recorded.</p>
          ) : (
            <div className="relative pl-6 space-y-4 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
              {events.map((ev, idx) => (
                <div key={ev.id || idx} className="relative">
                  <div className="absolute -left-6 top-1 w-4 h-4 rounded-full bg-emerald-100 border border-emerald-500 flex items-center justify-center">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
                  </div>
                  <div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-800">{ev.type.replace(/_/g, ' ')}</span>
                      <span className="text-[11px] text-slate-400 font-mono">
                        {format(new Date(ev.createdAt), 'HH:mm:ss.SSS')}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 mt-0.5">{ev.message}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
