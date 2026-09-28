import React, { useState, useMemo, useEffect } from 'react';
import { SenderDTO, parseAndValidateLeads, calculateCampaignEstimate, CsvValidationResult } from '@reachflow/shared';
import { apiClient } from '../../lib/api';
import { 
  X, 
  UploadCloud, 
  AlertCircle, 
  Sparkles
} from 'lucide-react';
import { format } from 'date-fns';

interface ComposeModalProps {
  isOpen: boolean;
  onClose: () => void;
  senders: SenderDTO[];
  onCampaignCreated: () => void;
}

export const ComposeModal: React.FC<ComposeModalProps> = ({
  isOpen,
  onClose,
  senders,
  onCampaignCreated,
}) => {
  const [name] = useState('Outreach Campaign');
  const [subject, setSubject] = useState('Exclusive opportunity for your engineering team');
  const [body, setBody] = useState(
    'Hi there,\n\nWe noticed your team is building high-scale distributed systems. ReachFlow automates intelligent mailbox throttling and rate-limit recovery.\n\nBest regards,\nReachFlow Team'
  );
  const [selectedSenderIds, setSelectedSenderIds] = useState<string[]>(
    senders.length > 0 ? [senders[0].id] : []
  );

  useEffect(() => {
    if (senders.length > 0 && selectedSenderIds.length === 0) {
      setSelectedSenderIds([senders[0].id]);
    }
  }, [senders, selectedSenderIds]);

  const [recipientInput, setRecipientInput] = useState('');
  const [recipientChips, setRecipientChips] = useState<string[]>([
    'sarah.connor@cyberdyne.net',
    'alex.miller@apexflow.com',
  ]);
  const [csvResult, setCsvResult] = useState<CsvValidationResult | null>(null);

  useEffect(() => {
    const parsed = parseAndValidateLeads(recipientChips);
    setCsvResult(parsed);
  }, [recipientChips]);

  const [scheduleDate] = useState<Date>(() => new Date(Date.now() + 30000));
  const [delaySeconds, setDelaySeconds] = useState(2);
  const [hourlyLimit, setHourlyLimit] = useState(100);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleKeyDownRecipient = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
      e.preventDefault();
      addRecipientFromInput();
    } else if (e.key === 'Backspace' && recipientInput === '' && recipientChips.length > 0) {
      setRecipientChips(recipientChips.slice(0, -1));
    }
  };

  const addRecipientFromInput = () => {
    const val = recipientInput.trim().replace(/,$/, '');
    if (val && !recipientChips.includes(val)) {
      setRecipientChips([...recipientChips, val]);
      setRecipientInput('');
    }
  };

  const removeRecipientChip = (chipToRemove: string) => {
    setRecipientChips(recipientChips.filter((c) => c !== chipToRemove));
  };

  const handleLoadDemoLeads = () => {
    const demoLeads = [
      'john.doe@techscale.io',
      'sarah.connor@cyberdyne.net',
      'alex.miller@apexflow.com',
      'emma.watson@outreach.dev',
      'michael.scott@dunder.com',
      'dwight.schrute@dunder.com',
      'pam.beesly@dunder.com',
      'jim.halpert@dunder.com',
    ];
    setRecipientChips(demoLeads);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      const lines = content.split(/[\r\n,;]+/).map((s) => s.trim()).filter(Boolean);
      setRecipientChips(Array.from(new Set([...recipientChips, ...lines])));
    };
    reader.readAsText(file);
    if (e.target) e.target.value = '';
  };

  const estimate = useMemo(() => {
    const validCount = csvResult?.valid || 0;
    return calculateCampaignEstimate(
      validCount,
      Math.max(1, selectedSenderIds.length),
      hourlyLimit,
      delaySeconds * 1000
    );
  }, [csvResult?.valid, selectedSenderIds.length, hourlyLimit, delaySeconds]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!csvResult || csvResult.valid === 0) {
      setError('Please add at least one valid recipient.');
      return;
    }
    if (selectedSenderIds.length === 0) {
      setError('Please select a sender mailbox.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const validLeads = csvResult.leads.filter((l) => l.valid).map((l) => l.email);
      await apiClient.createCampaign({
        name,
        subject,
        body,
        senderIds: selectedSenderIds,
        leads: validLeads,
        startTime: scheduleDate,
        delayMs: delaySeconds * 1000,
        hourlyLimit,
      });

      onCampaignCreated();
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to schedule campaign');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const isScheduleInFuture = scheduleDate.getTime() > Date.now() + 60000;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 font-sans">
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-2xl shadow-popover overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center space-x-2">
            <h3 className="text-sm font-bold text-slate-900">Compose New Email</h3>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
              BullMQ Queue
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 max-h-[80vh] overflow-y-auto text-xs">
          {error && (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* From & To */}
          <div className="space-y-2.5 divide-y divide-slate-100">
            <div className="flex items-center">
              <label className="w-16 text-slate-400 font-medium">From</label>
              <select
                value={selectedSenderIds[0] || ''}
                onChange={(e) => setSelectedSenderIds([e.target.value])}
                className="flex-1 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 font-medium focus:outline-none focus:border-emerald-500"
              >
                {senders.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} &lt;{s.email}&gt; ({s.hourlyLimit}/hr)
                  </option>
                ))}
              </select>
            </div>

            <div className="pt-2 flex flex-col sm:flex-row sm:items-start gap-2">
              <label className="w-16 text-slate-400 font-medium pt-1.5">To</label>
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-1.5 p-1.5 bg-slate-50 border border-slate-200 rounded-lg focus-within:border-emerald-500 focus-within:bg-white min-h-[36px]">
                  {recipientChips.map((chip, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-white text-slate-800 border border-slate-200 shadow-2xs font-mono"
                    >
                      <span>{chip}</span>
                      <button
                        type="button"
                        onClick={() => removeRecipientChip(chip)}
                        className="text-slate-400 hover:text-slate-700"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                  <input
                    type="email"
                    value={recipientInput}
                    onChange={(e) => setRecipientInput(e.target.value)}
                    onKeyDown={handleKeyDownRecipient}
                    onBlur={addRecipientFromInput}
                    placeholder={recipientChips.length === 0 ? 'recipient@example.com' : 'Add recipient...'}
                    className="flex-1 min-w-[140px] bg-transparent text-xs text-slate-900 focus:outline-none px-1"
                  />
                </div>

                <div className="flex items-center justify-between gap-2 mt-1.5">
                  <div className="flex items-center space-x-2">
                    <label className="cursor-pointer inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-medium border border-slate-200 transition">
                      <UploadCloud className="w-3 h-3 text-emerald-600" />
                      <span>Upload List</span>
                      <input type="file" accept=".csv,.txt" onChange={handleFileUpload} className="hidden" />
                    </label>
                    <button
                      type="button"
                      onClick={handleLoadDemoLeads}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 text-[11px] font-medium border border-emerald-200 hover:bg-emerald-100"
                    >
                      <Sparkles className="w-3 h-3 text-emerald-600" />
                      <span>Demo Leads</span>
                    </button>
                  </div>
                  {csvResult && (
                    <span className="text-emerald-700 font-semibold text-[11px]">
                      {csvResult.valid} valid leads
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="pt-2 flex items-center">
              <label className="w-16 text-slate-400 font-medium">Subject</label>
              <input
                type="text"
                required
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Subject..."
                className="flex-1 px-2 py-1 bg-transparent text-xs text-slate-900 font-semibold focus:outline-none placeholder-slate-400"
              />
            </div>
          </div>

          {/* Email Body */}
          <div>
            <textarea
              rows={5}
              required
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Type your message..."
              className="w-full p-3 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:border-emerald-500 font-sans leading-relaxed"
            />
          </div>

          {/* Campaign Controls */}
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-1.5">
                <span className="text-slate-500 font-medium">Delay:</span>
                <input
                  type="number"
                  min="1"
                  max="60"
                  value={delaySeconds}
                  onChange={(e) => setDelaySeconds(Math.max(1, parseInt(e.target.value) || 2))}
                  className="w-12 px-1.5 py-0.5 bg-white border border-slate-200 rounded text-center font-mono font-semibold"
                />
                <span className="text-slate-400">s</span>
              </div>

              <div className="flex items-center space-x-1.5">
                <span className="text-slate-500 font-medium">Hourly:</span>
                <input
                  type="number"
                  min="5"
                  max="200"
                  value={hourlyLimit}
                  onChange={(e) => setHourlyLimit(Math.max(1, parseInt(e.target.value) || 100))}
                  className="w-14 px-1.5 py-0.5 bg-white border border-slate-200 rounded text-center font-mono font-semibold"
                />
                <span className="text-slate-400">/hr</span>
              </div>
            </div>

            <div className="text-[11px] text-slate-500 font-mono">
              Est: <strong className="text-slate-800">{estimate.estimatedDurationHuman}</strong>
            </div>
          </div>

          {/* Footer Submit */}
          <div className="flex items-center justify-between pt-2 border-t border-slate-100">
            <span className="text-[11px] text-slate-400 font-mono">
              {isScheduleInFuture ? `Scheduled for: ${format(scheduleDate, 'MMM dd, h:mm a')}` : 'Ready for immediate dispatch'}
            </span>

            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || !csvResult || csvResult.valid === 0}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 transition shadow-2xs"
              >
                {loading ? 'Scheduling...' : isScheduleInFuture ? 'Schedule Email' : 'Send'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
