import type {
  CounterInfo,
  MaskedQueueEntry,
  PredictionConfidence,
  QueueTokenPass,
  QueueTokenStaff,
  ServiceCode,
  ServiceSummary,
  StaffRole,
} from '../shared/types.ts';
import type {
  QueuelessDatabase,
  StoredCounter,
  StoredQueueToken,
  StoredService,
} from './store.ts';

export const PREDICTION_INTERVAL_MS = 30_000;

interface CachedServicePrediction {
  effectiveAvgServiceMinutes: number;
  sampleCount: number;
  confidence: PredictionConfidence;
  updatedAt: string;
  nextUpdateAt: string;
}

const predictionCache = new Map<ServiceCode, CachedServicePrediction>();
let lastPredictionRunAtMs = Date.now();

export function getPredictionTimestamps(): {
  predictionUpdatedAt: string;
  nextPredictionAt: string;
} {
  return {
    predictionUpdatedAt: new Date(lastPredictionRunAtMs).toISOString(),
    nextPredictionAt: new Date(lastPredictionRunAtMs + PREDICTION_INTERVAL_MS).toISOString(),
  };
}

export function maskPersonName(fullName: string): string {
  const trimmed = fullName.trim();
  if (!trimmed) return 'V***';
  const parts = trimmed.split(/\s+/);
  return parts
    .map((part) => {
      if (part.length <= 1) return `${part}***`;
      return `${part[0]}***`;
    })
    .join(' ');
}

function getEffectiveCapacity(counters: StoredCounter[]): {
  activeCount: number;
  effectiveCapacity: number;
} {
  let activeCount = 0;
  let effectiveCapacity = 0;
  for (const ctr of counters) {
    if (ctr.status === 'OPEN') {
      activeCount += 1;
      effectiveCapacity += 1.0;
    } else if (ctr.status === 'BUSY_COMPLEX') {
      activeCount += 1;
      effectiveCapacity += 0.6;
    }
  }
  return { activeCount, effectiveCapacity };
}

export function getOrderedWaitingTokens(
  db: QueuelessDatabase,
  serviceCode: ServiceCode
): StoredQueueToken[] {
  return db.tokens
    .filter((t) => t.serviceCode === serviceCode && t.status === 'WAITING')
    .sort((a, b) => {
      if (a.queueOrder !== b.queueOrder) return a.queueOrder - b.queueOrder;
      return a.createdAt.localeCompare(b.createdAt);
    });
}

function calibrateServiceMinutes(
  db: QueuelessDatabase,
  service: StoredService,
  activeCount: number
): {
  effectiveAvgServiceMinutes: number;
  sampleCount: number;
  confidence: PredictionConfidence;
} {
  const completed = db.tokens
    .filter(
      (t) =>
        t.serviceCode === service.code &&
        t.status === 'COMPLETED' &&
        t.serviceStartedAt &&
        t.completedAt
    )
    .sort((a, b) => (a.completedAt ?? '').localeCompare(b.completedAt ?? ''))
    .slice(-20);

  if (completed.length === 0) {
    return {
      effectiveAvgServiceMinutes: service.avgServiceMinutes,
      sampleCount: 0,
      confidence: activeCount >= 2 ? 'MEDIUM' : 'LOW',
    };
  }

  // Exponentially Weighted Moving Average over recent actual durations
  const alpha = 0.35;
  let ewma = service.avgServiceMinutes;
  const minClamp = Math.max(1, service.avgServiceMinutes * 0.5);
  const maxClamp = service.avgServiceMinutes * 2.0;

  for (const tok of completed) {
    const startMs = new Date(tok.serviceStartedAt!).getTime();
    const endMs = new Date(tok.completedAt!).getTime();
    const durationMins = Math.min(maxClamp, Math.max(minClamp, (endMs - startMs) / 60000));
    ewma = alpha * durationMins + (1 - alpha) * ewma;
  }

  const observedWeight = Math.min(0.65, completed.length * 0.12);
  const blended = observedWeight * ewma + (1 - observedWeight) * service.avgServiceMinutes;
  const effectiveAvgServiceMinutes = Math.round(blended * 10) / 10;

  const confidence: PredictionConfidence =
    completed.length >= 5 && activeCount >= 1
      ? 'HIGH'
      : activeCount >= 1
      ? 'MEDIUM'
      : 'LOW';

  return {
    effectiveAvgServiceMinutes,
    sampleCount: completed.length,
    confidence,
  };
}

