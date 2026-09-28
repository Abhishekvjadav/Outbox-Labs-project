import React, { useState } from 'react';
import { SenderDTO } from '@reachflow/shared';
import { apiClient } from '../../lib/api';
import { Plus, ShieldCheck, Zap, X } from 'lucide-react';

interface SendersViewProps {
  senders: SenderDTO[];
  onSenderCreated: () => void;
}

export const SendersView: React.FC<SendersViewProps> = ({ senders, onSenderCreated }) => {
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [hourlyLimit, setHourlyLimit] = useState(100);
  const [showModal, setShowModal] = useState(false);

  const handleCreateSender = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await apiClient.createSender({ name, hourlyLimit });
      setName('');
      setShowModal(false);
      onSenderCreated();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to create sender');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 font-sans">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 flex items-center space-x-2">
            <span>Outreach Mailboxes</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 font-mono font-medium">
              {senders.length} active
            </span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            ReachFlow balances campaigns across multiple mailboxes to maximize deliverability and avoid provider throttling.
          </p>
        </div>

        <button
          onClick={() => setShowModal(true)}
          className="inline-flex items-center space-x-2 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs transition shadow-2xs"
        >
          <Plus className="w-4 h-4" />
          <span>Provision New Mailbox</span>
        </button>
      </div>

      {/* Senders Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {senders.map((sender) => (
          <div
            key={sender.id}
            className="p-4 rounded-xl bg-white border border-slate-200 hover:border-slate-300 transition shadow-2xs space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-700 font-bold text-xs">
                  {sender.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h3 className="text-xs font-bold text-slate-900">{sender.name}</h3>
                  <span className="text-[10px] text-emerald-700 font-mono flex items-center space-x-1">
                    <ShieldCheck className="w-3 h-3 text-emerald-600" />
                    <span>Verified Ethereal SMTP</span>
                  </span>
                </div>
              </div>
            </div>

            <div className="p-2 rounded-lg bg-slate-50 border border-slate-100 text-xs font-mono text-slate-700 truncate">
              {sender.email}
            </div>

            <div className="flex items-center justify-between text-xs text-slate-500 pt-2 border-t border-slate-100">
              <span className="flex items-center space-x-1">
                <Zap className="w-3.5 h-3.5 text-amber-500" />
                <span>Rate Limit:</span>
              </span>
              <span className="font-bold text-slate-800 font-mono">{sender.hourlyLimit} emails/hr</span>
            </div>
          </div>
        ))}
      </div>

      {/* Provision Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-5 shadow-popover space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h3 className="text-sm font-bold text-slate-900">Provision New Test Mailbox</h3>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-500">
              ReachFlow will automatically provision a new fake SMTP inbox using Ethereal Email for live evaluation.
            </p>

            <form onSubmit={handleCreateSender} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-700 font-semibold mb-1">Mailbox Label</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Sales Team Mailbox C"
                  className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Hourly Sending Limit</label>
                <input
                  type="number"
                  min="5"
                  required
                  value={hourlyLimit}
                  onChange={(e) => setHourlyLimit(parseInt(e.target.value, 10))}
                  className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-emerald-500 font-mono"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs shadow-2xs disabled:opacity-50"
                >
                  {loading ? 'Provisioning...' : 'Provision Mailbox'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
