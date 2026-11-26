import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Clock,
  Shield,
  Users,
  WifiOff,
} from 'lucide-react';
import { EmergencySosModal } from './components/EmergencySosModal.tsx';
import { Header, type AppRoute } from './components/Header.tsx';
import { JoinQueueModal } from './components/JoinQueueModal.tsx';
import { LiveTokenPass } from './components/LiveTokenPass.tsx';
import { ServiceCard } from './components/ServiceCard.tsx';
import { StaffDashboard } from './components/StaffDashboard.tsx';
import { StaffLoginPage } from './components/StaffLoginPage.tsx';
import { TrackTokenView } from './components/TrackTokenView.tsx';
import { useFirebase } from './contexts/FirebaseContext.tsx';
import { TRANSLATIONS, type Language } from './i18n/translations.ts';
import { formatCountdown } from './lib/alerts.ts';
import type {
  QueueTokenPass,
  ServiceSummary,
  StaffUserPublic,
} from './shared/types.ts';

const ACTIVE_PASS_KEY = 'queueless_active_pass_v1';
const STAFF_TOKEN_KEY = 'queueless_staff_jwt_v1';
const STAFF_USER_KEY = 'queueless_staff_user_v1';

function getInitialRoute(): AppRoute {
  if (typeof window === 'undefined') return 'portal';
  const p = window.location.pathname;
  if (p.startsWith('/staff/dashboard')) return 'staff-dashboard';
  if (p.startsWith('/staff/login')) return 'staff-login';
  if (p.startsWith('/track')) return 'track';
  return 'portal';
}

function routeToPath(route: AppRoute): string {
  switch (route) {
    case 'track':
      return '/track';
    case 'staff-login':
      return '/staff/login';
    case 'staff-dashboard':
      return '/staff/dashboard';
    default:
      return '/';
  }
}