export function refreshPredictionSnapshot(db: QueuelessDatabase): void {
  const nowMs = Date.now();
  lastPredictionRunAtMs = nowMs;
  const updatedAt = new Date(nowMs).toISOString();
  const nextUpdateAt = new Date(nowMs + PREDICTION_INTERVAL_MS).toISOString();

  for (const service of db.services) {
    const serviceCounters = db.counters.filter((c) => c.serviceCode === service.code);
    const { activeCount } = getEffectiveCapacity(serviceCounters);
    const calibrated = calibrateServiceMinutes(db, service, activeCount);

    predictionCache.set(service.code, {
      effectiveAvgServiceMinutes: calibrated.effectiveAvgServiceMinutes,
      sampleCount: calibrated.sampleCount,
      confidence: calibrated.confidence,
      updatedAt,
      nextUpdateAt,
    });
  }
}

function getServicePredictionMeta(
  db: QueuelessDatabase,
  service: StoredService,
  activeCount: number
): CachedServicePrediction {
  const existing = predictionCache.get(service.code);
  if (existing) return existing;

  const calibrated = calibrateServiceMinutes(db, service, activeCount);
  const { predictionUpdatedAt, nextPredictionAt } = getPredictionTimestamps();
  const entry: CachedServicePrediction = {
    effectiveAvgServiceMinutes: calibrated.effectiveAvgServiceMinutes,
    sampleCount: calibrated.sampleCount,
    confidence: calibrated.confidence,
    updatedAt: predictionUpdatedAt,
    nextUpdateAt: nextPredictionAt,
  };
  predictionCache.set(service.code, entry);
  return entry;
}

function computeDynamicWaitRange(params: {
  effectiveAvgMinutes: number;
  peopleAhead: number;
  inServiceTokens: StoredQueueToken[];
  calledTokens: StoredQueueToken[];
  imminentDeferredCount: number;
  activeCountersCount: number;
  effectiveCapacity: number;
  nowMs: number;
}): { waitMinMinutes: number; waitMaxMinutes: number; estimatedWaitRange: string } {
  const {
    effectiveAvgMinutes,
    peopleAhead,
    inServiceTokens,
    calledTokens,
    imminentDeferredCount,
    activeCountersCount,
    effectiveCapacity,
    nowMs,
  } = params;

  if (effectiveCapacity <= 0 || activeCountersCount === 0) {
    return {
      waitMinMinutes: 0,
      waitMaxMinutes: 0,
      estimatedWaitRange: 'Counters Paused',
    };
  }

  const freeSlots = Math.max(0, activeCountersCount - (inServiceTokens.length + calledTokens.length));
  if (peopleAhead === 0 && freeSlots > 0) {
    const maxQuick = Math.max(2, Math.round(effectiveAvgMinutes * 0.45));
    return {
      waitMinMinutes: 0,
      waitMaxMinutes: maxQuick,
      estimatedWaitRange: `~0–${maxQuick} mins`,
    };
  }

  // Sum remaining active work across IN_SERVICE & CALLED counters
  let activeMinutesRemaining = 0;
  for (const tok of inServiceTokens) {
    const elapsedMins = tok.serviceStartedAt
      ? Math.max(0, (nowMs - new Date(tok.serviceStartedAt).getTime()) / 60000)
      : effectiveAvgMinutes * 0.5;
    activeMinutesRemaining += Math.max(1, effectiveAvgMinutes - elapsedMins);
  }
  for (const tok of calledTokens) {
    const graceRemainingMins = tok.graceExpiresAt
      ? Math.max(0.25, Math.min(5, (new Date(tok.graceExpiresAt).getTime() - nowMs) / 60000))
      : 2.5;
    // Expected time for a called visitor to arrive and complete service
    activeMinutesRemaining += graceRemainingMins * 0.25 + effectiveAvgMinutes * 0.85;
  }

  const queuedMinutes =
    (peopleAhead + imminentDeferredCount * 0.5) * effectiveAvgMinutes + activeMinutesRemaining;

  const expectedMinutes = queuedMinutes / effectiveCapacity;
  const base = Math.max(2, Math.round(expectedMinutes));
  const waitMinMinutes = Math.max(1, Math.round(base * 0.8));
  const waitMaxMinutes = Math.max(waitMinMinutes + 3, Math.round(base * 1.25));

  return {
    waitMinMinutes,
    waitMaxMinutes,
    estimatedWaitRange: `~${waitMinMinutes}–${waitMaxMinutes} mins`,
  };
}

