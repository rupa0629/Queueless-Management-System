import { useState } from 'react';
import {
  AlertTriangle,
  Eye,
  Languages,
  Menu,
  ShieldCheck,
  UserCheck,
  X,
} from 'lucide-react';
import type { Language } from '../i18n/translations.ts';
import { TRANSLATIONS } from '../i18n/translations.ts';
import type { StaffUserPublic } from '../shared/types.ts';

export type AppRoute = 'portal' | 'track' | 'staff-login' | 'staff-dashboard';

interface HeaderProps {
  route: AppRoute;
  onNavigate: (route: AppRoute) => void;
  lang: Language;
  onToggleLang: () => void;
  largeText: boolean;
  onToggleLargeText: () => void;
  highContrast: boolean;
  onToggleHighContrast: () => void;
  onOpenSos: () => void;
  citizenEmail: string | null;
  onCitizenSignIn: () => void;
  onCitizenSignOut: () => void;
  staffUser: StaffUserPublic | null;
}

export function Header({
  route,
  onNavigate,
  lang,
  onToggleLang,
  largeText,
  onToggleLargeText,
  highContrast,
  onToggleHighContrast,
  onOpenSos,
  citizenEmail,
  onCitizenSignIn,
  onCitizenSignOut,
  staffUser,
}: HeaderProps) {
  const t = TRANSLATIONS[lang];
  const [mobileOpen, setMobileOpen] = useState(false);
  const [a11yOpen, setA11yOpen] = useState(false);

  const navLinkClass = (active: boolean) =>
    `text-sm font-medium whitespace-nowrap shrink-0 transition-colors py-1 border-b-2 ${
      active
        ? 'text-blue-700 border-blue-700 font-semibold'
        : 'text-slate-700 border-transparent hover:text-slate-950 hover:border-slate-300'
    }`;

  return (
    <header className="sticky top-0 z-40 bg-white border-b border-slate-200 ql-surface">
      <div className="max-w-[1280px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4 lg:gap-8">
        {/* Zone 1: Single-line Brand Wordmark */}
        <button
          type="button"
          onClick={() => {
            onNavigate('portal');
            setMobileOpen(false);
          }}
          className="flex items-center gap-2.5 text-left whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-blue-700 rounded-md"
        >
          <span className="w-8 h-8 rounded-lg bg-blue-700 text-white flex items-center justify-center font-mono-tabular font-bold text-sm shrink-0">
            Q
          </span>
          <span className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
            {t.brandName}
          </span>
        </button>

        {/* Zone 2: Concise Single-Line Navigation Links */}
        <nav className="hidden lg:flex items-center gap-6">
          <button
            type="button"
            onClick={() => onNavigate('portal')}
            className={navLinkClass(route === 'portal')}
          >
            {t.navServices}
          </button>
          <button
            type="button"
            onClick={() => onNavigate('track')}
            className={navLinkClass(route === 'track')}
          >
            {t.navTrack}
          </button>
          <button
            type="button"
            onClick={() => onNavigate(staffUser ? 'staff-dashboard' : 'staff-login')}
            className={navLinkClass(route === 'staff-login' || route === 'staff-dashboard')}
          >
            {staffUser ? t.navStaffPortal : t.navStaff}
          </button>
          {citizenEmail ? (
            <button
              type="button"
              onClick={onCitizenSignOut}
              className="text-sm font-medium text-slate-700 hover:text-slate-950 whitespace-nowrap shrink-0 flex items-center gap-1.5"
              title={citizenEmail}
            >
              <UserCheck className="w-4 h-4 text-emerald-700" />
              <span>{t.navSignOut}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onCitizenSignIn}
              className="text-sm font-medium text-slate-700 hover:text-slate-950 whitespace-nowrap shrink-0"
            >
              {t.navSignIn}
            </button>
          )}
          <div className="relative">
            <button
              type="button"
              onClick={() => setA11yOpen((prev) => !prev)}
              aria-expanded={a11yOpen}
              className="text-sm font-medium text-slate-700 hover:text-slate-950 whitespace-nowrap shrink-0 flex items-center gap-1.5 py-1"
            >
              <Eye className="w-4 h-4" />
              <span>{lang === 'en' ? 'Accessibility' : 'सुलभता'}</span>
            </button>
            {a11yOpen && (
              <div className="absolute right-0 mt-2 w-60 bg-white border border-slate-200 rounded-xl shadow-lg p-3 space-y-2 z-50 ql-surface">
                <button
                  type="button"
                  onClick={onToggleLargeText}
                  className={`w-full flex items-center justify-between px-3 py-2 text-sm rounded-lg border transition-colors ${
                    largeText
                      ? 'bg-blue-50 border-blue-700 text-blue-900 font-semibold'
                      : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <span>{t.a11yLargeText}</span>
                  <span className="font-mono-tabular text-xs">{largeText ? 'ON' : 'OFF'}</span>
                </button>
                <button
                  type="button"
                  onClick={onToggleHighContrast}
                  className={`w-full flex items-center justify-between px-3 py-2 text-sm rounded-lg border transition-colors ${
                    highContrast
                      ? 'bg-slate-900 border-slate-900 text-white font-semibold'
                      : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <span>{t.a11yHighContrast}</span>
                  <span className="font-mono-tabular text-xs">{highContrast ? 'ON' : 'OFF'}</span>
                </button>
                <button
                  type="button"
                  onClick={onToggleLang}
                  className="w-full flex items-center justify-between px-3 py-2 text-sm rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  <span className="flex items-center gap-1.5">
                    <Languages className="w-4 h-4" />
                    <span>Language</span>
                  </span>
                  <span className="font-mono-tabular text-xs font-semibold">
                    {lang === 'en' ? 'EN → हिं' : 'हिं → EN'}
                  </span>
                </button>
              </div>
            )}
          </div>
        </nav>

        {/* Zone 3: Primary Emergency SOS Action + Mobile Toggle */}
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onOpenSos}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs sm:text-sm font-semibold text-white bg-red-700 hover:bg-red-800 rounded-lg transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-red-700"
          >
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{t.emergencySos}</span>
          </button>

          <button
            type="button"
            onClick={() => setMobileOpen((prev) => !prev)}
            aria-label="Toggle navigation menu"
            className="lg:hidden p-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100"
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Navigation Drawer */}
      {mobileOpen && (
        <div className="lg:hidden border-t border-slate-200 bg-white px-4 py-4 space-y-2 ql-surface">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                onNavigate('portal');
                setMobileOpen(false);
              }}
              className="px-3 py-2.5 text-sm font-medium text-left rounded-lg border border-slate-200 text-slate-900 hover:bg-slate-50"
            >
              {t.navServices}
            </button>
            <button
              type="button"
              onClick={() => {
                onNavigate('track');
                setMobileOpen(false);
              }}
              className="px-3 py-2.5 text-sm font-medium text-left rounded-lg border border-slate-200 text-slate-900 hover:bg-slate-50"
            >
              {t.navTrack}
            </button>
            <button
              type="button"
              onClick={() => {
                onNavigate(staffUser ? 'staff-dashboard' : 'staff-login');
                setMobileOpen(false);
              }}
              className="px-3 py-2.5 text-sm font-medium text-left rounded-lg border border-slate-200 text-slate-900 hover:bg-slate-50 flex items-center gap-1.5"
            >
              <ShieldCheck className="w-4 h-4 text-blue-700" />
              <span>{staffUser ? t.navStaffPortal : t.navStaff}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (citizenEmail) {
                  onCitizenSignOut();
                } else {
                  onCitizenSignIn();
                }
                setMobileOpen(false);
              }}
              className="px-3 py-2.5 text-sm font-medium text-left rounded-lg border border-slate-200 text-slate-900 hover:bg-slate-50"
            >
              {citizenEmail ? t.navSignOut : t.navSignIn}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onToggleLargeText}
              className={`px-3 py-2 text-xs font-medium rounded-lg border ${
                largeText ? 'bg-blue-50 border-blue-700 text-blue-900' : 'border-slate-200 text-slate-700'
              }`}
            >
              {t.a11yLargeText}: {largeText ? 'ON' : 'OFF'}
            </button>
            <button
              type="button"
              onClick={onToggleHighContrast}
              className={`px-3 py-2 text-xs font-medium rounded-lg border ${
                highContrast ? 'bg-slate-900 border-slate-900 text-white' : 'border-slate-200 text-slate-700'
              }`}
            >
              {t.a11yHighContrast}: {highContrast ? 'ON' : 'OFF'}
            </button>
            <button
              type="button"
              onClick={onToggleLang}
              className="px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 text-slate-700"
            >
              {lang === 'en' ? 'हिन्दी (HI)' : 'English (EN)'}
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
