import React, { useState } from 'react';
import { SenderDTO } from '@reachflow/shared';
import { apiClient } from '../../lib/api';
import { Mail, Plus, ShieldCheck, Zap } from 'lucide-react';

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
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-white flex items-center space-x-2">
            <span>Configured Outreach Mailboxes</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono">
              {senders.length} active
            </span>
          </h2>
          <p className="text-xs text-slate-400">
            ReachFlow balances campaigns across multiple mailboxes to maximize deliverability and avoid reputation burning.
          </p>
        </div>

        <button
          onClick={() => setShowModal(true)}
          className="inline-flex items-center space-x-2 px-3.5 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 text-white font-semibold text-xs transition"
        >
          <Plus className="w-4 h-4" />
          <span>Provision New Ethereal Mailbox</span>
        </button>
      </div>

      {/* Senders Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {senders.map((sender) => (
          <div
            key={sender.id}
            className="p-4 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition shadow-lg space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-lg bg-brand-500/10 border border-brand-500/20 flex items-center justify-center text-brand-400">
                  <Mail className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-white">{sender.name}</h3>
                  <span className="text-[10px] text-emerald-400 font-mono flex items-center space-x-1">
                    <ShieldCheck className="w-3 h-3" />
                    <span>Verified Ethereal SMTP</span>
                  </span>
                </div>
              </div>
            </div>

            <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-850 text-xs font-mono text-slate-300 truncate">
              {sender.email}
            </div>

            <div className="flex items-center justify-between text-xs text-slate-400 pt-2 border-t border-slate-800">
              <span className="flex items-center space-x-1">
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                <span>Rate Limit:</span>
              </span>
              <span className="font-bold text-white font-mono">{sender.hourlyLimit} emails/hr</span>
            </div>
          </div>
        ))}
      </div>

      {/* Provision Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-white">Provision New Test Mailbox</h3>
            <p className="text-xs text-slate-400">
              ReachFlow will automatically provision a new fake SMTP inbox using Ethereal Email.
            </p>

            <form onSubmit={handleCreateSender} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Mailbox Label</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Sales Team Mailbox C"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:border-brand-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Hourly Sending Limit</label>
                <input
                  type="number"
                  min="5"
                  required
                  value={hourlyLimit}
                  onChange={(e) => setHourlyLimit(parseInt(e.target.value, 10))}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:border-brand-500"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-400 hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 text-white font-semibold text-xs shadow-lg shadow-brand-500/20"
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