export function computeServiceSummary(db: QueuelessDatabase, service: StoredService): ServiceSummary {
  const nowMs = Date.now();
  const serviceCounters = db.counters
    .filter((c) => c.serviceCode === service.code)
    .sort((a, b) => a.counterNumber - b.counterNumber);

  const { activeCount, effectiveCapacity } = getEffectiveCapacity(serviceCounters);
  const predMeta = getServicePredictionMeta(db, service, activeCount);

  const waitingTokens = getOrderedWaitingTokens(db, service.code);
  const calledTokensList = db.tokens.filter(
    (t) => t.serviceCode === service.code && t.status === 'CALLED'
  );
  const inServiceList = db.tokens.filter(
    (t) => t.serviceCode === service.code && t.status === 'IN_SERVICE'
  );
  const deferredList = db.tokens.filter(
    (t) => t.serviceCode === service.code && t.status === 'DEFERRED_30M'
  );
  const imminentDeferredCount = deferredList.filter(
    (t) => t.requeueAfter && new Date(t.requeueAfter).getTime() - nowMs <= 5 * 60 * 1000
  ).length;

  const waitCalc = computeDynamicWaitRange({
    effectiveAvgMinutes: predMeta.effectiveAvgServiceMinutes,
    peopleAhead: waitingTokens.length,
    inServiceTokens: inServiceList,
    calledTokens: calledTokensList,
    imminentDeferredCount,
    activeCountersCount: activeCount,
    effectiveCapacity,
    nowMs,
  });

  const counterInfos: CounterInfo[] = serviceCounters.map((ctr) => {
    const activeToken = ctr.currentTokenId
      ? db.tokens.find((t) => t.id === ctr.currentTokenId)
      : undefined;
    return {
      id: ctr.id,
      counterNumber: ctr.counterNumber,
      serviceCode: ctr.serviceCode,
      label: ctr.label,
      status: ctr.status,
      currentTokenId: activeToken?.id ?? null,
      currentTokenCode: activeToken?.tokenCode ?? null,
      currentTokenStatus: activeToken?.status ?? null,
      graceExpiresAt: activeToken?.status === 'CALLED' ? activeToken.graceExpiresAt : null,
    };
  });

  const calledTokens = calledTokensList.map((tok) => {
    const ctr = serviceCounters.find((c) => c.id === tok.assignedCounterId);
    return {
      tokenId: tok.id,
      tokenCode: tok.tokenCode,
      counterNumber: ctr?.counterNumber ?? 0,
      graceExpiresAt: tok.graceExpiresAt,
      maskedName: maskPersonName(tok.fullName),
    };
  });

  const activeTokenOnCounter = inServiceList[0] ?? calledTokensList[0] ?? null;

  const maskedQueue: MaskedQueueEntry[] = waitingTokens.slice(0, 8).map((tok, index) => ({
    id: tok.id,
    tokenCode: tok.tokenCode,
    maskedName: maskPersonName(tok.fullName),
    status: tok.status,
    priorityCategory: tok.priorityCategory,
    isWalkIn: tok.isWalkIn,
    position: index + 1,
    requeueAfter: tok.requeueAfter,
  }));

  return {
    code: service.code,
    name: service.name,
    description: service.description,
    counterRangeLabel: service.counterRangeLabel,
    avgServiceMinutes: service.avgServiceMinutes,
    effectiveAvgServiceMinutes: predMeta.effectiveAvgServiceMinutes,
    predictionConfidence: predMeta.confidence,
    predictionSampleCount: predMeta.sampleCount,
    predictionUpdatedAt: predMeta.updatedAt,
    nextPredictionAt: predMeta.nextUpdateAt,
    peopleAhead: waitingTokens.length,
    activeCountersCount: activeCount,
    totalCountersCount: serviceCounters.length,
    waitMinMinutes: waitCalc.waitMinMinutes,
    waitMaxMinutes: waitCalc.waitMaxMinutes,
    estimatedWaitRange: waitCalc.estimatedWaitRange,
    currentServingToken: activeTokenOnCounter?.tokenCode ?? null,
    calledTokens,
    counters: counterInfos,
    maskedQueue,
    deferredCount: deferredList.length,
  };
}

