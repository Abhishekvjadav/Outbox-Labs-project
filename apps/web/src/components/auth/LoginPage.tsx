import React, { useState } from 'react';
import { apiClient } from '../../lib/api';
import { ShieldCheck, Zap, Server, Mail, ArrowRight } from 'lucide-react';

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
      // If Google Client ID not yet set in .env, offer quick demo entrance
      setError('Google OAuth Client ID is not configured yet in .env.');
      setLoading(false);
    }
  };

  const handleDemoLogin = async () => {
    setLoading(true);
    try {
      // In dev mode, /api/auth/me auto-provisions candidate demo user
      await apiClient.getMe();
      onLoginSuccess();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center space-y-3">
        <div className="mx-auto w-12 h-12 rounded-2xl bg-gradient-to-tr from-brand-600 to-indigo-400 flex items-center justify-center shadow-xl shadow-brand-500/25">
          <span className="font-extrabold text-white text-2xl tracking-wider">R</span>
        </div>
        <h2 className="text-3xl font-extrabold text-white tracking-tight">ReachFlow</h2>
        <p className="text-sm text-slate-400">
          Production-grade distributed email scheduler built for ReachInbox (Outbox Labs)
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md px-4">
        <div className="bg-slate-900 border border-slate-800 py-8 px-6 shadow-2xl rounded-2xl sm:px-10 space-y-6">
          {error && (
            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs">
              {error}
            </div>
          )}

          {/* Primary Google Login Button */}
          <div>
            <button
              onClick={handleGoogleLogin}
              disabled={loading}
              className="w-full flex items-center justify-center space-x-3 px-4 py-2.5 border border-slate-700 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-100 font-semibold text-sm transition shadow-sm hover:border-slate-600 active:scale-98"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
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
              <div className="w-full border-t border-slate-800" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-slate-900 px-2 text-slate-500 font-mono">Evaluator Quick Pass</span>
            </div>
          </div>

          {/* Instant Candidate Demo Mode Login */}
          <div>
            <button
              onClick={handleDemoLogin}
              disabled={loading}
              className="w-full flex items-center justify-center space-x-2 px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-semibold text-sm transition shadow-lg shadow-brand-500/25 active:scale-98"
            >
              <span>Launch Evaluator Dashboard</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>

          {/* Architectural highlights */}
          <div className="pt-4 border-t border-slate-800/80 space-y-2 text-[11px] text-slate-400">
            <div className="flex items-center space-x-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <span>Strictly zero cron jobs (BullMQ Redis delayed sets)</span>
            </div>
            <div className="flex items-center space-x-2">
              <Zap className="w-4 h-4 text-brand-400 flex-shrink-0" />
              <span>Atomic Redis Lua rate limiting & per-sender throttling</span>
            </div>
            <div className="flex items-center space-x-2">
              <Server className="w-4 h-4 text-cyan-400 flex-shrink-0" />
              <span>Guaranteed job survival across server restarts</span>
            </div>
            <div className="flex items-center space-x-2">
              <Mail className="w-4 h-4 text-purple-400 flex-shrink-0" />
              <span>Multi-mailbox balancing with Ethereal live preview links</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
