import React, { useState } from 'react';
import { ArrowLeft, KeyRound, Lock, ShieldCheck } from 'lucide-react';
import type { Language } from '../i18n/translations.ts';
import { TRANSLATIONS } from '../i18n/translations.ts';
import type { StaffUserPublic } from '../shared/types.ts';

interface StaffLoginPageProps {
  lang: Language;
  onSuccess: (token: string, staff: StaffUserPublic) => void;
  onBack: () => void;
}

const DEMO_ACCOUNTS = [
  { code: 'STAFF-HOPD-1', email: 'opd.staff@queueless.org', role: 'Hospital OPD Staff (Counters 1–3)' },
  { code: 'STAFF-BANK-1', email: 'bank.staff@queueless.org', role: 'Bank Counter Staff (Counters 4–6)' },
  { code: 'STAFF-PASS-1', email: 'pass.staff@queueless.org', role: 'Passport Office Staff (Counters 7–8)' },
  { code: 'STAFF-LIB-1', email: 'lib.staff@queueless.org', role: 'Library Desk Staff (Counter 9)' },
  { code: 'SUPV-ADMIN-1', email: 'supervisor@queueless.org', role: 'Facility Supervisor (All Desks + SOS)' },
];

export function StaffLoginPage({ lang, onSuccess, onBack }: StaffLoginPageProps) {
  const t = TRANSLATIONS[lang];
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/staff/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
      });
      const data = (await res.json()) as {
        token?: string;
        staff?: StaffUserPublic;
        error?: string;
      };
      if (!res.ok || !data.token || !data.staff) {
        setError(data.error || 'Authentication failed.');
        return;
      }
      onSuccess(data.token, data.staff);
    } catch {
      setError('Unable to contact authentication server.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-[960px] mx-auto px-4 sm:px-6 py-10">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Back to Public Queue Portal</span>
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-5 ql-surface">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900">{t.staffLoginTitle}</h1>
              <p className="text-xs text-slate-600 mt-0.5 ql-muted">{t.staffLoginSub}</p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-slate-800 mb-1">
                Staff ID or Email
              </label>
              <input
                type="text"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="STAFF-HOPD-1 or opd.staff@queueless.org"
                required
                className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-2 focus:outline-blue-700"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-800 mb-1">
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter staff password"
                  required
                  className="w-full pl-10 pr-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-2 focus:outline-blue-700"
                />
              </div>
            </div>

            {error && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 px-4 bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-60"
            >
              {submitting ? 'Signing In...' : 'Sign In to Counter Operations'}
            </button>
          </form>
        </div>

        {/* Demo Credentials Reference */}
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-6 space-y-4 ql-surface">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <KeyRound className="w-4 h-4 text-blue-700" />
            <span>Demo Staff Credentials (Click to Fill)</span>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed ql-muted">
            Select any role below to populate the login form. Counter Staff see only their assigned
            counters and service queues; Supervisor has full visibility across all 9 counters and
            Emergency SOS alerts.
          </p>
          <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
            {DEMO_ACCOUNTS.map((acc) => (
              <button
                key={acc.code}
                type="button"
                onClick={() => {
                  setIdentifier(acc.email);
                  setPassword('QueueStaff#2026');
                  setError(null);
                }}
                className="w-full px-4 py-3 text-left hover:bg-slate-50 transition-colors flex items-center justify-between gap-3"
              >
                <div>
                  <div className="text-sm font-semibold text-slate-900">{acc.role}</div>
                  <div className="text-xs font-mono-tabular text-slate-600 mt-0.5">
                    {acc.code} · {acc.email}
                  </div>
                </div>
                <span className="text-xs font-semibold text-blue-700 shrink-0">Use</span>
              </button>
            ))}
          </div>
          <div className="text-xs font-mono-tabular text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
            Demo Password: <strong className="text-slate-900">QueueStaff#2026</strong>
          </div>
        </div>
      </div>
    </div>
  );
}
