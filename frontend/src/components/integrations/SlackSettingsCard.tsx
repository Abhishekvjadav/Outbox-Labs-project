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
    <div className="max-w-3xl space-y-6 font-sans">
      <div className="pb-2 border-b border-slate-200">
        <h1 className="text-xl font-bold tracking-tight text-slate-900 flex items-center space-x-2">
          <span>Slack Operational Alerts</span>
          <span
            className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${
              isConnected
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                : 'bg-slate-100 text-slate-600'
            }`}
          >
            {isConnected ? 'Connected & Active' : 'Disconnected'}
          </span>
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Receive real-time Slack Block Kit alerts the moment a sender reaches their hourly sending limit.
        </p>
      </div>

      {/* Main Slack Card */}
      <div className="p-6 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="flex items-center space-x-3.5">
            <div className="w-12 h-12 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-800 flex-shrink-0">
              <Slack className="w-6 h-6 text-[#E01E5A]" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Slack OAuth Notification Hook</h3>
              <p className="text-xs text-slate-500 mt-0.5">
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
                className="px-3.5 py-1.5 rounded-lg bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold border border-slate-200 transition flex items-center space-x-1.5 shadow-2xs"
              >
                <Bell className="w-3.5 h-3.5 text-amber-500" />
                <span>Send Test Alert</span>
              </button>
              <button
                onClick={handleDisconnect}
                disabled={loading}
                className="px-3 py-1.5 rounded-lg text-rose-600 hover:bg-rose-50 border border-rose-200 text-xs font-semibold transition flex items-center space-x-1"
              >
                <Unlink className="w-3.5 h-3.5" />
                <span>Disconnect</span>
              </button>
            </div>
          ) : (
            <button
              onClick={handleConnectSlack}
              className="px-4 py-2 rounded-lg bg-[#4A154B] hover:bg-[#611f69] text-white text-xs font-semibold shadow-xs transition flex items-center space-x-2"
            >
              <Slack className="w-4 h-4" />
              <span>Connect Slack</span>
            </button>
          )}
        </div>

        {testSuccess && (
          <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-emerald-600" />
            <span>{testSuccess}</span>
          </div>
        )}

        {/* Architecture details */}
        <div className="p-4 rounded-lg bg-slate-50 border border-slate-200/80 space-y-1.5 text-xs">
          <h4 className="font-semibold text-slate-800 flex items-center space-x-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Distributed Alert Deduplication Invariant</span>
          </h4>
          <p className="text-slate-600 leading-relaxed text-[11px]">
            When 100 queued emails hit a sender's rate limit, Redis <code className="text-emerald-700 font-mono">SET NX</code> locks
            notification dispatching per hourly window. Exactly <strong className="text-slate-900">one</strong> Slack alert is dispatched
            per sender per hour window, preventing channel flooding while ensuring complete operational visibility.
          </p>
        </div>
      </div>
    </div>
  );
};
