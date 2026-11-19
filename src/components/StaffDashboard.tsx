import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  LogOut,
  Phone,
  PhoneCall,
  PhoneOff,
  Plus,
  RefreshCw,
  UserCheck,
  X,
} from 'lucide-react';
import { formatCountdown } from '../lib/alerts.ts';
import { SERVICE_DOMAIN_CONFIG } from '../lib/servicesConfig.ts';
import type {
  CallOutcome,
  CounterStatus,
  QueueTokenStaff,
  ServiceCode,
  StaffDashboardPayload,
} from '../shared/types.ts';

interface StaffDashboardProps {
  staffToken: string;
  onLogout: () => void;
  refreshSignal: number;
}

export function StaffDashboard({ staffToken, onLogout, refreshSignal }: StaffDashboardProps) {
  const [data, setData] = useState<StaffDashboardPayload | null>(null);
  const [selectedService, setSelectedService] = useState<ServiceCode>('HOPD');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [pinInputs, setPinInputs] = useState<Record<string, string>>({});
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [walkInName, setWalkInName] = useState('');
  const [walkInPhone, setWalkInPhone] = useState('');
  const [walkInPriority, setWalkInPriority] = useState('Standard');
  const [walkInDetail, setWalkInDetail] = useState('');
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const fetchDashboard = useCallback(async () => {
    try {
      const res = await fetch('/api/staff/dashboard', {
        headers: { Authorization: `Bearer ${staffToken}` },
      });
      if (res.status === 401) {
        onLogout();
        return;
      }
      const payload = (await res.json()) as StaffDashboardPayload & { error?: string };
      if (!res.ok) {
        setError(payload.error || 'Failed to load staff dashboard.');
        return;
      }
      setData(payload);
      if (payload.services.length > 0 && !payload.services.some((s) => s.code === selectedService)) {
        setSelectedService(payload.services[0].code);
      }
      setError(null);
    } catch {
      setError('Connection error while refreshing staff dashboard.');
    } finally {
      setLoading(false);
    }
  }, [staffToken, onLogout, selectedService]);

  useEffect(() => {
    void fetchDashboard();
  }, [fetchDashboard, refreshSignal]);

  useEffect(() => {
    const t1 = setInterval(() => setNowMs(Date.now()), 1000);
    const t2 = setInterval(() => void fetchDashboard(), 5000);
    return () => {
      clearInterval(t1);
      clearInterval(t2);
    };
  }, [fetchDashboard]);

  const mutate = async (key: string, url: string, body?: Record<string, unknown>, successMsg?: string) => {
    setBusyAction(key);
    setError(null);
    setFeedback(null);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${staffToken}`,
        },
        body: JSON.stringify(body ?? {}),
      });
      if (res.status === 401) {
        onLogout();
        return;
      }
      const json = (await res.json()) as { error?: string; autoAdvancedToken?: { tokenCode: string } | null };
      if (!res.ok) {
        setError(json.error || 'Operation failed.');
        return;
      }
      if (json.autoAdvancedToken) {
        setFeedback(`${successMsg ?? 'Updated'} — Auto-advanced to ${json.autoAdvancedToken.tokenCode}.`);
      } else if (successMsg) {
        setFeedback(successMsg);
      }
      await fetchDashboard();
    } catch {
      setError('Network error executing counter command.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleOpenWalkIn = () => {
    const cfg = SERVICE_DOMAIN_CONFIG[selectedService];
    setWalkInName('');
    setWalkInPhone('');
    setWalkInPriority(cfg.priorities[0]);
    setWalkInDetail(cfg.detailOptions[0]);
    setWalkInOpen(true);
  };

  const submitWalkIn = async (e: React.FormEvent) => {
    e.preventDefault();
    await mutate(
      'walk-in',
      '/api/staff/walk-in',
      {
        serviceCode: selectedService,
        fullName: walkInName.trim() || 'Walk-In Visitor',
        phone: walkInPhone.trim() || null,
        priorityCategory: walkInPriority,
        serviceDetail: walkInDetail,
      },
      'Walk-in token added to queue'
    );
    setWalkInOpen(false);
  };

  if (loading && !data) {
    return (
      <div className="max-w-[1280px] mx-auto px-4 sm:px-6 py-10">
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-sm text-slate-600">
          Loading counter operations console...
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="max-w-[960px] mx-auto px-4 sm:px-6 py-10">
        <div className="p-6 bg-red-50 border border-red-200 rounded-xl text-red-900">
          {error || 'Unable to initialize staff session.'}
        </div>
      </div>
    );
  }

  const activeService = data.services.find((s) => s.code === selectedService) ?? data.services[0];
  const serviceTokens: QueueTokenStaff[] = activeService
    ? data.tokensByService[activeService.code] ?? []
    : [];
  const activeAlerts = data.emergencies.filter((a) => a.status !== 'RESOLVED');

  return (
    <div className="max-w-[1280px] mx-auto px-4 sm:px-6 py-8 space-y-6">
      {/* Staff Top Context Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4 ql-surface">
        <div>
          <div className="text-xs font-mono-tabular text-slate-500">
            {data.staff.staffCode} · {data.staff.role === 'SUPERVISOR' ? 'Facility Supervisor' : `Assigned Desk: ${data.staff.assignedServiceCode}`}
          </div>
          <h1 className="text-xl font-bold text-slate-900 mt-0.5">
            Counter Operations — {data.staff.fullName}
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleOpenWalkIn}
            className="px-3.5 py-2 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg flex items-center gap-1.5 whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>1-Click Walk-In</span>
          </button>
          <button
            type="button"
            onClick={() => void fetchDashboard()}
            className="px-3 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg flex items-center gap-1.5"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Sync</span>
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="px-3 py-2 text-sm font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg flex items-center gap-1.5"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>

      {/* Emergency SOS Active Alerts (HOPD & Supervisor Only) */}
      {activeAlerts.length > 0 && (
        <div className="space-y-3">
          {activeAlerts.map((alert) => (
            <div
              key={alert.id}
              className="p-4 bg-red-50 border-2 border-red-700 rounded-xl flex flex-wrap items-center justify-between gap-4"
            >
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-red-700 shrink-0 mt-0.5" />
                <div>
                  <div className="text-sm font-bold text-red-950">
                    EMERGENCY SOS · {alert.location} ({alert.status})
                  </div>
                  <div className="text-sm text-red-900 mt-0.5">{alert.description}</div>
                  <div className="text-xs text-red-800 mt-1 font-mono-tabular">
                    {alert.reporterName ? `Reporter: ${alert.reporterName} · ` : ''}
                    {alert.contactPhone ? `Phone: ${alert.contactPhone} · ` : ''}
                    Received: {new Date(alert.createdAt).toLocaleTimeString()}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {alert.status === 'ACTIVE' && (
                  <button
                    type="button"
                    onClick={() =>
                      void mutate(
                        `sos-ack-${alert.id}`,
                        `/api/staff/emergencies/${alert.id}/resolve`,
                        { status: 'ACKNOWLEDGED' },
                        'Emergency alert acknowledged'
                      )
                    }
                    className="px-3 py-2 text-xs font-semibold text-red-900 bg-white border border-red-300 hover:bg-red-100 rounded-lg"
                  >
                    Acknowledge
                  </button>
                )}
                <button
                  type="button"
                  onClick={() =>
                    void mutate(
                      `sos-res-${alert.id}`,
                      `/api/staff/emergencies/${alert.id}/resolve`,
                      { status: 'RESOLVED' },
                      'Emergency alert resolved'
                    )
                  }
                  className="px-3 py-2 text-xs font-semibold text-white bg-red-700 hover:bg-red-800 rounded-lg"
                >
                  Mark Resolved
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Service Desk Segmented Switcher (Supervisor sees all 4; Counter Staff sees assigned desk) */}
      {data.services.length > 1 && (
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 border border-slate-200 rounded-lg w-fit">
          {data.services.map((svc) => (
            <button
              key={svc.code}
              type="button"
              onClick={() => setSelectedService(svc.code)}
              className={`px-3.5 py-2 text-sm font-semibold rounded-md transition-colors whitespace-nowrap ${
                selectedService === svc.code
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {svc.code} · {svc.name} ({svc.peopleAhead} waiting)
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="p-3.5 bg-red-50 border border-red-200 text-red-900 text-sm rounded-lg">
          {error}
        </div>
      )}

      {feedback && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-900 text-sm rounded-lg flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
          <span>{feedback}</span>
        </div>
      )}

      {/* Counters Grid */}
      {activeService && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {activeService.counters.map((ctr) => {
            const activeTok = ctr.currentTokenId
              ? serviceTokens.find((t) => t.id === ctr.currentTokenId) ?? null
              : null;
            const grace = activeTok?.status === 'CALLED' ? formatCountdown(activeTok.graceExpiresAt, nowMs) : null;
            const pinVal = activeTok ? pinInputs[activeTok.id] ?? '' : '';

            return (
              <div
                key={ctr.id}
                className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 ql-surface"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-mono-tabular text-slate-500">
                      COUNTER {ctr.counterNumber} · {ctr.serviceCode}
                    </div>
                    <h2 className="text-base font-bold text-slate-900 mt-0.5">{ctr.label}</h2>
                  </div>
                  <select
                    aria-label={`Status for ${ctr.label}`}
                    value={ctr.status}
                    onChange={(e) =>
                      void mutate(
                        `ctr-status-${ctr.id}`,
                        `/api/staff/counters/${ctr.id}/status`,
                        { status: e.target.value as CounterStatus },
                        `Counter ${ctr.counterNumber} set to ${e.target.value}`
                      )
                    }
                    className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg border ${
                      ctr.status === 'OPEN'
                        ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                        : ctr.status === 'BUSY_COMPLEX'
                        ? 'bg-amber-50 border-amber-300 text-amber-900'
                        : 'bg-slate-100 border-slate-300 text-slate-700'
                    }`}
                  >
                    <option value="OPEN">Open</option>
                    <option value="BUSY_COMPLEX">Busy / Complex Case</option>
                    <option value="PAUSED">Paused</option>
                  </select>
                </div>

                {activeTok ? (
                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xl font-bold font-mono-tabular text-slate-900">
                        {activeTok.tokenCode}
                      </span>
                      <span
                        className={`text-xs font-bold px-2 py-0.5 rounded border ${
                          activeTok.status === 'CALLED'
                            ? 'bg-amber-100 border-amber-300 text-amber-950'
                            : 'bg-emerald-100 border-emerald-300 text-emerald-950'
                        }`}
                      >
                        {activeTok.status}
                      </span>
                    </div>

                    <div className="text-sm text-slate-800 space-y-1">
                      <div className="font-semibold">
                        {activeTok.fullName}
                        {activeTok.isWalkIn ? ' (Walk-In)' : ''}
                      </div>
                      <div className="text-xs text-slate-600">
                        {activeTok.priorityCategory} · {activeTok.serviceDetail}
                      </div>
                      {activeTok.phone && (
                        <div className="text-xs font-mono-tabular text-blue-800 flex items-center gap-1.5 pt-0.5">
                          <Phone className="w-3.5 h-3.5" />
                          <span>{activeTok.phone}</span>
                        </div>
                      )}
                    </div>

                    {/* Live 5-Minute Grace Countdown & Check-In */}
                    {activeTok.status === 'CALLED' && grace && (
                      <div className="space-y-3 pt-2 border-t border-slate-200">
                        <div className="flex items-center justify-between text-xs font-semibold">
                          <span className="text-slate-700 flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5 text-amber-700" />
                            5-Min Grace Window
                          </span>
                          <span className="font-mono-tabular text-base text-red-700">
                            {grace.formatted}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            maxLength={4}
                            value={pinVal}
                            onChange={(e) =>
                              setPinInputs((prev) => ({ ...prev, [activeTok.id]: e.target.value }))
                            }
                            placeholder={`PIN (${activeTok.pin})`}
                            className="w-28 px-2.5 py-2 text-xs font-mono-tabular border border-slate-300 rounded-lg bg-white"
                          />
                          <button
                            type="button"
                            disabled={busyAction !== null}
                            onClick={() =>
                              void mutate(
                                `checkin-${activeTok.id}`,
                                `/api/staff/tokens/${activeTok.id}/check-in`,
                                {
                                  pin: pinVal,
                                  skipPinForWalkIn: activeTok.isWalkIn && !pinVal,
                                },
                                `${activeTok.tokenCode} checked in`
                              )
                            }
                            className="flex-1 px-3 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg flex items-center justify-center gap-1"
                          >
                            <UserCheck className="w-3.5 h-3.5" />
                            <span>Check In & Start</span>
                          </button>
                        </div>

                        {/* Explicit Call Verification & Outcome Buttons */}
                        <div className="pt-2 border-t border-slate-200 space-y-1.5">
                          <div className="text-[11px] font-semibold text-slate-500">
                            Call Verification Outcome
                          </div>
                          <div className="grid grid-cols-1 gap-1.5">
                            <button
                              type="button"
                              disabled={busyAction !== null}
                              onClick={() =>
                                void mutate(
                                  `call-coming-${activeTok.id}`,
                                  `/api/staff/tokens/${activeTok.id}/call-outcome`,
                                  { outcome: 'ANSWERED_COMING' satisfies CallOutcome },
                                  `${activeTok.tokenCode}: Coming Now logged`
                                )
                              }
                              className="w-full px-2.5 py-1.5 text-xs font-medium text-slate-800 bg-white hover:bg-slate-100 border border-slate-300 rounded-md flex items-center gap-1.5"
                            >
                              <PhoneCall className="w-3.5 h-3.5 text-emerald-700" />
                              <span>Answered — Coming Now</span>
                            </button>
                            <button
                              type="button"
                              disabled={busyAction !== null || activeTok.deferralCount >= 1}
                              onClick={() =>
                                void mutate(
                                  `call-defer-${activeTok.id}`,
                                  `/api/staff/tokens/${activeTok.id}/call-outcome`,
                                  { outcome: 'ANSWERED_DEFER_30M' satisfies CallOutcome },
                                  `${activeTok.tokenCode} deferred +30 mins`
                                )
                              }
                              className="w-full px-2.5 py-1.5 text-xs font-medium text-slate-800 bg-white hover:bg-slate-100 border border-slate-300 rounded-md flex items-center gap-1.5 disabled:opacity-50"
                            >
                              <Clock className="w-3.5 h-3.5 text-amber-700" />
                              <span>
                                {activeTok.deferralCount >= 1
                                  ? 'Deferral Used (Max 1)'
                                  : 'Answered — Needs 30 Mins'}
                              </span>
                            </button>
                            <button
                              type="button"
                              disabled={busyAction !== null}
                              onClick={() =>
                                void mutate(
                                  `call-cancel-${activeTok.id}`,
                                  `/api/staff/tokens/${activeTok.id}/call-outcome`,
                                  { outcome: 'NO_ANSWER_CANCEL' satisfies CallOutcome },
                                  `${activeTok.tokenCode} cancelled (no answer)`
                                )
                              }
                              className="w-full px-2.5 py-1.5 text-xs font-semibold text-red-800 bg-red-50 hover:bg-red-100 border border-red-200 rounded-md flex items-center gap-1.5"
                            >
                              <PhoneOff className="w-3.5 h-3.5 text-red-700" />
                              <span>Did Not Lift → Cancel & Next</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Complete Service Button */}
                    {activeTok.status === 'IN_SERVICE' && (
                      <button
                        type="button"
                        disabled={busyAction !== null}
                        onClick={() =>
                          void mutate(
                            `complete-${activeTok.id}`,
                            `/api/staff/tokens/${activeTok.id}/complete`,
                            {},
                            `${activeTok.tokenCode} marked completed`
                          )
                        }
                        className="w-full py-2 px-3 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg"
                      >
                        Complete Service & Free Counter
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="p-4 bg-slate-50 border border-dashed border-slate-300 rounded-lg space-y-3 text-center">
                    <div className="text-xs text-slate-600">
                      Counter idle · {activeService.peopleAhead} waiting in queue
                    </div>
                    <button
                      type="button"
                      disabled={busyAction !== null || ctr.status === 'PAUSED' || activeService.peopleAhead === 0}
                      onClick={() =>
                        void mutate(
                          `call-next-${ctr.id}`,
                          `/api/staff/counters/${ctr.id}/call-next`,
                          {},
                          `Called next token to Counter ${ctr.counterNumber}`
                        )
                      }
                      className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg transition-colors"
                    >
                      Call Next Token
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Ordered Queue, Grace-Expired & Deferred Tokens Table */}
      {activeService && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden ql-surface">
          <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                {activeService.name} — Live Queue & Call Verification Log
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Full phone numbers shown strictly to authenticated staff · Estimated wait:{' '}
                <strong className="font-mono-tabular text-slate-800">
                  {activeService.estimatedWaitRange}
                </strong>
              </p>
            </div>
            <div className="text-xs font-mono-tabular text-slate-600">
              Deferred (+30m): {activeService.deferredCount}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4">Token / PIN</th>
                  <th className="py-3 px-4">Visitor & Contact</th>
                  <th className="py-3 px-4">Priority & Service Detail</th>
                  <th className="py-3 px-4">Status / Timer</th>
                  <th className="py-3 px-4 text-right">Call & Counter Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {serviceTokens.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-500 text-sm">
                      No tokens recorded for {activeService.name} yet.
                    </td>
                  </tr>
                ) : (
                  serviceTokens.map((tok) => {
                    const grace =
                      tok.status === 'CALLED' ? formatCountdown(tok.graceExpiresAt, nowMs) : null;
                    const defer =
                      tok.status === 'DEFERRED_30M' ? formatCountdown(tok.requeueAfter, nowMs) : null;
                    const isCallable = tok.status === 'WAITING' || tok.status === 'GRACE_EXPIRED';
                    const canLogCall = ['WAITING', 'CALLED', 'GRACE_EXPIRED'].includes(tok.status);

                    return (
                      <tr key={tok.id} className="hover:bg-slate-50/70 align-top">
                        <td className="py-3 px-4 whitespace-nowrap">
                          <div className="font-mono-tabular font-bold text-slate-900">
                            {tok.tokenCode}
                          </div>
                          <div className="text-xs font-mono-tabular text-slate-500">
                            PIN {tok.pin}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-900">
                            {tok.fullName}
                            {tok.isWalkIn ? ' · Walk-In' : ''}
                          </div>
                          <div className="text-xs font-mono-tabular text-slate-600 mt-0.5">
                            {tok.phone ?? 'No phone (walk-in/optional)'}
                          </div>
                          {tok.assistedByName && (
                            <div className="text-xs text-slate-500">
                              Assisted by {tok.assistedByName}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <div className="text-xs font-semibold text-slate-800">
                            {tok.priorityCategory}
                          </div>
                          <div className="text-xs text-slate-600 mt-0.5">{tok.serviceDetail}</div>
                          {tok.callLogs.length > 0 && (
                            <div className="text-[11px] text-blue-800 mt-1 font-mono-tabular">
                              Last call: {tok.callLogs[0].outcome} ({new Date(tok.callLogs[0].createdAt).toLocaleTimeString()})
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span className="text-xs font-bold font-mono-tabular text-slate-900">
                            {tok.status}
                          </span>
                          {tok.assignedCounterNumber && (
                            <div className="text-xs text-slate-600">
                              Counter {tok.assignedCounterNumber}
                            </div>
                          )}
                          {grace && (
                            <div className="text-xs font-mono-tabular text-red-700 font-semibold">
                              Grace: {grace.formatted}
                            </div>
                          )}
                          {defer && (
                            <div className="text-xs font-mono-tabular text-amber-800 font-semibold">
                              Returns: {defer.formatted}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex flex-wrap items-center justify-end gap-1.5">
                            {isCallable && (
                              <button
                                type="button"
                                disabled={busyAction !== null}
                                onClick={() =>
                                  void mutate(
                                    `call-tok-${tok.id}`,
                                    `/api/staff/tokens/${tok.id}/call`,
                                    {},
                                    `Called ${tok.tokenCode}`
                                  )
                                }
                                className="px-2.5 py-1.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md"
                              >
                                Call Token
                              </button>
                            )}
                            {canLogCall && (
                              <>
                                <button
                                  type="button"
                                  disabled={busyAction !== null}
                                  onClick={() =>
                                    void mutate(
                                      `row-coming-${tok.id}`,
                                      `/api/staff/tokens/${tok.id}/call-outcome`,
                                      { outcome: 'ANSWERED_COMING' satisfies CallOutcome },
                                      `${tok.tokenCode}: Coming Now`
                                    )
                                  }
                                  className="px-2 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-md"
                                >
                                  Coming
                                </button>
                                <button
                                  type="button"
                                  disabled={busyAction !== null || tok.deferralCount >= 1}
                                  onClick={() =>
                                    void mutate(
                                      `row-defer-${tok.id}`,
                                      `/api/staff/tokens/${tok.id}/call-outcome`,
                                      { outcome: 'ANSWERED_DEFER_30M' satisfies CallOutcome },
                                      `${tok.tokenCode}: Deferred +30m`
                                    )
                                  }
                                  className="px-2 py-1.5 text-xs font-medium text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-300 rounded-md disabled:opacity-40"
                                >
                                  +30m
                                </button>
                                <button
                                  type="button"
                                  disabled={busyAction !== null}
                                  onClick={() =>
                                    void mutate(
                                      `row-cancel-${tok.id}`,
                                      `/api/staff/tokens/${tok.id}/call-outcome`,
                                      { outcome: 'NO_ANSWER_CANCEL' satisfies CallOutcome },
                                      `${tok.tokenCode}: Cancelled (No Answer)`
                                    )
                                  }
                                  className="px-2 py-1.5 text-xs font-semibold text-red-800 bg-red-50 hover:bg-red-100 border border-red-200 rounded-md"
                                >
                                  No Answer → Cancel
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 1-Click Walk-In Modal */}
      {walkInOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 space-y-4 ql-surface">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">
                1-Click Walk-In Sync ({selectedService})
              </h3>
              <button
                type="button"
                onClick={() => setWalkInOpen(false)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={submitWalkIn} className="space-y-3.5">
              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-1">
                  Visitor Name *
                </label>
                <input
                  type="text"
                  value={walkInName}
                  onChange={(e) => setWalkInName(e.target.value)}
                  placeholder="e.g., Ramesh Gupta"
                  required
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-1">
                  Phone (Optional for Walk-In)
                </label>
                <input
                  type="tel"
                  value={walkInPhone}
                  onChange={(e) => setWalkInPhone(e.target.value)}
                  placeholder="Optional"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-1">
                  Priority
                </label>
                <select
                  value={walkInPriority}
                  onChange={(e) => setWalkInPriority(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  {SERVICE_DOMAIN_CONFIG[selectedService].priorities.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-1">
                  Service Task
                </label>
                <select
                  value={walkInDetail}
                  onChange={(e) => setWalkInDetail(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  {SERVICE_DOMAIN_CONFIG[selectedService].detailOptions.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setWalkInOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busyAction === 'walk-in'}
                  className="px-4 py-2 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg"
                >
                  Issue Walk-In Token
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
