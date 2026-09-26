import React, { useState } from 'react';
import { apiClient } from '../../lib/api';
import { Slack, CheckCircle2, ShieldCheck, Bell, Unlink } from 'lucide-react';

interface SlackSettingsCardProps {
  slackConnection?: {
    isConnected: boolean;
    teamName?: string;
    channelName?: string;
  };
  onRefresh: () => void;
}

export const SlackSettingsCard: React.FC<SlackSettingsCardProps> = ({
  slackConnection,
  onRefresh,
}) => {
  const [loading, setLoading] = useState(false);
  const [testSuccess, setTestSuccess] = useState<string | null>(null);

  const handleConnectSlack = async () => {
    try {
      const { url } = await apiClient.getSlackAuthUrl();
      window.location.href = url;
    } catch (e: any) {
      alert(e.response?.data?.error || 'Failed to get Slack OAuth URL. Please check SLACK_CLIENT_ID in .env');
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Are you sure you want to disconnect Slack notifications?')) return;
    setLoading(true);
    try {
      await apiClient.disconnectSlack();
      onRefresh();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleTestAlert = async () => {
    setLoading(true);
    setTestSuccess(null);
    try {
      await apiClient.testSlackAlert();
      setTestSuccess('Live Block Kit alert dispatched to Slack channel!');
      setTimeout(() => setTestSuccess(null), 5000);
    } catch (e: any) {
      alert(e.response?.data?.error || 'Test alert failed. Ensure Slack is connected.');
    } finally {
      setLoading(false);
    }
  };

  const isConnected = slackConnection?.isConnected;

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-base font-bold text-white flex items-center space-x-2">
          <span>Slack Operational Alerts</span>
          <span
            className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${
              isConnected
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                : 'bg-slate-800 text-slate-400'
            }`}
          >
            {isConnected ? 'Connected & Active' : 'Disconnected'}
          </span>
        </h2>
        <p className="text-xs text-slate-400">
          Receive real-time Slack Block Kit alerts the moment a sender reaches their hourly sending limit.
        </p>
      </div>

      {/* Main Slack Card */}
      <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-5">
        <div className="flex items-start justify-between">
          <div className="flex items-center space-x-3.5">
            <div className="w-12 h-12 rounded-xl bg-[#4A154B]/30 border border-[#4A154B]/60 flex items-center justify-center text-white">
              <Slack className="w-6 h-6 text-[#E01E5A]" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Slack OAuth Integration</h3>
              <p className="text-xs text-slate-400">
                {isConnected
                  ? `Connected to workspace: ${slackConnection?.teamName || 'Slack Workspace'}`
                  : 'Connect your workspace to receive automated notifications'}
              </p>
            </div>
          </div>

          {isConnected ? (
            <div className="flex items-center space-x-2">
              <button
                onClick={handleTestAlert}
                disabled={loading}
                className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition flex items-center space-x-1.5"
              >
                <Bell className="w-3.5 h-3.5 text-amber-400" />
                <span>Send Test Alert</span>
              </button>
              <button
                onClick={handleDisconnect}
                disabled={loading}
                className="px-3 py-1.5 rounded-lg text-rose-400 hover:bg-rose-500/10 text-xs font-semibold transition flex items-center space-x-1"
              >
                <Unlink className="w-3.5 h-3.5" />
                <span>Disconnect</span>
              </button>
            </div>
          ) : (
            <button
              onClick={handleConnectSlack}
              className="px-4 py-2 rounded-lg bg-[#4A154B] hover:bg-[#611f69] text-white text-xs font-semibold shadow-lg shadow-[#4A154B]/30 transition flex items-center space-x-2"
            >
              <Slack className="w-4 h-4" />
              <span>Connect Slack</span>
            </button>
          )}
        </div>

        {testSuccess && (
          <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            <span>{testSuccess}</span>
          </div>
        )}

        {/* Architecture details */}
        <div className="p-4 rounded-xl bg-slate-950 border border-slate-800/80 space-y-2 text-xs">
          <h4 className="font-semibold text-slate-200 flex items-center space-x-1.5">
            <ShieldCheck className="w-4 h-4 text-brand-400" />
            <span>Distributed Alert Deduplication Invariant</span>
          </h4>
          <p className="text-slate-400 leading-relaxed text-[11px]">
            When 100 queued emails hit a sender's rate limit, Redis <code className="text-brand-300 font-mono">SET NX</code> locks
            notification dispatching per hourly window. Exactly <strong className="text-white">one</strong> Slack alert is dispatched
            per sender per hour window, preventing channel flooding while ensuring complete operational visibility.
          </p>
        </div>
      </div>
    </div>
  );
};
