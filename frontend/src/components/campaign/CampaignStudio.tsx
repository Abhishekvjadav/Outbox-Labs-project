import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  SenderDTO, 
  parseAndValidateLeads, 
  calculateCampaignEstimate, 
  CsvValidationResult 
} from '@reachflow/shared';
import { apiClient } from '../../lib/api';
import { 
  ArrowLeft, 
  Paperclip, 
  Clock, 
  Send, 
  UploadCloud, 
  Sparkles, 
  CheckCircle, 
  AlertCircle, 
  X, 
  Bold, 
  Italic, 
  Underline, 
  Strikethrough, 
  List, 
  ListOrdered, 
  AlignLeft, 
  AlignCenter, 
  AlignRight, 
  Quote, 
  Code, 
  Undo, 
  Redo, 
  FileText
} from 'lucide-react';
import { format, addDays, setHours, setMinutes, addHours } from 'date-fns';

interface CampaignStudioProps {
  senders: SenderDTO[];
  onCampaignCreated: () => void;
  onCancel: () => void;
}

interface AttachmentItem {
  id: string;
  name: string;
  size: number;
  type: string;
}

export const CampaignStudio: React.FC<CampaignStudioProps> = ({
  senders,
  onCampaignCreated,
  onCancel,
}) => {
  // Campaign Basics
  const [name, setName] = useState('Outreach Sequence');
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
  }, [senders, selectedSenderIds.length]);

  // Lead State & Recipient Chips
  const [recipientInput, setRecipientInput] = useState('');
  const [recipientChips, setRecipientChips] = useState<string[]>([
    'sarah.connor@cyberdyne.net',
    'alex.miller@apexflow.com',
  ]);
  const [csvResult, setCsvResult] = useState<CsvValidationResult | null>(null);

  // Parse initial chips
  useEffect(() => {
    const parsed = parseAndValidateLeads(recipientChips);
    setCsvResult(parsed);
  }, [recipientChips]);

  // Scheduling Parameters
  const [scheduleDate, setScheduleDate] = useState<Date>(() => new Date(Date.now() + 30000));
  const [delaySeconds, setDelaySeconds] = useState(2);
  const [hourlyLimit, setHourlyLimit] = useState(100);

  // Send Later Popover State
  const [isSendLaterOpen, setIsSendLaterOpen] = useState(false);
  const sendLaterRef = useRef<HTMLDivElement>(null);

  // Attachments State
  const [attachments, setAttachments] = useState<AttachmentItem[]>([
    { id: '1', name: 'reachflow-specs.pdf', size: 245000, type: 'application/pdf' },
  ]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form Processing State
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Click outside to close Send Later Popover
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (sendLaterRef.current && !sendLaterRef.current.contains(e.target as Node)) {
        setIsSendLaterOpen(false);
      }
    };
    if (isSendLaterOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isSendLaterOpen]);

  // Handle Add Recipient Chip via Enter or comma
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
      const updated = [...recipientChips, val];
      setRecipientChips(updated);
      setRecipientInput('');
    }
  };

  const removeRecipientChip = (chipToRemove: string) => {
    setRecipientChips(recipientChips.filter((c) => c !== chipToRemove));
  };

  // Load 10 Demo Leads
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
    setRecipientChips(demoLeads);
  };

  // Handle CSV / Text Upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      const lines = content.split(/[\r\n,;]+/).map((s) => s.trim()).filter(Boolean);
      const combined = Array.from(new Set([...recipientChips, ...lines]));
      setRecipientChips(combined);
    };
    reader.readAsText(file);
    if (e.target) e.target.value = '';
  };

  // Handle Attachment Upload
  const handleAttachmentUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newAttachments: AttachmentItem[] = Array.from(files).map((f) => ({
      id: Math.random().toString(36).substring(2, 9),
      name: f.name,
      size: f.size,
      type: f.type,
    }));

    setAttachments([...attachments, ...newAttachments]);
    if (e.target) e.target.value = '';
  };

  const removeAttachment = (id: string) => {
    setAttachments(attachments.filter((a) => a.id !== id));
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Quick Scheduling Presets
  const handlePresetSchedule = (type: 'tomorrow-10' | 'tomorrow-11' | 'tomorrow-15' | 'plus-1h') => {
    const now = new Date();
    let target = new Date();
    if (type === 'tomorrow-10') {
      target = setMinutes(setHours(addDays(now, 1), 10), 0);
    } else if (type === 'tomorrow-11') {
      target = setMinutes(setHours(addDays(now, 1), 11), 0);
    } else if (type === 'tomorrow-15') {
      target = setMinutes(setHours(addDays(now, 1), 15), 0);
    } else if (type === 'plus-1h') {
      target = addHours(now, 1);
    }
    setScheduleDate(target);
  };

  // Calculate campaign completion estimate
  const estimate = useMemo(() => {
    const validCount = csvResult?.valid || 0;
    return calculateCampaignEstimate(
      validCount,
      Math.max(1, selectedSenderIds.length),
      hourlyLimit,
      delaySeconds * 1000
    );
  }, [csvResult?.valid, selectedSenderIds.length, hourlyLimit, delaySeconds]);

  // Handle Campaign Submit
  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    if (!csvResult || csvResult.valid === 0) {
      setError('Please add or upload at least one valid recipient email address.');
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
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to schedule campaign');
    } finally {
      setLoading(false);
    }
  };

  const isScheduleInFuture = scheduleDate.getTime() > Date.now() + 60000;

  return (
    <div className="max-w-5xl mx-auto bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden font-sans">
      {/* 1. Top Compose Bar */}
      <div className="px-6 py-3.5 border-b border-slate-200 flex items-center justify-between bg-white">
        <div className="flex items-center space-x-3">
          <button
            onClick={onCancel}
            className="p-1 rounded-md text-slate-400 hover:text-slate-800 hover:bg-slate-100 transition"
            title="Cancel & Back"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <span className="text-sm font-semibold text-slate-900 tracking-tight">
            Compose New Email
          </span>
        </div>

        {/* Action Controls */}
        <div className="flex items-center space-x-2.5 relative">
          {/* Attachment Icon Button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="Attach files"
            className="p-2 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 border border-slate-200 transition"
          >
            <Paperclip className="w-4 h-4" />
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleAttachmentUpload}
            multiple
            className="hidden"
          />

          {/* Schedule / Clock Button */}
          <div className="relative" ref={sendLaterRef}>
            <button
              type="button"
              onClick={() => setIsSendLaterOpen(!isSendLaterOpen)}
              title="Schedule Send Time"
              className={`p-2 rounded-lg border transition flex items-center space-x-1.5 ${
                isScheduleInFuture
                  ? 'bg-amber-50 text-amber-800 border-amber-300'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100 border-slate-200'
              }`}
            >
              <Clock className="w-4 h-4" />
              {isScheduleInFuture && (
                <span className="text-[11px] font-medium font-mono hidden sm:inline">
                  {format(scheduleDate, 'MMM dd, h:mm a')}
                </span>
              )}
            </button>

            {/* Send Later Popover */}
            {isSendLaterOpen && (
              <div className="absolute right-0 top-full mt-2 w-72 bg-white rounded-xl border border-slate-200 shadow-popover p-4 z-50 space-y-3 font-sans animate-in fade-in zoom-in-95 duration-150">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Send Later</span>
                  </span>
                  <button
                    onClick={() => setIsSendLaterOpen(false)}
                    className="text-slate-400 hover:text-slate-600"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Quick Presets */}
                <div className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Quick Options
                  </span>
                  <div className="grid grid-cols-1 gap-1 pt-1">
                    <button
                      type="button"
                      onClick={() => handlePresetSchedule('tomorrow-10')}
                      className="text-left px-2.5 py-1.5 rounded-lg text-xs text-slate-700 hover:bg-slate-50 hover:text-emerald-700 border border-transparent hover:border-slate-200 transition flex items-center justify-between"
                    >
                      <span>Tomorrow, 10:00 AM</span>
                      <span className="text-[10px] text-slate-400 font-mono">Default</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handlePresetSchedule('tomorrow-11')}
                      className="text-left px-2.5 py-1.5 rounded-lg text-xs text-slate-700 hover:bg-slate-50 hover:text-emerald-700 border border-transparent hover:border-slate-200 transition"
                    >
                      Tomorrow, 11:00 AM
                    </button>
                    <button
                      type="button"
                      onClick={() => handlePresetSchedule('tomorrow-15')}
                      className="text-left px-2.5 py-1.5 rounded-lg text-xs text-slate-700 hover:bg-slate-50 hover:text-emerald-700 border border-transparent hover:border-slate-200 transition"
                    >
                      Tomorrow, 3:00 PM
                    </button>
                    <button
                      type="button"
                      onClick={() => handlePresetSchedule('plus-1h')}
                      className="text-left px-2.5 py-1.5 rounded-lg text-xs text-slate-700 hover:bg-slate-50 hover:text-emerald-700 border border-transparent hover:border-slate-200 transition"
                    >
                      In 1 Hour
                    </button>
                  </div>
                </div>

                {/* Custom Date & Time Picker */}
                <div className="pt-2 border-t border-slate-100">
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                    Pick date & time
                  </label>
                  <input
                    type="datetime-local"
                    value={format(scheduleDate, "yyyy-MM-dd'T'HH:mm")}
                    onChange={(e) => {
                      if (e.target.value) setScheduleDate(new Date(e.target.value));
                    }}
                    className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono text-slate-800 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                {/* Popover Buttons */}
                <div className="pt-2 border-t border-slate-100 flex items-center justify-end space-x-2">
                  <button
                    type="button"
                    onClick={() => {
                      setScheduleDate(new Date(Date.now() + 30000));
                      setIsSendLaterOpen(false);
                    }}
                    className="px-2.5 py-1 rounded-md text-xs text-slate-500 hover:bg-slate-100"
                  >
                    Send Now
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsSendLaterOpen(false)}
                    className="px-3 py-1 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-2xs"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Primary Green Action Button: Send / Send Later */}
          <button
            type="button"
            onClick={() => handleSubmit()}
            disabled={loading || !csvResult || csvResult.valid === 0}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-xs transition active:scale-[0.99]"
          >
            {loading ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Scheduling...</span>
              </>
            ) : isScheduleInFuture ? (
              <>
                <Clock className="w-3.5 h-3.5" />
                <span>Send Later</span>
              </>
            ) : (
              <>
                <Send className="w-3.5 h-3.5" />
                <span>Send</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="mx-6 mt-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* 2. Horizontal Email Fields */}
      <div className="divide-y divide-slate-100 text-xs">
        {/* From Field */}
        <div className="px-6 py-3 flex items-center">
          <label className="w-20 text-slate-400 font-medium select-none">From</label>
          <div className="flex-1 flex items-center space-x-2">
            <select
              value={selectedSenderIds[0] || ''}
              onChange={(e) => setSelectedSenderIds([e.target.value])}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 hover:border-slate-300 rounded-lg text-xs text-slate-900 font-medium focus:outline-none focus:border-emerald-500 transition max-w-sm"
            >
              {senders.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} &lt;{s.email}&gt; ({s.hourlyLimit}/hr quota)
                </option>
              ))}
            </select>

            <span className="text-[11px] text-slate-400 font-mono hidden md:inline">
              Quota: {senders.find((s) => s.id === selectedSenderIds[0])?.hourlyLimit || 100} / hr
            </span>
          </div>
        </div>

        {/* To Field (Chips + Upload List CTA + Demo Leads) */}
        <div className="px-6 py-3 flex flex-col sm:flex-row sm:items-start gap-2">
          <label className="w-20 text-slate-400 font-medium select-none pt-1.5">To</label>
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-1.5 p-1.5 bg-slate-50/70 border border-slate-200 rounded-lg focus-within:border-emerald-500 focus-within:bg-white transition min-h-[38px]">
              {recipientChips.map((chip, idx) => {
                const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(chip);
                return (
                  <span
                    key={idx}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-mono border ${
                      isValid
                        ? 'bg-white text-slate-800 border-slate-200 shadow-2xs'
                        : 'bg-rose-50 text-rose-700 border-rose-200'
                    }`}
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
                );
              })}

              <input
                type="email"
                value={recipientInput}
                onChange={(e) => setRecipientInput(e.target.value)}
                onKeyDown={handleKeyDownRecipient}
                onBlur={addRecipientFromInput}
                placeholder={recipientChips.length === 0 ? 'recipient@example.com (press Enter or comma)' : 'Add more...'}
                className="flex-1 min-w-[160px] bg-transparent text-xs text-slate-900 placeholder-slate-400 focus:outline-none px-1"
              />
            </div>

            {/* Recipient Action Bar & Validation Summary */}
            <div className="flex flex-wrap items-center justify-between gap-2 mt-2">
              <div className="flex items-center space-x-2">
                <label className="cursor-pointer inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-semibold border border-slate-200 transition">
                  <UploadCloud className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Upload List (CSV/TXT)</span>
                  <input type="file" accept=".csv,.txt" onChange={handleFileUpload} className="hidden" />
                </label>

                <button
                  type="button"
                  onClick={handleLoadDemoLeads}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-[11px] font-semibold border border-emerald-200 transition"
                >
                  <Sparkles className="w-3 h-3 text-emerald-600" />
                  <span>Load Demo Leads (10)</span>
                </button>
              </div>

              {/* Pre-flight Lead Badges */}
              {csvResult && (
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="text-emerald-700 font-semibold flex items-center gap-1">
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                    <span>{csvResult.valid} valid leads</span>
                  </span>
                  {csvResult.duplicates > 0 && (
                    <span className="text-amber-700 font-mono">
                      ({csvResult.duplicates} dupes merged)
                    </span>
                  )}
                  {csvResult.invalid > 0 && (
                    <span className="text-rose-600 font-mono">
                      ({csvResult.invalid} dropped)
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Subject Field */}
        <div className="px-6 py-3 flex items-center">
          <label className="w-20 text-slate-400 font-medium select-none">Subject</label>
          <input
            type="text"
            required
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject line..."
            className="flex-1 px-2 py-1 bg-transparent text-sm text-slate-900 font-semibold focus:outline-none placeholder-slate-400"
          />
        </div>

        {/* Campaign Pacing Controls (Compact Row) */}
        <div className="px-6 py-3 bg-slate-50/50 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4 text-xs">
            {/* Delay control */}
            <div className="flex items-center space-x-2">
              <span className="text-slate-500 font-medium">Delay between 2 emails</span>
              <div className="flex items-center space-x-1">
                <input
                  type="number"
                  min="1"
                  max="60"
                  value={delaySeconds}
                  onChange={(e) => setDelaySeconds(Math.max(1, parseInt(e.target.value) || 2))}
                  className="w-14 px-2 py-1 bg-white border border-slate-200 rounded-md text-xs font-mono font-semibold text-slate-800 text-center focus:outline-none focus:border-emerald-500 shadow-2xs"
                />
                <span className="text-slate-400 font-mono text-[11px]">sec</span>
              </div>
            </div>

            {/* Hourly Limit control */}
            <div className="flex items-center space-x-2">
              <span className="text-slate-500 font-medium">Hourly Limit</span>
              <div className="flex items-center space-x-1">
                <input
                  type="number"
                  min="5"
                  max="200"
                  value={hourlyLimit}
                  onChange={(e) => setHourlyLimit(Math.max(1, parseInt(e.target.value) || 100))}
                  className="w-16 px-2 py-1 bg-white border border-slate-200 rounded-md text-xs font-mono font-semibold text-slate-800 text-center focus:outline-none focus:border-emerald-500 shadow-2xs"
                />
                <span className="text-slate-400 font-mono text-[11px]">/hr</span>
              </div>
            </div>

            {/* Campaign Name */}
            <div className="flex items-center space-x-2">
              <span className="text-slate-500 font-medium">Campaign</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Sequence name"
                className="w-36 px-2 py-1 bg-white border border-slate-200 rounded-md text-xs text-slate-800 focus:outline-none focus:border-emerald-500 shadow-2xs"
              />
            </div>
          </div>

          {/* Delivery Estimation Summary */}
          <div className="text-[11px] text-slate-500 font-mono flex items-center space-x-2">
            <span>Est. duration:</span>
            <strong className="text-slate-800 font-semibold">{estimate.estimatedDurationHuman}</strong>
          </div>
        </div>
      </div>

      {/* 3. Rich-Text Email Editor */}
      <div className="p-6 space-y-3">
        {/* Editor Toolbar */}
        <div className="p-1.5 bg-slate-50 border border-slate-200 rounded-lg flex flex-wrap items-center gap-1 text-slate-600">
          <button
            type="button"
            className="p-1 rounded hover:bg-white hover:text-slate-900 transition"
            title="Undo"
          >
            <Undo className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            className="p-1 rounded hover:bg-white hover:text-slate-900 transition"
            title="Redo"
          >
            <Redo className="w-3.5 h-3.5" />
          </button>

          <span className="w-px h-4 bg-slate-200 mx-1" />

          <button
            type="button"
            className="p-1 rounded hover:bg-white hover:text-slate-900 transition"
            title="Bold"
          >
            <Bold className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            className="p-1 rounded hover:bg-white hover:text-slate-900 transition"
            title="Italic"
          >
            <Italic className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            className="p-1 rounded hover:bg-white hover:text-slate-900 transition"
            title="Underline"
          >
            <Underline className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            className="p-1 rounded hover:bg-white hover:text-slate-900 transition"
            title="Strikethrough"
          >
            <Strikethrough className="w-3.5 h-3.5" />
          </button>

          <span className="w-px h-4 bg-slate-200 mx-1" />

          <button
            type="button"
            className="p-1 rounded hover:bg-white hover:text-slate-900 transition"
            title="Bullet List"
          >
            <List className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            className="p-1 rounded hover:bg-white hover:text-slate-900 transition"
            title="Numbered List"
          >
            <ListOrdered className="w-3.5 h-3.5" />
          </button>

          <span className="w-px h-4 bg-slate-200 mx-1" />

          <button
            type="button"
            className="p-1 rounded hover:bg-white hover:text-slate-900 transition"
            title="Align Left"
          >
            <AlignLeft className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            className="p-1 rounded hover:bg-white hover:text-slate-900 transition"
            title="Align Center"
          >
            <AlignCenter className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            className="p-1 rounded hover:bg-white hover:text-slate-900 transition"
            title="Align Right"
          >
            <AlignRight className="w-3.5 h-3.5" />
          </button>

          <span className="w-px h-4 bg-slate-200 mx-1" />

          <button
            type="button"
            className="p-1 rounded hover:bg-white hover:text-slate-900 transition"
            title="Quote"
          >
            <Quote className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            className="p-1 rounded hover:bg-white hover:text-slate-900 transition"
            title="Code Block"
          >
            <Code className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Textarea Workspace */}
        <textarea
          rows={10}
          required
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Type Your Reply..."
          className="w-full p-4 bg-white border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:border-emerald-500 transition resize-y leading-relaxed font-sans shadow-2xs min-h-[220px]"
        />

        {/* 4. Uploaded Attachments Display */}
        {attachments.length > 0 && (
          <div className="pt-2">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-2">
              Attached Files ({attachments.length})
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
              {attachments.map((file) => (
                <div
                  key={file.id}
                  className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between text-xs group"
                >
                  <div className="flex items-center space-x-2.5 min-w-0 pr-2">
                    <FileText className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="font-medium text-slate-800 truncate">{file.name}</p>
                      <p className="text-[10px] text-slate-400 font-mono">{formatFileSize(file.size)}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeAttachment(file.id)}
                    className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition"
                    title="Remove attachment"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 5. Bottom Status Bar */}
      <div className="px-6 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-between text-xs text-slate-500">
        <div className="flex items-center space-x-3">
          <span className="flex items-center gap-1.5">
            <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
            <span>BullMQ Delayed Queue Schedule</span>
          </span>
          <span className="text-slate-300">|</span>
          <span>Zero Cron Jobs</span>
        </div>

        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-200 transition"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => handleSubmit()}
            disabled={loading || !csvResult || csvResult.valid === 0}
            className="px-4 py-1.5 rounded-lg text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 transition shadow-2xs"
          >
            {loading ? 'Scheduling...' : isScheduleInFuture ? 'Schedule Email' : 'Send Immediately'}
          </button>
        </div>
      </div>
    </div>
  );
};
