import React, { useState, useMemo, useEffect } from 'react';
import { SenderDTO, parseAndValidateLeads, calculateCampaignEstimate, CsvValidationResult } from '@reachflow/shared';
import { apiClient } from '../../lib/api';
import { X, UploadCloud, Clock, AlertCircle, CheckCircle, Flame, Sparkles } from 'lucide-react';

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
  const [name, setName] = useState('Outreach Campaign');
  const [subject, setSubject] = useState('Exclusive opportunity for your engineering team');
  const [body, setBody] = useState(
    'Hi there,\n\nWe noticed your team is building high-scale distributed systems. ReachFlow automates intelligent mailbox throttling and rate-limit recovery.\n\nBest,\nReachFlow Team'
  );
  const [selectedSenderIds, setSelectedSenderIds] = useState<string[]>(
    senders.length > 0 ? [senders[0].id] : []
  );

  useEffect(() => {
    if (senders.length > 0 && selectedSenderIds.length === 0) {
      setSelectedSenderIds([senders[0].id]);
    }
  }, [senders, selectedSenderIds]);

  // CSV Lead pre-flight state
  const [csvResult, setCsvResult] = useState<CsvValidationResult | null>(null);
  const [rawText, setRawText] = useState('');

  // Schedule params
  const [startTime, setStartTime] = useState(() => {
    const d = new Date(Date.now() + 30000); // Default now + 30s
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  const [delayMs, setDelayMs] = useState(2000);
  const [hourlyLimit, setHourlyLimit] = useState(50);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pre-load demo leads button for instant 5-minute evaluator demo
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
      'john.doe@techscale.io', // Intentional duplicate
      'invalid-email-format',    // Intentional invalid
    ];
    const parsed = parseAndValidateLeads(demoLeads);
    setCsvResult(parsed);
    setRawText(demoLeads.join('\n'));
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setRawText(content);
      const lines = content.split(/[\r\n,;]+/);
      const parsed = parseAndValidateLeads(lines);
      setCsvResult(parsed);
    };
    reader.readAsText(file);
  };

  const handleTextChange = (text: string) => {
    setRawText(text);
    const lines = text.split(/[\r\n,;]+/);
    const parsed = parseAndValidateLeads(lines);
    setCsvResult(parsed);
  };

  // Toggle sender selection
  const toggleSender = (senderId: string) => {
    if (selectedSenderIds.includes(senderId)) {
      if (selectedSenderIds.length > 1) {
        setSelectedSenderIds(selectedSenderIds.filter((id) => id !== senderId));
      }
    } else {
      setSelectedSenderIds([...selectedSenderIds, senderId]);
    }
  };

  // Dynamic campaign completion estimator
  const estimate = useMemo(() => {
    const validCount = csvResult?.valid || 0;
    return calculateCampaignEstimate(validCount, selectedSenderIds.length, hourlyLimit, delayMs);
  }, [csvResult?.valid, selectedSenderIds.length, hourlyLimit, delayMs]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!csvResult || csvResult.valid === 0) {
      setError('Please upload or enter at least one valid lead email address.');
      return;
    }
    if (selectedSenderIds.length === 0) {
      setError('Please select at least one sender mailbox.');
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
        startTime: new Date(startTime),
        delayMs,
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

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/40">
          <div>
            <h3 className="text-lg font-bold text-white flex items-center space-x-2">
              <span>Compose Outreach Campaign</span>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-brand-500/20 text-brand-400">
                Persistent BullMQ
              </span>
            </h3>
            <p className="text-xs text-slate-400">Schedule delayed batches with per-sender rate limiting & recovery</p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 max-h-[80vh] overflow-y-auto">
          {error && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Campaign Name & Senders */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Campaign Name</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white focus:outline-none focus:border-brand-500"
                placeholder="e.g. Q4 Growth Sequence"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Select Senders ({selectedSenderIds.length} active)
              </label>
              <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto p-1.5 bg-slate-950 border border-slate-800 rounded-lg">
                {senders.map((sender) => {
                  const isSelected = selectedSenderIds.includes(sender.id);
                  return (
                    <button
                      type="button"
                      key={sender.id}
                      onClick={() => toggleSender(sender.id)}
                      className={`text-[11px] px-2.5 py-1 rounded-md transition flex items-center space-x-1.5 ${
                        isSelected
                          ? 'bg-brand-600 text-white font-semibold'
                          : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                      }`}
                    >
                      <span>{sender.name.split(' ')[0]}</span>
                      <span className="text-[10px] opacity-75 font-mono">({sender.hourlyLimit}/hr)</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Subject & Body */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Subject</label>
            <input
              type="text"
              required
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white focus:outline-none focus:border-brand-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Email Body</label>
            <textarea
              rows={4}
              required
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white focus:outline-none focus:border-brand-500"
            />
          </div>

          {/* CSV Lead Pre-flight Validator */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-slate-300 flex items-center space-x-1">
                <span>Leads (Upload CSV / Paste Emails)</span>
              </label>
              <button
                type="button"
                onClick={handleLoadDemoLeads}
                className="text-[11px] font-semibold text-brand-400 hover:text-brand-300 flex items-center space-x-1 transition"
              >
                <Sparkles className="w-3 h-3" />
                <span>Load 10 Demo Leads</span>
              </button>
            </div>

            <div className="border-2 border-dashed border-slate-800 rounded-xl p-4 bg-slate-950/60 hover:border-slate-700 transition">
              <div className="flex items-center justify-between mb-3">
                <label className="cursor-pointer inline-flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700 transition">
                  <UploadCloud className="w-4 h-4 text-brand-400" />
                  <span>Choose CSV / TXT File</span>
                  <input type="file" accept=".csv,.txt" onChange={handleFileUpload} className="hidden" />
                </label>
                <span className="text-[11px] text-slate-500">or paste directly below</span>
              </div>

              <textarea
                rows={3}
                value={rawText}
                onChange={(e) => handleTextChange(e.target.value)}
                placeholder="alice@company.com&#10;bob@corp.org&#10;charlie@startup.ai"
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs font-mono text-slate-200 focus:outline-none focus:border-brand-500"
              />

              {/* Pre-flight badges */}
              {csvResult && (
                <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs">
                  <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center space-x-1">
                    <CheckCircle className="w-3.5 h-3.5" />
                    <span>{csvResult.valid} valid leads</span>
                  </span>
                  {csvResult.duplicates > 0 && (
                    <span className="px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30 flex items-center space-x-1">
                      <AlertCircle className="w-3.5 h-3.5" />
                      <span>{csvResult.duplicates} duplicate(s) removed</span>
                    </span>
                  )}
                  {csvResult.invalid > 0 && (
                    <span className="px-2.5 py-0.5 rounded-full bg-rose-500/15 text-rose-400 border border-rose-500/30 flex items-center space-x-1">
                      <AlertCircle className="w-3.5 h-3.5" />
                      <span>{csvResult.invalid} invalid format</span>
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Schedule Configuration */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Start Time</label>
              <input
                type="datetime-local"
                required
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:border-brand-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Inter-Send Delay (ms)</label>
              <input
                type="number"
                min="500"
                step="500"
                required
                value={delayMs}
                onChange={(e) => setDelayMs(parseInt(e.target.value, 10))}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:border-brand-500"
              />
              <span className="text-[10px] text-slate-500">Min 2000ms recommended</span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Hourly Limit / Sender</label>
              <input
                type="number"
                min="1"
                required
                value={hourlyLimit}
                onChange={(e) => setHourlyLimit(parseInt(e.target.value, 10))}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:border-brand-500"
              />
              <span className="text-[10px] text-slate-500">Enforced via Redis Lua</span>
            </div>
          </div>

          {/* Dynamic Campaign Estimator Box */}
          <div className="p-3.5 rounded-xl bg-slate-950 border border-brand-500/20 text-xs">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center space-x-1.5 text-brand-400 font-semibold">
                <Flame className="w-4 h-4" />
                <span>Estimated Completion Time</span>
              </div>
              <span className="font-bold text-white font-mono">{estimate.estimatedDurationHuman}</span>
            </div>
            <div className="text-[11px] text-slate-400 space-y-1">
              <div className="flex justify-between">
                <span>Active Senders:</span>
                <span className="text-slate-200 font-mono">{selectedSenderIds.length} mailboxes</span>
              </div>
              <div className="flex justify-between">
                <span>Combined Capacity:</span>
                <span className="text-slate-200 font-mono">{estimate.combinedCapacityPerHour} emails/hr</span>
              </div>
              <div className="flex justify-between">
                <span>Governing Bottleneck:</span>
                <span className="text-slate-200 font-mono">
                  {estimate.bottleneck === 'RATE_LIMIT' ? 'Hourly Rate Limit' : 'Inter-Send Delay Throttling'}
                </span>
              </div>
              <p className="text-[10px] text-slate-500 pt-1 italic">
                *Estimated completion assuming balanced sender distribution.
              </p>
            </div>
          </div>

          {/* Footer Submit */}
          <div className="flex items-center justify-end space-x-3 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-300 hover:bg-slate-800 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !csvResult || csvResult.valid === 0}
              className="px-5 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold shadow-lg shadow-brand-500/20 transition flex items-center space-x-2"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Enqueuing Delayed Jobs...</span>
                </>
              ) : (
                <>
                  <Clock className="w-4 h-4" />
                  <span>Schedule Campaign</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
