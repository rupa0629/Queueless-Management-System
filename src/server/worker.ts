import crypto from 'node:crypto';
import { PREDICTION_INTERVAL_MS, refreshPredictionSnapshot } from './engine.ts';
import { withQueueLock } from './mutex.ts';
import { getDb, persistDb } from './store.ts';
import type { ServiceCode } from '../shared/types.ts';

const GRACE_CHECK_INTERVAL_MS = 10_000;
const PII_RETENTION_MS = 24 * 60 * 60 * 1000;

export function startBackgroundWorker(
  onStateChanged: (reason: string, serviceCode?: ServiceCode) => void
): () => void {
  // Initialize prediction snapshot immediately at startup
  refreshPredictionSnapshot(getDb());

  const runTick = async () => {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const touchedServices = new Set<ServiceCode>();

    await withQueueLock('global-worker', async () => {
      const db = getDb();
      let changed = false;

      // 1. Auto-expire 5-minute grace windows (CALLED -> GRACE_EXPIRED) and free counters
      for (const token of db.tokens) {
        if (token.status === 'CALLED' && token.graceExpiresAt) {
          const expiresMs = new Date(token.graceExpiresAt).getTime();
          if (now >= expiresMs) {
            token.status = 'GRACE_EXPIRED';
            token.updatedAt = nowIso;
            if (token.assignedCounterId) {
              const ctr = db.counters.find((c) => c.id === token.assignedCounterId);
              if (ctr && ctr.currentTokenId === token.id) {
                ctr.currentTokenId = null;
                ctr.updatedAt = nowIso;
              }
            }
            db.metrics.unshift({
              id: crypto.randomUUID(),
              serviceCode: token.serviceCode,
              eventType: 'GRACE_EXPIRED_AUTO',
              tokenCode: token.tokenCode,
              counterId: token.assignedCounterId,
              waitSeconds: token.calledAt
                ? Math.round((now - new Date(token.createdAt).getTime()) / 1000)
                : null,
              createdAt: nowIso,
            });
            touchedServices.add(token.serviceCode);
            changed = true;
          }
        }
      }

      // 2. Re-activate DEFERRED_30M tokens whose 30-minute target_ready_time has arrived
      for (const token of db.tokens) {
        if (token.status === 'DEFERRED_30M' && token.requeueAfter) {
          const requeueMs = new Date(token.requeueAfter).getTime();
          if (now >= requeueMs) {
            token.status = 'WAITING';
            const priorityOffset = token.priorityWeight * 5 * 60 * 1000;
            token.queueOrder =
              (token.targetReadyTime ? new Date(token.targetReadyTime).getTime() : now) -
              priorityOffset;
            token.assignedCounterId = null;
            token.graceExpiresAt = null;
            token.requeueAfter = null;
            token.updatedAt = nowIso;

            db.metrics.unshift({
              id: crypto.randomUUID(),
              serviceCode: token.serviceCode,
              eventType: 'DEFERRED_REINSERTED',
              tokenCode: token.tokenCode,
              counterId: null,
              waitSeconds: null,
              createdAt: nowIso,
            });
            touchedServices.add(token.serviceCode);
            changed = true;
          }
        }
      }

      // 3. Automated 24-hour PII retention cleanup
      const terminalStatuses = new Set([
        'COMPLETED',
        'GRACE_EXPIRED',
        'SKIPPED_TIMEOUT',
        'CANCELLED_NO_ANSWER',
        'CANCELLED_BY_USER',
      ]);
      for (const token of db.tokens) {
        if (!token.piiAnonymizedAt && terminalStatuses.has(token.status)) {
          const refIso = token.completedAt ?? token.updatedAt;
          const refMs = new Date(refIso).getTime();
          if (now - refMs >= PII_RETENTION_MS) {
            token.fullName = 'Anonymized Visitor';
            token.phone = null;
            token.email = null;
            token.assistedByName = null;
            if (token.serviceCode === 'HOPD') {
              token.serviceDetail = '[Redacted Clinical Reason]';
            }
            token.piiAnonymizedAt = nowIso;
            token.updatedAt = nowIso;
            changed = true;
          }
        }
      }

      if (db.metrics.length > 200) {
        db.metrics = db.metrics.slice(0, 200);
      }

      if (changed) {
        refreshPredictionSnapshot(db);
        persistDb();
      }
    });

    for (const svc of touchedServices) {
      onStateChanged('worker:transition', svc);
    }
  };

  // Dedicated 30-second Wait-Time Prediction Engine cycle
  const runPredictionCycle = async () => {
    await withQueueLock('prediction-refresh', () => {
      const db = getDb();
      refreshPredictionSnapshot(db);
    });
    onStateChanged('prediction:refresh');
  };

  const workerTimer = setInterval(() => {
    void runTick().catch((err) => console.error('Worker tick error:', err));
  }, GRACE_CHECK_INTERVAL_MS);

  const predictionTimer = setInterval(() => {
    void runPredictionCycle().catch((err) => console.error('Prediction cycle error:', err));
  }, PREDICTION_INTERVAL_MS);

  return () => {
    clearInterval(workerTimer);
    clearInterval(predictionTimer);
  };
}