export function computeAllServices(db: QueuelessDatabase): ServiceSummary[] {
  return db.services.map((svc) => computeServiceSummary(db, svc));
}

export function buildTokenPass(db: QueuelessDatabase, token: StoredQueueToken): QueueTokenPass {
  const nowMs = Date.now();
  const service = db.services.find((s) => s.code === token.serviceCode)!;
  const serviceCounters = db.counters.filter((c) => c.serviceCode === token.serviceCode);
  const { activeCount, effectiveCapacity } = getEffectiveCapacity(serviceCounters);
  const predMeta = getServicePredictionMeta(db, service, activeCount);

  const waitingTokens = getOrderedWaitingTokens(db, token.serviceCode);
  const calledTokensList = db.tokens.filter(
    (t) => t.serviceCode === token.serviceCode && t.status === 'CALLED'
  );
  const inServiceList = db.tokens.filter(
    (t) => t.serviceCode === token.serviceCode && t.status === 'IN_SERVICE'
  );

  const assignedCtr = token.assignedCounterId
    ? serviceCounters.find((c) => c.id === token.assignedCounterId) ?? null
    : null;

  const activeTokenOnCounter = inServiceList[0] ?? calledTokensList[0] ?? null;

  let peopleAhead = 0;
  let waitCalc = {
    waitMinMinutes: 0,
    waitMaxMinutes: 0,
    estimatedWaitRange: 'Completed',
  };
  let twoTokensAway = false;

  if (token.status === 'WAITING') {
    const idx = waitingTokens.findIndex((t) => t.id === token.id);
    peopleAhead = idx >= 0 ? idx : waitingTokens.length;
    waitCalc = computeDynamicWaitRange({
      effectiveAvgMinutes: predMeta.effectiveAvgServiceMinutes,
      peopleAhead,
      inServiceTokens: inServiceList,
      calledTokens: calledTokensList,
      imminentDeferredCount: 0,
      activeCountersCount: activeCount,
      effectiveCapacity,
      nowMs,
    });
    twoTokensAway = peopleAhead <= 1;
  } else if (token.status === 'CALLED') {
    peopleAhead = 0;
    waitCalc = {
      waitMinMinutes: 0,
      waitMaxMinutes: 5,
      estimatedWaitRange: assignedCtr
        ? `Called · Counter ${assignedCtr.counterNumber}`
        : 'Called · Proceed Now',
    };
    twoTokensAway = true;
  } else if (token.status === 'IN_SERVICE') {
    peopleAhead = 0;
    waitCalc = {
      waitMinMinutes: 0,
      waitMaxMinutes: Math.round(predMeta.effectiveAvgServiceMinutes),
      estimatedWaitRange: assignedCtr
        ? `In Service · Counter ${assignedCtr.counterNumber}`
        : 'In Service',
    };
  } else if (token.status === 'DEFERRED_30M') {
    peopleAhead = waitingTokens.length;
    const minsLeft = token.requeueAfter
      ? Math.max(1, Math.ceil((new Date(token.requeueAfter).getTime() - nowMs) / 60000))
      : 30;
    waitCalc = {
      waitMinMinutes: minsLeft,
      waitMaxMinutes: minsLeft + 8,
      estimatedWaitRange: `Deferred · Re-enters in ~${minsLeft} mins`,
    };
  } else if (token.status === 'GRACE_EXPIRED' || token.status === 'SKIPPED_TIMEOUT') {
    waitCalc.estimatedWaitRange = '5-Min Grace Window Expired';
  } else if (token.status === 'CANCELLED_NO_ANSWER') {
    waitCalc.estimatedWaitRange = 'Cancelled (No Answer)';
  } else if (token.status === 'CANCELLED_BY_USER') {
    waitCalc.estimatedWaitRange = 'Cancelled by Visitor';
  }

  return {
    id: token.id,
    tokenCode: token.tokenCode,
    serviceCode: token.serviceCode,
    serviceName: service.name,
    pin: token.pin,
    fullName: token.fullName,
    maskedName: maskPersonName(token.fullName),
    phone: token.phone,
    email: token.email,
    priorityCategory: token.priorityCategory,
    serviceDetail: token.serviceDetail,
    assistedByName: token.assistedByName,
    isWalkIn: token.isWalkIn,
    status: token.status,
    assignedCounterId: token.assignedCounterId,
    assignedCounterNumber: assignedCtr?.counterNumber ?? null,
    deferralCount: token.deferralCount,
    graceExpiresAt: token.graceExpiresAt,
    requeueAfter: token.requeueAfter,
    targetReadyTime: token.targetReadyTime,
    peopleAhead,
    currentServingToken: activeTokenOnCounter?.tokenCode ?? null,
    activeCountersCount: activeCount,
    effectiveAvgServiceMinutes: predMeta.effectiveAvgServiceMinutes,
    predictionConfidence: predMeta.confidence,
    predictionUpdatedAt: predMeta.updatedAt,
    nextPredictionAt: predMeta.nextUpdateAt,
    waitMinMinutes: waitCalc.waitMinMinutes,
    waitMaxMinutes: waitCalc.waitMaxMinutes,
    estimatedWaitRange: waitCalc.estimatedWaitRange,
    twoTokensAway,
    createdAt: token.createdAt,
    updatedAt: token.updatedAt,
    completedAt: token.completedAt,
  };
}

