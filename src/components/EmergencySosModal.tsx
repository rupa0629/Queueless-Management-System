import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, PhoneCall, X } from 'lucide-react';
import type { Language } from '../i18n/translations.ts';
import { TRANSLATIONS } from '../i18n/translations.ts';
import type { EmergencyAlert } from '../shared/types.ts';

interface EmergencySosModalProps {
  lang: Language;
  onClose: () => void;
}

export function EmergencySosModal({ lang, onClose }: EmergencySosModalProps) {
  const t = TRANSLATIONS[lang];
  const [location, setLocation] = useState('Hospital OPD Waiting Hall · Ground Floor');
  const [description, setDescription] = useState('');
  const [reporterName, setReporterName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sentAlert, setSentAlert] = useState<EmergencyAlert | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (location.trim().length < 2 || description.trim().length < 3) {
      setError('Please enter your exact location and brief description.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/emergency', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          location: location.trim(),
          description: description.trim(),
          reporterName: reporterName.trim() || null,
          contactPhone: contactPhone.trim() || null,
        }),
      });
      const data = (await res.json()) as { alert?: EmergencyAlert; error?: string };
      if (!res.ok || !data.alert) {
        setError(data.error || 'Could not dispatch SOS alert.');
        return;
      }
      setSentAlert(data.alert);
    } catch {
      setError('Network error. Call 112 immediately or reach Ground Floor Triage Bay A.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sos-modal-title"
    >
      <div className="bg-white border-2 border-red-700 rounded-xl max-w-lg w-full p-6 space-y-5 ql-surface">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-red-100 text-red-700 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h2 id="sos-modal-title" className="text-xl font-bold text-slate-900">
                {t.sosTitle}
              </h2>
              <p className="text-sm text-slate-700 mt-1">{t.sosDesc}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close SOS modal"
            className="p-2 rounded-lg text-slate-500 hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-3.5 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3 text-sm font-bold text-red-900">
          <PhoneCall className="w-5 h-5 shrink-0 text-red-700" />
          <span>{t.sosHelpline}</span>
        </div>

        {sentAlert ? (
          <div className="p-5 bg-emerald-50 border border-emerald-300 rounded-lg space-y-3">
            <div className="flex items-center gap-2 text-emerald-900 font-bold text-base">
              <CheckCircle2 className="w-5 h-5 text-emerald-700" />
              <span>Priority SOS Alert Dispatched ({sentAlert.id.toUpperCase()})</span>
            </div>
            <p className="text-sm text-emerald-900">
              Hospital OPD staff and Facility Supervisors have received an immediate priority alert for{' '}
              <strong>{sentAlert.location}</strong>. No queue ticket is required—proceed directly to
              Triage Bay A or remain where responders can reach you.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg"
            >
              Close Window
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-slate-800 mb-1">
                {t.sosLocationLabel} *
              </label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                required
                className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-2 focus:outline-red-700"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-800 mb-1">
                {t.sosBriefLabel} *
              </label>
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g., Visitor experiencing severe dizziness / chest discomfort near Reception"
                required
                className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-2 focus:outline-red-700"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Your Name (Optional)
                </label>
                <input
                  type="text"
                  value={reporterName}
                  onChange={(e) => setReporterName(e.target.value)}
                  placeholder="Optional"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Callback Phone (Optional)
                </label>
                <input
                  type="tel"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  placeholder="Optional"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            {error && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg">
                {error}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg"
              >
                {t.cancelBtn}
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-5 py-2.5 text-sm font-semibold text-white bg-red-700 hover:bg-red-800 rounded-lg disabled:opacity-60"
              >
                {submitting ? 'Dispatching Alert...' : t.sosSendBtn}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
