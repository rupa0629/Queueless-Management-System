import React, { useState } from 'react';
import { ArrowRight, Search } from 'lucide-react';
import type { Language } from '../i18n/translations.ts';
import { TRANSLATIONS } from '../i18n/translations.ts';
import type { CloudSavedToken } from '../contexts/FirebaseContext.tsx';
import type { QueueTokenPass } from '../shared/types.ts';
import { LiveTokenPass } from './LiveTokenPass.tsx';

interface TrackTokenViewProps {
  lang: Language;
  activePass: QueueTokenPass | null;
  cloudTokens: CloudSavedToken[];
  lastSyncedAt: number;
  isOffline: boolean;
  onSelectPass: (pass: QueueTokenPass) => void;
}

export function TrackTokenView({
  lang,
  activePass,
  cloudTokens,
  lastSyncedAt,
  isOffline,
  onSelectPass,
}: TrackTokenViewProps) {
  const t = TRANSLATIONS[lang];
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<QueueTokenPass[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleLookup = async (searchValue: string) => {
    const trimmed = searchValue.trim();
    if (!trimmed) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/tokens/lookup?query=${encodeURIComponent(trimmed)}`);
      const data = (await res.json()) as { passes?: QueueTokenPass[]; error?: string };
      if (!res.ok || !data.passes) {
        setResults([]);
        setError(data.error || 'No matching token found.');
        return;
      }
      setResults(data.passes);
      if (data.passes.length === 1) {
        onSelectPass(data.passes[0]);
      }
    } catch {
      setError('Unable to reach server. Check your connection.');
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void handleLookup(query);
  };

  return (
    <div className="max-w-[960px] mx-auto px-4 sm:px-6 py-10 space-y-8">
      <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-5 ql-surface">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t.trackTitle}</h1>
          <p className="text-sm text-slate-600 mt-1 ql-muted">{t.trackSubtitle}</p>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.trackPlaceholder}
              className="w-full pl-10 pr-4 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-2 focus:outline-blue-700"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="px-5 py-2.5 bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold rounded-lg transition-colors whitespace-nowrap disabled:opacity-60"
          >
            {loading ? 'Searching...' : t.trackSearchBtn}
          </button>
        </form>

        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span>Quick demo lookup:</span>
          {['HOPD-102', 'HOPD-103', 'BANK-202', 'PASS-302'].map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => {
                setQuery(code);
                void handleLookup(code);
              }}
              className="font-mono-tabular font-semibold text-blue-700 hover:underline px-1.5 py-0.5"
            >
              {code}
            </button>
          ))}
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg">
            {error}
          </div>
        )}

        {results.length > 1 && (
          <div className="space-y-2 pt-2">
            <div className="text-xs font-semibold text-slate-500">Matching Tokens</div>
            <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
              {results.map((pass) => (
                <button
                  key={pass.id}
                  type="button"
                  onClick={() => onSelectPass(pass)}
                  className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-slate-50 transition-colors"
                >
                  <div>
                    <span className="font-mono-tabular font-bold text-slate-900">{pass.tokenCode}</span>
                    <span className="text-sm text-slate-600 ml-3">{pass.serviceName}</span>
                    <span className="text-xs text-slate-500 ml-2">· {pass.status}</span>
                  </div>
                  <ArrowRight className="w-4 h-4 text-slate-400" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Active Pass */}
      {activePass && (
        <LiveTokenPass
          pass={activePass}
          lang={lang}
          lastSyncedAt={lastSyncedAt}
          isOffline={isOffline}
          onPassUpdated={onSelectPass}
        />
      )}

      {/* Synced Cloud Passes for Signed-In Citizens */}
      {cloudTokens.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3 ql-surface">
          <h2 className="text-base font-bold text-slate-900">Your Synced Passes</h2>
          <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
            {cloudTokens.map((ct) => (
              <div
                key={ct.tokenId}
                className="px-4 py-3 flex items-center justify-between gap-4"
              >
                <div className="text-sm">
                  <span className="font-mono-tabular font-bold text-slate-900">{ct.tokenCode}</span>
                  <span className="text-slate-600 ml-2">· {ct.bookedForName}</span>
                  <span className="text-slate-500 ml-2 font-mono-tabular">PIN {ct.pin}</span>
                </div>
                <button
                  type="button"
                  onClick={() => void handleLookup(ct.tokenCode)}
                  className="text-xs font-semibold text-blue-700 hover:underline whitespace-nowrap"
                >
                  Open Live Pass
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