export function mapTokenForStaff(
  db: QueuelessDatabase,
  token: StoredQueueToken,
  viewerRole: StaffRole,
  viewerServiceCode: ServiceCode | null
): QueueTokenStaff {
  const ctr = token.assignedCounterId
    ? db.counters.find((c) => c.id === token.assignedCounterId) ?? null
    : null;
  const canViewHopdReason =
    token.serviceCode !== 'HOPD' || viewerRole === 'SUPERVISOR' || viewerServiceCode === 'HOPD';

  const callLogs = db.callLogs
    .filter((l) => l.tokenId === token.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return {
    id: token.id,
    tokenCode: token.tokenCode,
    serviceCode: token.serviceCode,
    pin: token.pin,
    fullName: token.fullName,
    phone: token.phone,
    email: token.email,
    priorityCategory: token.priorityCategory,
    priorityWeight: token.priorityWeight,
    serviceDetail: canViewHopdReason ? token.serviceDetail : 'Restricted Clinical Reason',
    serviceDetailRedacted: !canViewHopdReason,
    assistedByName: token.assistedByName,
    isWalkIn: token.isWalkIn,
    status: token.status,
    assignedCounterId: token.assignedCounterId,
    assignedCounterNumber: ctr?.counterNumber ?? null,
    queueOrder: token.queueOrder,
    deferralCount: token.deferralCount,
    graceExpiresAt: token.graceExpiresAt,
    requeueAfter: token.requeueAfter,
    targetReadyTime: token.targetReadyTime,
    calledAt: token.calledAt,
    serviceStartedAt: token.serviceStartedAt,
    completedAt: token.completedAt,
    createdAt: token.createdAt,
    updatedAt: token.updatedAt,
    callLogs,
  };
}
