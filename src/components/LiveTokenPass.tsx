import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Bell,
  Clock,
  RefreshCw,
  Volume2,
  VolumeX,
  WifiOff,
  X,
} from 'lucide-react';
import type { Language } from '../i18n/translations.ts';
import { TRANSLATIONS } from '../i18n/translations.ts';
import { formatCountdown, playTurnAlertChime } from '../lib/alerts.ts';
import type { QueueTokenPass } from '../shared/types.ts';

interface LiveTokenPassProps {
  pass: QueueTokenPass;
  lang: Language;
  lastSyncedAt: number;
  isOffline: boolean;
  onClose?: () => void;
  onPassUpdated: (nextPass: QueueTokenPass) => void;
}

const STATUS_DISPLAY: Record<string, { label: string; colorClass: string }> = {
  WAITING: { label: 'Waiting in Queue', colorClass: 'text-blue-800 bg-blue-50 border-blue-200' },
  CALLED: { label: 'Called · Arrive Within 5 Mins', colorClass: 'text-amber-900 bg-amber-50 border-amber-300' },
  IN_SERVICE: { label: 'In Service at Counter', colorClass: 'text-emerald-900 bg-emerald-50 border-emerald-300' },
  DEFERRED_30M: { label: 'Deferred (+30 Mins)', colorClass: 'text-slate-800 bg-slate-100 border-slate-300' },
  COMPLETED: { label: 'Service Completed', colorClass: 'text-emerald-900 bg-emerald-50 border-emerald-200' },
  GRACE_EXPIRED: { label: '5-Min Grace Expired', colorClass: 'text-red-900 bg-red-50 border-red-200' },
  SKIPPED_TIMEOUT: { label: 'Skipped (Timeout)', colorClass: 'text-red-900 bg-red-50 border-red-200' },
  CANCELLED_NO_ANSWER: { label: 'Cancelled (No Answer)', colorClass: 'text-red-900 bg-red-50 border-red-200' },
  CANCELLED_BY_USER: { label: 'Cancelled by Visitor', colorClass: 'text-slate-700 bg-slate-100 border-slate-200' },
};

