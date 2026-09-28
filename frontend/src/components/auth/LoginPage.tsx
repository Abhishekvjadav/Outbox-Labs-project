import React, { useState } from 'react';
import { apiClient } from '../../lib/api';
import { ShieldCheck, Zap, Server, Mail, ArrowRight, Send } from 'lucide-react';

interface LoginPageProps {
  onLoginSuccess: () => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      const { url } = await apiClient.getGoogleAuthUrl();
      window.location.href = url;
    } catch (err: any) {
      setError('Google OAuth Client ID is not configured in .env. You can use Evaluator Quick Pass.');
      setLoading(false);
    }
  };

  const handleDemoLogin = async () => {
    setLoading(true);
    try {
      await apiClient.getMe();
      onLoginSuccess();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8 font-sans">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center space-y-2">
        <div className="mx-auto w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center text-white shadow-md shadow-emerald-600/20">
          <Send className="w-5 h-5" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">ReachFlow</h1>
        <p className="text-xs text-slate-500 max-w-xs mx-auto">
          Distributed Email Scheduling Engine & Intelligent Throttle Outreach Platform
        </p>
      </div>

      <div className="mt-6 sm:mx-auto sm:w-full sm:max-w-md px-4">
        <div className="bg-white border border-slate-200 py-8 px-6 shadow-sm rounded-xl sm:px-8 space-y-5">
          {error && (
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs">
              {error}
            </div>
          )}

          {/* Primary Google Login Button */}
          <div>
            <button
              onClick={handleGoogleLogin}
              disabled={loading}
              className="w-full flex items-center justify-center space-x-3 px-4 py-2.5 border border-slate-200 rounded-lg bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs transition shadow-2xs active:scale-[0.99]"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              <span>Continue with Google</span>
            </button>
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-white px-2 text-slate-400 font-mono text-[11px]">Instant Access</span>
            </div>
          </div>

          {/* Instant Candidate Demo Mode Login */}
          <div>
            <button
              onClick={handleDemoLogin}
              disabled={loading}
              className="w-full flex items-center justify-center space-x-2 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs transition shadow-xs active:scale-[0.99]"
            >
              <span>Open Outreach Workspace</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>

          {/* Highlights */}
          <div className="pt-3 border-t border-slate-100 space-y-2 text-[11px] text-slate-500">
            <div className="flex items-center space-x-2">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
              <span>BullMQ delayed queues (zero cron jobs)</span>
            </div>
            <div className="flex items-center space-x-2">
              <Zap className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
              <span>Atomic Redis Lua rate limiting & throttle pacing</span>
            </div>
            <div className="flex items-center space-x-2">
              <Server className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
              <span>Guaranteed job survival across server restarts</span>
            </div>
            <div className="flex items-center space-x-2">
              <Mail className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
              <span>Multi-mailbox balancing with Ethereal live preview</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
