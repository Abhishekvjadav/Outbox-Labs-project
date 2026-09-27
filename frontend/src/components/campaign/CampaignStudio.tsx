import React, { useState, useMemo, useEffect } from 'react';
import { 
  SenderDTO, 
  parseAndValidateLeads, 
  calculateCampaignEstimate, 
  CsvValidationResult 
} from '@reachflow/shared';
import { apiClient } from '../../lib/api';
import { 
  UploadCloud, 
  AlertCircle, 
  CheckCircle, 
  Sparkles, 
  Mail, 
  Send, 
  ArrowLeft, 
  ShieldCheck, 
  Gauge, 
  Check
} from 'lucide-react';

interface CampaignStudioProps {
  senders: SenderDTO[];
  onCampaignCreated: () => void;
  onCancel: () => void;
}

export const CampaignStudio: React.FC<CampaignStudioProps> = ({
  senders,
  onCampaignCreated,
  onCancel,
}) => {
  const [name, setName] = useState('Outreach Sequence');
  const [subject, setSubject] = useState('Exclusive opportunity for your engineering team');
  const [body, setBody] = useState(
    'Hi there,\n\nWe noticed your team is building high-scale distributed systems. ReachFlow automates intelligent mailbox throttling and rate-limit recovery.\n\nBest,\nReachFlow Team'
  );
  const [selectedSenderIds, setSelectedSenderIds] = useState<string[]>(
    senders.length > 0 ? senders.map((s) => s.id) : []
  );

  useEffect(() => {
    if (senders.length > 0 && selectedSenderIds.length === 0) {
      setSelectedSenderIds(senders.map((s) => s.id));
    }
  }, [senders, selectedSenderIds.length]);

  // Lead pre-flight state
  const [csvResult, setCsvResult] = useState<CsvValidationResult | null>(null);
  const [rawText, setRawText] = useState('');

  // Schedule parameters
  const [startTime, setStartTime] = useState(() => {
    const d = new Date(Date.now() + 30000); // Default now + 30s
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  const [delayMs, setDelayMs] = useState(2000);
  const [hourlyLimit, setHourlyLimit] = useState(50);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load demo leads for quick evaluator testing
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

  const toggleSender = (senderId: string) => {
    if (selectedSenderIds.includes(senderId)) {
      if (selectedSenderIds.length > 1) {
        setSelectedSenderIds(selectedSenderIds.filter((id) => id !== senderId));
      }
    } else {
      setSelectedSenderIds([...selectedSenderIds, senderId]);
    }
  };

  const toggleAllSenders = () => {
    if (selectedSenderIds.length === senders.length) {
      if (senders.length > 0) setSelectedSenderIds([senders[0].id]);
    } else {
      setSelectedSenderIds(senders.map((s) => s.id));
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
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to schedule campaign');
    } finally {
      setLoading(false);
    }
  };

  const combinedHourlyCapacity = useMemo(() => {
    return senders
      .filter((s) => selectedSenderIds.includes(s.id))
      .reduce((acc, s) => acc + Math.min(s.hourlyLimit, hourlyLimit), 0);
  }, [senders, selectedSenderIds, hourlyLimit]);

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-in fade-in duration-200">
      {/* Studio Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-white/[0.08]">
        <div>
          <div className="flex items-center space-x-2">
            <button
              onClick={onCancel}
              className="text-xs font-medium text-slate-400 hover:text-white transition-colors flex items-center gap-1 mr-2"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back</span>
            </button>
            <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
              <span>Campaign Studio</span>
            </h1>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-brand-500/15 text-brand-400 border border-brand-500/25">
              Two-Column Planner
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Configure campaign parameters, validate recipient lists, and audit pre-flight delivery capacity.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-white bg-surface-card hover:bg-surface-50 border border-white/[0.08] transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={loading || !csvResult || csvResult.valid === 0}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold text-white bg-brand-600 hover:bg-brand-500 disabled:opacity-50 disabled:cursor-not-allowed shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_2px_4px_rgba(0,0,0,0.3)] border border-brand-400/30 transition-all active:scale-[0.98]"
          >
            {loading ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Scheduling...</span>
              </>
            ) : (
              <>
                <Send className="w-3.5 h-3.5" />
                <span>Launch Campaign</span>
              </>
            )}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs flex items-center space-x-2.5">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Two-Column Studio Layout */}
      <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT COLUMN: Campaign Content, Recipients & Schedule (7 cols) */}
        <div className="lg:col-span-7 space-y-5">
          {/* Section 1: Campaign Identity */}
          <div className="p-5 rounded-xl bg-surface-card border border-white/[0.08] shadow-sm space-y-4">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-brand-400" />
              <span>1. Campaign Details</span>
            </h2>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Campaign Name
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-surface-overlay border border-white/[0.08] focus:border-brand-500/50 rounded-lg text-sm text-white focus:outline-none transition-colors"
                placeholder="e.g. Q4 Growth & Enterprise Outreach"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Subject Line
              </label>
              <input
                type="text"
                required
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-surface-overlay border border-white/[0.08] focus:border-brand-500/50 rounded-lg text-sm text-white focus:outline-none transition-colors"
                placeholder="e.g. Scalable cold email delivery for your team"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Message Body
              </label>
              <textarea
                rows={5}
                required
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-surface-overlay border border-white/[0.08] focus:border-brand-500/50 rounded-lg text-sm text-white focus:outline-none transition-colors font-sans resize-y leading-relaxed"
                placeholder="Write your email content..."
              />
            </div>
          </div>

          {/* Section 2: Recipients / CSV Upload */}
          <div className="p-5 rounded-xl bg-surface-card border border-white/[0.08] shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-brand-400" />
                <span>2. Recipients & Leads</span>
              </h2>

              <button
                type="button"
                onClick={handleLoadDemoLeads}
                className="text-[11px] font-semibold text-brand-400 hover:text-brand-300 bg-brand-500/10 hover:bg-brand-500/20 border border-brand-500/25 px-2.5 py-1 rounded-md transition flex items-center space-x-1.5"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Load Demo Leads (10 leads)</span>
              </button>
            </div>

            {/* Upload Area / Direct Input */}
            <div className="space-y-3">
              <label className="flex flex-col items-center justify-center p-4 border border-dashed border-white/[0.12] hover:border-brand-500/50 rounded-xl cursor-pointer bg-surface-overlay/30 hover:bg-surface-overlay/60 transition-colors group">
                <UploadCloud className="w-6 h-6 text-slate-400 group-hover:text-brand-400 transition-colors" />
                <span className="text-xs font-medium text-slate-300 mt-1.5">Upload CSV with lead emails</span>
                <span className="text-[10px] text-slate-400 font-mono">Accepts .csv or comma/newline separated</span>
                <input type="file" accept=".csv,.txt" onChange={handleFileUpload} className="hidden" />
              </label>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">
                  Or Paste Email Addresses
                </label>
                <textarea
                  rows={3}
                  value={rawText}
                  onChange={(e) => handleTextChange(e.target.value)}
                  placeholder="alex@tech.io&#10;sarah@startup.com&#10;david@outboxlabs.dev"
                  className="w-full px-3 py-2 bg-surface-overlay border border-white/[0.08] focus:border-brand-500/50 rounded-lg text-xs font-mono text-white focus:outline-none transition-colors"
                />
              </div>

              {/* Pre-flight Lead Validation Card */}
              {csvResult && (
                <div className="p-3 rounded-lg bg-surface-overlay/80 border border-white/[0.08] flex items-center justify-between text-xs">
                  <div className="flex items-center space-x-3">
                    <span className="text-emerald-400 flex items-center space-x-1 font-semibold">
                      <CheckCircle className="w-3.5 h-3.5" />
                      <span>{csvResult.valid} valid leads</span>
                    </span>
                    {csvResult.duplicates > 0 && (
                      <span className="text-amber-400 font-mono text-[11px]">
                        ({csvResult.duplicates} duplicates deduplicated)
                      </span>
                    )}
                    {csvResult.invalid > 0 && (
                      <span className="text-rose-400 font-mono text-[11px]">
                        ({csvResult.invalid} invalid formats dropped)
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] font-mono text-slate-400">Pre-flight Clean</span>
                </div>
              )}
            </div>
          </div>

          {/* Section 3: Scheduling & Dispatch Pacing */}
          <div className="p-5 rounded-xl bg-surface-card border border-white/[0.08] shadow-sm space-y-4">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-brand-400" />
              <span>3. Dispatch Pacing & Timeline</span>
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Start Schedule
                </label>
                <input
                  type="datetime-local"
                  required
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full px-3 py-2 bg-surface-overlay border border-white/[0.08] focus:border-brand-500/50 rounded-lg text-xs font-mono text-white focus:outline-none transition-colors"
                />
                <p className="text-[10px] text-slate-400 mt-1">When the first email starts dispatching</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Min Inter-Send Delay (ms)
                </label>
                <div className="flex items-center space-x-2">
                  <input
                    type="number"
                    min="1000"
                    step="500"
                    required
                    value={delayMs}
                    onChange={(e) => setDelayMs(Math.max(1000, parseInt(e.target.value) || 2000))}
                    className="w-full px-3 py-2 bg-surface-overlay border border-white/[0.08] focus:border-brand-500/50 rounded-lg text-xs font-mono text-white focus:outline-none transition-colors"
                  />
                  <span className="text-xs text-slate-400 font-mono flex-shrink-0">ms/sender</span>
                </div>
                <p className="text-[10px] text-slate-400 mt-1">Guarantees safe provider throttle spacing</p>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Hourly Limit per Mailbox
              </label>
              <input
                type="number"
                min="5"
                max="200"
                required
                value={hourlyLimit}
                onChange={(e) => setHourlyLimit(Math.max(1, parseInt(e.target.value) || 50))}
                className="w-full px-3 py-2 bg-surface-overlay border border-white/[0.08] focus:border-brand-500/50 rounded-lg text-xs font-mono text-white focus:outline-none transition-colors"
              />
              <p className="text-[10px] text-slate-400 mt-1">Max dispatches per hour per individual mailbox</p>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Mailbox Fleet & Pre-Flight Delivery Telemetry (5 cols) */}
        <div className="lg:col-span-5 space-y-5 sticky top-6">
          {/* Mailbox Fleet Selector */}
          <div className="p-5 rounded-xl bg-surface-card border border-white/[0.08] shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                  <Mail className="w-3.5 h-3.5 text-brand-400" />
                  <span>Mailbox Fleet</span>
                </h2>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {selectedSenderIds.length} of {senders.length} mailboxes selected
                </p>
              </div>

              <button
                type="button"
                onClick={toggleAllSenders}
                className="text-[11px] font-medium text-brand-400 hover:text-brand-300 transition-colors"
              >
                {selectedSenderIds.length === senders.length ? 'Deselect All' : 'Select All'}
              </button>
            </div>

            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {senders.map((sender) => {
                const isSelected = selectedSenderIds.includes(sender.id);
                return (
                  <div
                    key={sender.id}
                    onClick={() => toggleSender(sender.id)}
                    className={`p-3 rounded-lg border transition-all cursor-pointer flex items-center justify-between text-xs ${
                      isSelected
                        ? 'bg-surface-overlay border-brand-500/40 shadow-sm'
                        : 'bg-surface-overlay/40 border-white/[0.04] opacity-60 hover:opacity-100'
                    }`}
                  >
                    <div className="min-w-0 pr-2">
                      <div className="flex items-center space-x-2">
                        <div
                          className={`w-4 h-4 rounded flex items-center justify-center border transition-colors ${
                            isSelected
                              ? 'bg-brand-600 border-brand-500 text-white'
                              : 'border-white/20 bg-surface-overlay'
                          }`}
                        >
                          {isSelected && <Check className="w-3 h-3" />}
                        </div>
                        <span className="font-semibold text-slate-200 truncate">{sender.name}</span>
                      </div>
                      <p className="text-[10px] font-mono text-slate-400 truncate pl-6">{sender.email}</p>
                    </div>

                    <div className="text-right flex-shrink-0">
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/[0.06] text-slate-300 border border-white/[0.08]">
                        {sender.hourlyLimit}/hr
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Pre-Flight Delivery Telemetry Card */}
          <div className="p-5 rounded-xl bg-surface-card border border-white/[0.08] shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
              <div className="flex items-center space-x-2">
                <Gauge className="w-4 h-4 text-emerald-400" />
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                  Pre-Flight Telemetry
                </h2>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Deterministic
              </span>
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between py-1 border-b border-white/[0.04]">
                <span className="text-slate-400">Total Valid Leads</span>
                <span className="font-mono font-bold text-white tabular-nums">
                  {csvResult?.valid || 0}
                </span>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-white/[0.04]">
                <span className="text-slate-400">Selected Mailbox Fleet</span>
                <span className="font-mono font-semibold text-slate-200">
                  {selectedSenderIds.length} mailboxes
                </span>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-white/[0.04]">
                <span className="text-slate-400">Fleet Hourly Capacity</span>
                <span className="font-mono font-semibold text-emerald-400">
                  {combinedHourlyCapacity} emails / hr
                </span>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-white/[0.04]">
                <span className="text-slate-400">Inter-Send Throttle Delay</span>
                <span className="font-mono text-slate-300">
                  {delayMs}ms ({delayMs / 1000}s)
                </span>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-white/[0.04]">
                <span className="text-slate-400">Estimated Duration</span>
                <span className="font-mono font-bold text-brand-300">
                  {estimate.estimatedDurationHuman}
                </span>
              </div>

              <div className="p-3 rounded-lg bg-surface-overlay/80 border border-white/[0.06] space-y-1">
                <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 block">
                  Limiting Bottleneck
                </span>
                <span className="text-xs font-medium text-slate-200 block">
                  {estimate.bottleneck === 'INTER_SEND_THROTTLE'
                    ? `Paced by Inter-Send Delay (${delayMs}ms)`
                    : 'Paced by Hourly Mailbox Quota'}
                </span>
                <p className="text-[10px] text-slate-400">
                  Round-robin dispatch distributes ~{Math.ceil((csvResult?.valid || 0) / Math.max(1, selectedSenderIds.length))} leads per sender.
                </p>
              </div>
            </div>

            {/* Launch CTA */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={loading || !csvResult || csvResult.valid === 0}
                className="w-full flex items-center justify-center space-x-2 px-4 py-3 rounded-xl text-xs font-semibold text-white bg-brand-600 hover:bg-brand-500 disabled:opacity-50 disabled:cursor-not-allowed shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_2px_4px_rgba(0,0,0,0.3)] border border-brand-400/30 transition-all active:scale-[0.98]"
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Scheduling Delayed Batches...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    <span>Schedule & Enqueue Campaign</span>
                  </>
                )}
              </button>
            </div>

            <div className="flex items-center justify-center space-x-1.5 text-[10px] text-slate-400 text-center pt-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>BullMQ persistent queue • Atomic Redis reservation • Zero dropped</span>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
};