export default function App() {
  const {
    user: citizenUser,
    cloudTokens,
    signInWithGoogle,
    signOutCitizen,
    syncTokenToCloud,
    updateCloudTokenStatus,
  } = useFirebase();

  const [route, setRoute] = useState<AppRoute>(getInitialRoute);
  const [lang, setLang] = useState<Language>('en');
  const [largeText, setLargeText] = useState(false);
  const [highContrast, setHighContrast] = useState(false);

  const [services, setServices] = useState<ServiceSummary[]>([]);
  const [loadingServices, setLoadingServices] = useState(true);
  const [servicesError, setServicesError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(() =>
    typeof navigator !== 'undefined' ? !navigator.onLine : false
  );
  const [lastSyncedAt, setLastSyncedAt] = useState<number>(() => Date.now());
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  const [joiningService, setJoiningService] = useState<ServiceSummary | null>(null);
  const [sosOpen, setSosOpen] = useState(false);

  const [activePass, setActivePass] = useState<QueueTokenPass | null>(() => {
    try {
      const raw = localStorage.getItem(ACTIVE_PASS_KEY);
      return raw ? (JSON.parse(raw) as QueueTokenPass) : null;
    } catch {
      return null;
    }
  });
  const [passMinimized, setPassMinimized] = useState(false);

  const [staffToken, setStaffToken] = useState<string | null>(() =>
    localStorage.getItem(STAFF_TOKEN_KEY)
  );
  const [staffUser, setStaffUser] = useState<StaffUserPublic | null>(() => {
    try {
      const raw = localStorage.getItem(STAFF_USER_KEY);
      return raw ? (JSON.parse(raw) as StaffUserPublic) : null;
    } catch {
      return null;
    }
  });
  const [staffRefreshSignal, setStaffRefreshSignal] = useState(0);

  const activePassRef = useRef<QueueTokenPass | null>(activePass);
  activePassRef.current = activePass;

  const t = TRANSLATIONS[lang];

  // Apply Accessibility classes to root html element
  useEffect(() => {
    document.documentElement.classList.toggle('a11y-large-text', largeText);
    document.documentElement.classList.toggle('a11y-high-contrast', highContrast);
  }, [largeText, highContrast]);

  // Persist active pass in localStorage
  useEffect(() => {
    if (activePass) {
      localStorage.setItem(ACTIVE_PASS_KEY, JSON.stringify(activePass));
    } else {
      localStorage.removeItem(ACTIVE_PASS_KEY);
    }
  }, [activePass]);

  // Browser history navigation
  const navigate = useCallback(
    (next: AppRoute) => {
      let target = next;
      if (target === 'staff-dashboard' && !staffToken) {
        target = 'staff-login';
      }
      setRoute(target);
      const nextPath = routeToPath(target);
      if (window.location.pathname !== nextPath) {
        window.history.pushState({}, '', nextPath);
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [staffToken]
  );

  useEffect(() => {
    const onPopState = () => {
      const next = getInitialRoute();
      if (next === 'staff-dashboard' && !staffToken) {
        setRoute('staff-login');
      } else {
        setRoute(next);
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [staffToken]);

  // Guard /staff/dashboard if unauthenticated
  useEffect(() => {
    if (route === 'staff-dashboard' && !staffToken) {
      setRoute('staff-login');
      window.history.replaceState({}, '', '/staff/login');
    }
  }, [route, staffToken]);


  const fetchServices = useCallback(async (overrideTokenId?: string) => {
    try {
      const requestedTokenId = overrideTokenId ?? activePassRef.current?.id;
      const url = requestedTokenId
        ? `/api/services?tokenId=${encodeURIComponent(requestedTokenId)}`
        : '/api/services';
      const res = await fetch(url);
      if (!res.ok) throw new Error('Service fetch failed');
      const json = (await res.json()) as {
        services: ServiceSummary[];
        activePass?: QueueTokenPass | null;
      };
      setServices(json.services);
      if (
        json.activePass &&
        activePassRef.current &&
        json.activePass.id === activePassRef.current.id
      ) {
        setActivePass(json.activePass);
        void updateCloudTokenStatus(json.activePass.id, json.activePass.status);
      }
      setServicesError(null);
      setIsOffline(false);
      setLastSyncedAt(Date.now());
    } catch {
      setIsOffline(true);
      setServicesError('Live connection interrupted. Retrying automatically...');
    } finally {
      setLoadingServices(false);
    }
  }, [updateCloudTokenStatus]);

  // Real-time SSE connection (including 30-second prediction engine updates) + fallback polling
  useEffect(() => {
    void fetchServices();

    let es: EventSource | null = null;
    try {
      es = new EventSource('/api/events');
      es.addEventListener('snapshot', (evt) => {
        const payload = JSON.parse((evt as MessageEvent).data) as { services: ServiceSummary[] };
        setServices(payload.services);
        setLoadingServices(false);
        setServicesError(null);
        setIsOffline(false);
        setLastSyncedAt(Date.now());
      });
      const handleUnifiedUpdate = (evt: Event) => {
        const payload = JSON.parse((evt as MessageEvent).data) as { services: ServiceSummary[] };
        setServices(payload.services);
        setIsOffline(false);
        setLastSyncedAt(Date.now());
        setStaffRefreshSignal((n) => n + 1);
        if (activePassRef.current) {
          void fetchServices(activePassRef.current.id);
        }
      };
      es.addEventListener('queue:updated', handleUnifiedUpdate);
      es.addEventListener('prediction:updated', handleUnifiedUpdate);
      es.addEventListener('emergency:alert', () => {
        setStaffRefreshSignal((n) => n + 1);
      });
      es.addEventListener('emergency:updated', () => {
        setStaffRefreshSignal((n) => n + 1);
      });
      es.onerror = () => {
        setIsOffline(!navigator.onLine);
      };
    } catch {
      // Fallback polling below handles environments without SSE
    }

    const fallbackPoll = setInterval(() => {
      void fetchServices();
    }, 5000);

    const tick = setInterval(() => setNowMs(Date.now()), 1000);

    const onOnline = () => {
      setIsOffline(false);
      void fetchServices();
    };
    const onOffline = () => setIsOffline(true);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    return () => {
      es?.close();
      clearInterval(fallbackPoll);
      clearInterval(tick);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [fetchServices]);

  const handleTokenJoined = (pass: QueueTokenPass) => {
    activePassRef.current = pass;
    setJoiningService(null);
    setActivePass(pass);
    setPassMinimized(false);
    setLastSyncedAt(Date.now());
    void syncTokenToCloud(pass);
    void fetchServices(pass.id);
  };

  const handlePassUpdated = (nextPass: QueueTokenPass) => {
    activePassRef.current = nextPass;
    setActivePass(nextPass);
    setLastSyncedAt(Date.now());
    void updateCloudTokenStatus(nextPass.id, nextPass.status);
    void fetchServices(nextPass.id);
  };

  const handleStaffLoginSuccess = (token: string, staff: StaffUserPublic) => {
    localStorage.setItem(STAFF_TOKEN_KEY, token);
    localStorage.setItem(STAFF_USER_KEY, JSON.stringify(staff));
    setStaffToken(token);
    setStaffUser(staff);
    setRoute('staff-dashboard');
    window.history.pushState({}, '', '/staff/dashboard');
  };

  const handleStaffLogout = () => {
    localStorage.removeItem(STAFF_TOKEN_KEY);
    localStorage.removeItem(STAFF_USER_KEY);
    setStaffToken(null);
    setStaffUser(null);
    navigate('staff-login');
  };

  const totalWaiting = services.reduce((acc, s) => acc + s.peopleAhead, 0);
  const totalOpenCounters = services.reduce((acc, s) => acc + s.activeCountersCount, 0);
  const totalCounters = services.reduce((acc, s) => acc + s.totalCountersCount, 0);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <Header
        route={route}
        onNavigate={navigate}
        lang={lang}
        onToggleLang={() => setLang((prev) => (prev === 'en' ? 'hi' : 'en'))}
        largeText={largeText}
        onToggleLargeText={() => setLargeText((v) => !v)}
        highContrast={highContrast}
        onToggleHighContrast={() => setHighContrast((v) => !v)}
        onOpenSos={() => setSosOpen(true)}
        citizenEmail={citizenUser?.email ?? null}
        onCitizenSignIn={() => void signInWithGoogle()}
        onCitizenSignOut={() => void signOutCitizen()}
        staffUser={staffUser}
      />

      <main className="flex-1">
        {isOffline && route === 'portal' && (
          <div className="bg-amber-50 border-b border-amber-300 px-4 py-2.5 text-center text-xs sm:text-sm font-medium text-amber-950 flex items-center justify-center gap-2">
            <WifiOff className="w-4 h-4 shrink-0" />
            <span>{t.offlineBanner}</span>
          </div>
        )}

        {route === 'portal' && (
          <div className="max-w-[1280px] mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-12">
            {/* Hero + Live Hall Display Split */}
            <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
              <div className="lg:col-span-7 flex flex-col justify-between bg-white border border-slate-200 rounded-xl p-6 sm:p-9 ql-surface">
                <div className="space-y-4">
                  <div className="text-xs font-semibold text-blue-700 tracking-wide">
                    {t.brandSubtitle} · {t.heroKicker}
                  </div>
                  <h1 className="text-3xl sm:text-4xl lg:text-[42px] font-bold tracking-tight text-slate-900 leading-[1.15] text-balance max-w-2xl">
                    {t.heroTitle}
                  </h1>
                  <p className="text-base text-slate-600 leading-relaxed max-w-xl ql-muted">
                    {t.heroDesc}
                  </p>
                </div>

                <div className="pt-6 mt-6 border-t border-slate-100 space-y-5">
                  <div className="flex flex-wrap items-center gap-3">
                    <a
                      href="#services-grid"
                      className="px-5 py-2.5 bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold rounded-lg transition-colors inline-flex items-center gap-2 whitespace-nowrap"
                    >
                      <span>{t.heroJoinCta}</span>
                      <ArrowRight className="w-4 h-4" />
                    </a>
                    <button
                      type="button"
                      onClick={() => navigate('track')}
                      className="px-5 py-2.5 bg-white hover:bg-slate-50 text-slate-900 border border-slate-300 text-sm font-semibold rounded-lg transition-colors whitespace-nowrap"
                    >
                      {t.heroTrackCta}
                    </button>
                    {activePass && passMinimized && (
                      <button
                        type="button"
                        onClick={() => setPassMinimized(false)}
                        className="px-4 py-2.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-300 text-sm font-semibold rounded-lg transition-colors font-mono-tabular whitespace-nowrap"
                      >
                        Show Pass ({activePass.tokenCode})
                      </button>
                    )}
                  </div>

                  {/* Facility Summary Strip */}
                  <div className="grid grid-cols-3 gap-4 pt-2">
                    <div>
                      <div className="text-xs text-slate-500 flex items-center gap-1 ql-muted">
                        <Users className="w-3.5 h-3.5" />
                        <span>Total Waiting</span>
                      </div>
                      <div className="text-lg font-bold font-mono-tabular text-slate-900 mt-0.5">
                        {totalWaiting}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500 flex items-center gap-1 ql-muted">
                        <Clock className="w-3.5 h-3.5" />
                        <span>Active Counters</span>
                      </div>
                      <div className="text-lg font-bold font-mono-tabular text-slate-900 mt-0.5">
                        {totalOpenCounters}/{totalCounters} Open
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500 flex items-center gap-1 ql-muted">
                        <Shield className="w-3.5 h-3.5" />
                        <span>Grace Window</span>
                      </div>
                      <div className="text-lg font-bold font-mono-tabular text-slate-900 mt-0.5">
                        05:00 min
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column: Live Privacy-Masked Hall Display Board */}
              <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between ql-surface">
                <div>
                  <div className="flex items-center justify-between gap-2 pb-4 border-b border-slate-200">
                    <div>
                      <h2 className="text-base font-bold text-slate-900">{t.liveHallBoardTitle}</h2>
                      <p className="text-xs text-slate-500 mt-0.5 ql-muted">{t.liveHallBoardSub}</p>
                    </div>
                    <span className="text-xs font-mono-tabular text-slate-500">
                      {new Date(lastSyncedAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </span>
                  </div>

                  <div className="divide-y divide-slate-100 mt-2">
                    {services.map((svc) => {
                      const activeCall = svc.calledTokens[0] ?? null;
                      const grace = activeCall
                        ? formatCountdown(activeCall.graceExpiresAt, nowMs)
                        : null;
                      return (
                        <div key={svc.code} className="py-3.5 flex items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-bold text-slate-900">{svc.name}</div>
                            <div className="text-xs text-slate-500 mt-0.5 ql-muted">
                              {svc.peopleAhead} waiting · {svc.estimatedWaitRange}
                            </div>
                          </div>
                          <div className="text-right">
                            {activeCall ? (
                              <>
                                <div className="text-sm font-bold font-mono-tabular text-amber-800">
                                  CALL {activeCall.tokenCode} → Ctr {activeCall.counterNumber}
                                </div>
                                <div className="text-xs font-mono-tabular text-red-700">
                                  {activeCall.maskedName} · {grace?.formatted}
                                </div>
                              </>
                            ) : (
                              <>
                                <div className="text-sm font-bold font-mono-tabular text-slate-900">
                                  {svc.currentServingToken ?? 'Standby'}
                                </div>
                                <div className="text-xs text-slate-500">
                                  {svc.activeCountersCount} counters active
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100 text-xs text-slate-500">
                  Names are masked on public hall displays. Full details are visible only to
                  authenticated counter staff.
                </div>
              </div>
            </section>

            {/* Active Live Token Pass (Immediately visible after joining) */}
            {activePass && !passMinimized && (
              <LiveTokenPass
                key={activePass.id}
                pass={activePass}
                lang={lang}
                lastSyncedAt={lastSyncedAt}
                isOffline={isOffline}
                onClose={() => setPassMinimized(true)}
                onPassUpdated={handlePassUpdated}
              />
            )}

            {/* Unified Service Cards Grid */}
            <section id="services-grid" className="space-y-6">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-bold text-slate-900">{t.servicesHeading}</h2>
                  <p className="text-sm text-slate-600 mt-1 ql-muted">{t.servicesSubheading}</p>
                </div>
                {servicesError && (
                  <span className="text-xs font-medium text-amber-800">{servicesError}</span>
                )}
              </div>

              {loadingServices ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {[1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      className="h-64 bg-white border border-slate-200 rounded-xl p-6 animate-pulse"
                    />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {services.map((service) => (
                    <ServiceCard
                      key={service.code}
                      service={service}
                      lang={lang}
                      onJoinClick={(svc) => setJoiningService(svc)}
                    />
                  ))}
                </div>
              )}
            </section>

            {/* Upcoming Privacy-Masked Queue Preview */}
            <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4 ql-surface">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  Upcoming Queue Preview (Privacy-Masked)
                </h2>
                <p className="text-xs text-slate-500 mt-0.5 ql-muted">
                  Next in line across all service desks. Medical reasons and full phone numbers are
                  never exposed publicly.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                {services.map((svc) => (
                  <div key={svc.code} className="space-y-2">
                    <div className="text-xs font-bold text-slate-700 pb-1.5 border-b border-slate-200 flex items-center justify-between">
                      <span>{svc.name}</span>
                      <span className="font-mono-tabular text-slate-500">{svc.code}</span>
                    </div>
                    {svc.maskedQueue.length === 0 ? (
                      <div className="text-xs text-slate-500 py-2">Queue clear — no wait</div>
                    ) : (
                      <ul className="space-y-1.5 text-xs">
                        {svc.maskedQueue.slice(0, 4).map((entry) => (
                          <li
                            key={entry.id}
                            className="flex items-center justify-between text-slate-700"
                          >
                            <span className="font-mono-tabular font-semibold text-slate-900">
                              {entry.tokenCode} · {entry.maskedName}
                            </span>
                            <span className="text-slate-500 font-mono-tabular">
                              #{entry.position}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {route === 'track' && (
          <TrackTokenView
            lang={lang}
            activePass={activePass}
            cloudTokens={cloudTokens}
            lastSyncedAt={lastSyncedAt}
            isOffline={isOffline}
            onSelectPass={(pass) => {
              activePassRef.current = pass;
              setActivePass(pass);
              setPassMinimized(false);
            }}
          />
        )}

        {route === 'staff-login' && (
          <StaffLoginPage
            lang={lang}
            onSuccess={handleStaffLoginSuccess}
            onBack={() => navigate('portal')}
          />
        )}

        {route === 'staff-dashboard' && staffToken && (
          <StaffDashboard
            staffToken={staffToken}
            onLogout={handleStaffLogout}
            refreshSignal={staffRefreshSignal}
          />
        )}
      </main>

      {/* Clean Minimal Footer */}
      <footer className="border-t border-slate-200 bg-white mt-12 ql-surface">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 py-6 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500 ql-muted">
          <div>
            <strong className="text-slate-800">Queueless</strong> — Smart Virtual Queue & Waiting
            System · Routine queue PII automatically anonymized 24 hours after completion.
          </div>
          <div className="flex items-center gap-5">
            <button
              type="button"
              onClick={() => navigate('track')}
              className="hover:text-slate-900"
            >
              {t.navTrack}
            </button>
            <button
              type="button"
              onClick={() => navigate(staffToken ? 'staff-dashboard' : 'staff-login')}
              className="hover:text-slate-900"
            >
              {t.navStaffPortal}
            </button>
            <button
              type="button"
              onClick={() => setSosOpen(true)}
              className="text-red-700 font-semibold hover:underline"
            >
              {t.emergencySos}
            </button>
          </div>
        </div>
      </footer>

      {/* Domain-Specific Join Modal (synced to live services array) */}
      {joiningService && (
        <JoinQueueModal
          service={services.find((s) => s.code === joiningService.code) ?? joiningService}
          lang={lang}
          citizenUid={citizenUser?.uid ?? null}
          defaultName={citizenUser?.displayName ?? ''}
          defaultEmail={citizenUser?.email ?? ''}
          onClose={() => setJoiningService(null)}
          onJoined={handleTokenJoined}
        />
      )}

      {/* Strictly Isolated Emergency SOS Modal */}
      {sosOpen && <EmergencySosModal lang={lang} onClose={() => setSosOpen(false)} />}
    </div>
  );
}