export function LiveTokenPass({
  pass,
  lang,
  lastSyncedAt,
  isOffline,
  onClose,
  onPassUpdated,
}: LiveTokenPassProps) {
  const t = TRANSLATIONS[lang];
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [actionBusy, setActionBusy] = useState<'defer' | 'cancel' | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prevAlertKeyRef = useRef<string>('');

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const alertKey = `${pass.id}:${pass.status}:${pass.twoTokensAway}`;
    if (prevAlertKeyRef.current && prevAlertKeyRef.current !== alertKey) {
      if (soundEnabled && (pass.status === 'CALLED' || (pass.status === 'WAITING' && pass.twoTokensAway))) {
        playTurnAlertChime(pass.status === 'CALLED');
      }
    }
    prevAlertKeyRef.current = alertKey;
  }, [pass.id, pass.status, pass.twoTokensAway, soundEnabled]);

  const grace = formatCountdown(pass.graceExpiresAt, nowMs);
  const deferTimer = formatCountdown(pass.requeueAfter, nowMs);
  const secondsAgo = Math.max(0, Math.floor((nowMs - lastSyncedAt) / 1000));
  const statusInfo = STATUS_DISPLAY[pass.status] ?? {
    label: pass.status,
    colorClass: 'text-slate-800 bg-slate-100 border-slate-200',
  };

  const canDefer =
    pass.deferralCount < 1 &&
    ['WAITING', 'CALLED', 'GRACE_EXPIRED'].includes(pass.status);
  const canCancel = !['COMPLETED', 'CANCELLED_BY_USER', 'CANCELLED_NO_ANSWER'].includes(
    pass.status
  );

  const handleDefer = async () => {
    setError(null);
    setActionBusy('defer');
    try {
      const res = await fetch(`/api/tokens/${pass.id}/defer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pass.pin }),
      });
      const data = (await res.json()) as { pass?: QueueTokenPass; error?: string };
      if (!res.ok || !data.pass) {
        setError(data.error || 'Unable to defer token.');
        return;
      }
      onPassUpdated(data.pass);
    } catch {
      setError('Network error while deferring token.');
    } finally {
      setActionBusy(null);
    }
  };

  const handleCancel = async () => {
    setError(null);
    setActionBusy('cancel');
    try {
      const res = await fetch(`/api/tokens/${pass.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pass.pin }),
      });
      const data = (await res.json()) as { pass?: QueueTokenPass; error?: string };
      if (!res.ok || !data.pass) {
        setError(data.error || 'Unable to cancel token.');
        return;
      }
      setConfirmCancel(false);
      onPassUpdated(data.pass);
    } catch {
      setError('Network error while cancelling token.');
    } finally {
      setActionBusy(null);
    }
  };

  return (
    <section
      aria-label={t.tokenPassTitle}
      className="bg-white border border-slate-200 rounded-xl p-6 space-y-5 ql-surface"
    >
      {/* Offline Resilience Banner */}
      {isOffline && (
        <div className="p-3 bg-amber-50 border border-amber-300 rounded-lg flex items-center gap-2.5 text-sm font-medium text-amber-950">
          <WifiOff className="w-4 h-4 shrink-0" />
          <span>{t.offlineBanner}</span>
        </div>
      )}

      {/* Header Row */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs font-medium text-slate-500 ql-muted">
            {t.tokenPassTitle} · {pass.serviceName}
          </div>
          <div className="flex flex-wrap items-baseline gap-4 mt-1">
            <span className="text-3xl sm:text-4xl font-bold font-mono-tabular tracking-tight text-slate-900">
              {pass.tokenCode}
            </span>
            <span className="text-sm font-medium text-slate-600 ql-muted">
              {t.verificationPin}:{' '}
              <strong className="font-mono-tabular text-lg text-slate-900 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                {pass.pin}
              </strong>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setSoundEnabled((v) => !v)}
            aria-label={soundEnabled ? 'Mute turn alert sound' : 'Enable turn alert sound'}
            className="p-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
            title={soundEnabled ? 'Sound Alerts On' : 'Sound Alerts Muted'}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Minimize token pass"
              className="p-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Explicit Status Banner */}
      <div className={`px-3.5 py-2.5 rounded-lg border text-sm font-semibold flex flex-wrap items-center justify-between gap-2 ${statusInfo.colorClass}`}>
        <span>{statusInfo.label}</span>
        {pass.status === 'CALLED' && (
          <span className="font-mono-tabular text-base">
            {pass.assignedCounterNumber ? `Counter ${pass.assignedCounterNumber} · ` : ''}
            Grace Timer: {grace.formatted}
          </span>
        )}
        {pass.status === 'DEFERRED_30M' && (
          <span className="font-mono-tabular">Re-entering in {deferTimer.formatted}</span>
        )}
        {pass.status === 'IN_SERVICE' && pass.assignedCounterNumber && (
          <span className="font-mono-tabular">Counter {pass.assignedCounterNumber}</span>
        )}
      </div>

      {/* "2 Tokens Away" Smart Nudge Banner */}
      {pass.status === 'WAITING' && pass.twoTokensAway && (
        <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-lg flex items-center gap-3 text-amber-950">
          <Bell className="w-5 h-5 shrink-0 text-amber-700" />
          <div className="text-sm font-semibold">{t.almostTurnBanner}</div>
        </div>
      )}

      {pass.status === 'CALLED' && (
        <div className="p-3.5 bg-red-50 border border-red-300 rounded-lg flex items-center gap-3 text-red-950">
          <AlertCircle className="w-5 h-5 shrink-0 text-red-700" />
          <div className="text-sm font-semibold">
            {t.calledBanner}{' '}
            <span className="font-mono-tabular">
              (Counter {pass.assignedCounterNumber ?? '-'} · PIN {pass.pin})
            </span>
          </div>
        </div>
      )}

      {/* Real-Time Metrics Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
          <div className="text-xs text-slate-500 ql-muted">{t.peopleAhead}</div>
          <div className="text-xl font-bold font-mono-tabular text-slate-900 mt-0.5">
            {pass.peopleAhead}
          </div>
        </div>
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
          <div className="text-xs text-slate-500 ql-muted">{t.nowServing}</div>
          <div className="text-base font-bold font-mono-tabular text-slate-900 mt-1">
            {pass.currentServingToken ?? 'Ready'}
          </div>
        </div>
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
          <div className="text-xs text-slate-500 ql-muted">{t.activeCounters}</div>
          <div className="text-base font-bold font-mono-tabular text-slate-900 mt-1">
            {pass.activeCountersCount} Open
          </div>
        </div>
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
          <div className="text-xs text-slate-500 ql-muted">{t.estWait}</div>
          <div className="text-sm font-bold font-mono-tabular text-blue-700 mt-1">
            {pass.estimatedWaitRange}
          </div>
        </div>
      </div>

      {/* Visitor Details */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 pt-2 border-t border-slate-100 ql-muted">
        <div>
          Visitor: <strong className="text-slate-900">{pass.fullName}</strong>
          {pass.assistedByName ? ` (Assisted by ${pass.assistedByName})` : ''}
          {' · '}
          {pass.priorityCategory} · {pass.serviceDetail}
        </div>
        <div className="flex items-center gap-2 font-mono-tabular">
          <span>~{pass.effectiveAvgServiceMinutes}m/visit</span>
          <span aria-hidden="true">·</span>
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Last synced: {secondsAgo}s ago</span>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg">
          {error}
        </div>
      )}

      {/* Self-Service Actions */}
      {(canDefer || canCancel) && (
        <div className="flex flex-wrap items-center gap-3 pt-2">
          {canDefer ? (
            <button
              type="button"
              disabled={actionBusy !== null}
              onClick={handleDefer}
              className="px-4 py-2.5 text-sm font-semibold text-slate-900 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg transition-colors flex items-center gap-2 disabled:opacity-60"
            >
              <Clock className="w-4 h-4" />
              <span>{actionBusy === 'defer' ? 'Deferring...' : t.deferBtn}</span>
            </button>
          ) : (
            pass.deferralCount >= 1 && (
              <span className="text-xs font-medium text-slate-500">{t.deferUsedLabel}</span>
            )
          )}

          {canCancel && !confirmCancel && (
            <button
              type="button"
              disabled={actionBusy !== null}
              onClick={() => setConfirmCancel(true)}
              className="px-4 py-2.5 text-sm font-semibold text-red-700 bg-white hover:bg-red-50 border border-red-300 rounded-lg transition-colors"
            >
              {t.cancelTokenBtn}
            </button>
          )}

          {canCancel && confirmCancel && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-red-800">Confirm cancellation?</span>
              <button
                type="button"
                disabled={actionBusy !== null}
                onClick={handleCancel}
                className="px-3 py-2 text-xs font-semibold text-white bg-red-700 hover:bg-red-800 rounded-lg"
              >
                {actionBusy === 'cancel' ? 'Cancelling...' : 'Yes, Cancel Token'}
              </button>
              <button
                type="button"
                onClick={() => setConfirmCancel(false)}
                className="px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-lg"
              >
                Keep
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
