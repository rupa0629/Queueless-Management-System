import { ArrowRight, BookOpen, Building2, Landmark, Stethoscope } from 'lucide-react';
import type { Language } from '../i18n/translations.ts';
import { TRANSLATIONS } from '../i18n/translations.ts';
import type { ServiceCode, ServiceSummary } from '../shared/types.ts';

interface ServiceCardProps {
  service: ServiceSummary;
  lang: Language;
  onJoinClick: (service: ServiceSummary) => void;
}

const SERVICE_ICONS: Record<ServiceCode, typeof Stethoscope> = {
  HOPD: Stethoscope,
  BANK: Landmark,
  PASS: Building2,
  LIB: BookOpen,
};

export function ServiceCard({ service, lang, onJoinClick }: ServiceCardProps) {
  const t = TRANSLATIONS[lang];
  const Icon = SERVICE_ICONS[service.code];
  const allPaused = service.activeCountersCount === 0;

  return (
    <article className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between gap-5 ql-surface">
      <div className="space-y-4">
        {/* Clean Metadata Kicker (Zero Pills) */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-600 ql-muted">
            <span className="font-mono-tabular font-semibold text-slate-900">{service.code}</span>
            <span aria-hidden="true">·</span>
            <span>{service.counterRangeLabel}</span>
          </div>
          <span
            className={`text-xs font-semibold tabular-nums ${
              allPaused ? 'text-amber-700' : 'text-emerald-700'
            }`}
          >
            {allPaused
              ? 'All Counters Paused'
              : `${service.activeCountersCount}/${service.totalCountersCount} Counters Open`}
          </span>
        </div>

        {/* Title & Description */}
        <div className="flex items-start gap-3.5">
          <div className="w-10 h-10 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-blue-700 shrink-0">
            <Icon className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-lg font-bold text-slate-900 leading-snug">{service.name}</h3>
            <p className="text-sm text-slate-600 mt-1 leading-relaxed ql-muted">
              {service.description}
            </p>
          </div>
        </div>

        {/* Unified Engine Live Metrics Grid */}
        <div className="grid grid-cols-3 gap-3 pt-4 border-t border-slate-100">
          <div>
            <div className="text-xs text-slate-500 ql-muted">{t.peopleAhead}</div>
            <div className="text-xl font-bold font-mono-tabular text-slate-900 mt-0.5">
              {service.peopleAhead}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500 ql-muted">{t.estWait}</div>
            <div className="text-sm font-bold font-mono-tabular text-blue-700 mt-1">
              {service.estimatedWaitRange}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500 ql-muted">{t.nowServing}</div>
            <div className="text-sm font-bold font-mono-tabular text-slate-900 mt-1">
              {service.currentServingToken ?? 'Ready'}
            </div>
          </div>
        </div>

        <div className="text-xs text-slate-500 font-mono-tabular flex items-center justify-between gap-2 ql-muted">
          <span>Avg {service.effectiveAvgServiceMinutes}m/visit</span>
          <span>Refreshes every 30s · {service.predictionConfidence} confidence</span>
        </div>
      </div>

      {/* Primary Action */}
      <button
        type="button"
        onClick={() => onJoinClick(service)}
        className="w-full py-2.5 px-4 bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 whitespace-nowrap"
      >
        <span>{t.joinQueueBtn}</span>
        <ArrowRight className="w-4 h-4 shrink-0" />
      </button>
    </article>
  );
}
