import React, { useState } from 'react';
import { Clock, Users, X } from 'lucide-react';
import type { Language } from '../i18n/translations.ts';
import { TRANSLATIONS } from '../i18n/translations.ts';
import { SERVICE_DOMAIN_CONFIG } from '../lib/servicesConfig.ts';
import type { QueueTokenPass, ServiceSummary } from '../shared/types.ts';

interface JoinQueueModalProps {
  service: ServiceSummary;
  lang: Language;
  citizenUid: string | null;
  defaultName?: string;
  defaultEmail?: string;
  onClose: () => void;
  onJoined: (pass: QueueTokenPass) => void;
}

export function JoinQueueModal({
  service,
  lang,
  citizenUid,
  defaultName = '',
  defaultEmail = '',
  onClose,
  onJoined,
}: JoinQueueModalProps) {
  const t = TRANSLATIONS[lang];
  const cfg = SERVICE_DOMAIN_CONFIG[service.code];

  const [fullName, setFullName] = useState(defaultName);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState(defaultEmail);
  const [priorityCategory, setPriorityCategory] = useState(cfg.priorities[0]);
  const [serviceDetail, setServiceDetail] = useState(cfg.detailOptions[0]);
  const [assistedMode, setAssistedMode] = useState(false);
  const [assistedByName, setAssistedByName] = useState('');
  const [isWalkIn, setIsWalkIn] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (fullName.trim().length < 2) {
      setError('Please enter a valid full name or student ID.');
      return;
    }

    const phoneRequiredNow =
      cfg.phoneRequired && !(service.code === 'BANK' && isWalkIn);
    if (phoneRequiredNow && phone.replace(/\D/g, '').length < 7) {
      setError('Please enter a valid phone number for call/SMS verification.');
      return;
    }

    if (assistedMode && assistedByName.trim().length < 2) {
      setError('Please enter the attendant or family member name for Assisted Mode.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceCode: service.code,
          fullName: fullName.trim(),
          phone: phone.trim() || null,
          email: cfg.showEmail && email.trim() ? email.trim() : null,
          priorityCategory,
          serviceDetail,
          assistedByName: assistedMode ? assistedByName.trim() : null,
          isWalkIn: service.code === 'BANK' ? isWalkIn : false,
          citizenUid,
        }),
      });
      const data = (await res.json()) as { pass?: QueueTokenPass; error?: string };
      if (!res.ok || !data.pass) {
        setError(data.error || 'Could not issue token. Please try again.');
        return;
      }
      onJoined(data.pass);
    } catch {
      setError('Network error while contacting the queue server.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="join-modal-title"
    >
      <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full max-h-[92vh] overflow-y-auto p-6 space-y-5 ql-surface">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-mono-tabular font-semibold text-slate-500">
              {service.code} · {service.counterRangeLabel}
            </div>
            <h2 id="join-modal-title" className="text-xl font-bold text-slate-900 mt-0.5">
              {service.name}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Single Source of Truth Live Estimate Strip (matches Service Card exactly) */}
        <div className="grid grid-cols-3 gap-3 p-3.5 bg-slate-50 border border-slate-200 rounded-lg">
          <div>
            <div className="text-xs text-slate-500 flex items-center gap-1">
              <Users className="w-3.5 h-3.5" />
              <span>{t.peopleAhead}</span>
            </div>
            <div className="text-base font-bold font-mono-tabular text-slate-900 mt-0.5">
              {service.peopleAhead}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500 flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              <span>{t.estWait}</span>
            </div>
            <div className="text-sm font-bold font-mono-tabular text-blue-700 mt-0.5">
              {service.estimatedWaitRange}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">{t.activeCounters}</div>
            <div className="text-sm font-bold font-mono-tabular text-slate-900 mt-0.5">
              {service.activeCountersCount}/{service.totalCountersCount}
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Assisted Mode Toggle */}
          <label className="flex items-center justify-between gap-3 p-3 rounded-lg border border-slate-200 cursor-pointer hover:bg-slate-50">
            <span className="text-sm font-medium text-slate-800">{t.assistedModeLabel}</span>
            <input
              type="checkbox"
              checked={assistedMode}
              onChange={(e) => setAssistedMode(e.target.checked)}
              className="w-4 h-4 accent-blue-700"
            />
          </label>

          {assistedMode && (
            <div>
              <label className="block text-sm font-semibold text-slate-800 mb-1">
                {t.assistedByPlaceholder} *
              </label>
              <input
                type="text"
                value={assistedByName}
                onChange={(e) => setAssistedByName(e.target.value)}
                placeholder="e.g., Suresh (Son / Attendant)"
                className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-2 focus:outline-blue-700"
                required
              />
            </div>
          )}

          {/* Primary Name / Identifier */}
          <div>
            <label className="block text-sm font-semibold text-slate-800 mb-1">
              {t[cfg.nameLabelKey]} *
            </label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder={
                service.code === 'LIB' ? 'e.g., Riya Sen or STU-2026-412' : 'e.g., Aarav Tiwari'
              }
              className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-2 focus:outline-blue-700"
              required
            />
          </div>

          {/* Bank On-Site Walk-in Option */}
          {service.code === 'BANK' && (
            <label className="flex items-center gap-2.5 text-sm text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={isWalkIn}
                onChange={(e) => setIsWalkIn(e.target.checked)}
                className="w-4 h-4 accent-blue-700"
              />
              <span>On-site walk-in (phone number optional)</span>
            </label>
          )}

          {/* Phone Number */}
          <div>
            <label className="block text-sm font-semibold text-slate-800 mb-1">
              {t.phoneLabel}{' '}
              {cfg.phoneRequired && !(service.code === 'BANK' && isWalkIn) ? '*' : '(Optional)'}
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91 98201 44102"
              className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-2 focus:outline-blue-700"
              required={cfg.phoneRequired && !(service.code === 'BANK' && isWalkIn)}
            />
            <p className="text-xs text-slate-500 mt-1">
              {cfg.phoneRequired ? t.phoneHelpCall : t.phoneHelpOptional}
            </p>
          </div>

          {/* Optional Email for HOPD & PASS */}
          {cfg.showEmail && (
            <div>
              <label className="block text-sm font-semibold text-slate-800 mb-1">
                {t.emailLabel}
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="visitor@example.com"
                className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-2 focus:outline-blue-700"
              />
            </div>
          )}

          {/* Priority Category (hidden in zero-friction LIB if only Standard) */}
          {cfg.priorities.length > 1 && (
            <div>
              <label className="block text-sm font-semibold text-slate-800 mb-1">
                {t.priorityLabel}
              </label>
              <select
                value={priorityCategory}
                onChange={(e) => setPriorityCategory(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg bg-white focus:outline-2 focus:outline-blue-700"
              >
                {cfg.priorities.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Domain-specific Reason / Task */}
          <div>
            <label className="block text-sm font-semibold text-slate-800 mb-1">
              {t[cfg.detailLabelKey]} *
            </label>
            <select
              value={serviceDetail}
              onChange={(e) => setServiceDetail(e.target.value)}
              className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg bg-white focus:outline-2 focus:outline-blue-700"
            >
              {cfg.detailOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
            >
              {t.cancelBtn}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2.5 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg transition-colors"
            >
              {submitting ? 'Issuing Token...' : t.confirmJoinBtn}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
