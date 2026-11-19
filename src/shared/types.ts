export type ServiceCode = 'HOPD' | 'BANK' | 'PASS' | 'LIB';

export type TokenStatus =
  | 'WAITING'
  | 'CALLED'
  | 'IN_SERVICE'
  | 'COMPLETED'
  | 'DEFERRED_30M'
  | 'GRACE_EXPIRED'
  | 'SKIPPED_TIMEOUT'
  | 'CANCELLED_NO_ANSWER'
  | 'CANCELLED_BY_USER';

export type CounterStatus = 'OPEN' | 'BUSY_COMPLEX' | 'PAUSED';

export type StaffRole = 'COUNTER_STAFF' | 'SUPERVISOR';

export type CallOutcome =
  | 'ANSWERED_COMING'
  | 'ANSWERED_DEFER_30M'
  | 'NO_ANSWER_CANCEL';

export interface CounterInfo {
  id: string;
  counterNumber: number;
  serviceCode: ServiceCode;
  label: string;
  status: CounterStatus;
  currentTokenId: string | null;
  currentTokenCode: string | null;
  currentTokenStatus: TokenStatus | null;
  graceExpiresAt: string | null;
}

export interface MaskedQueueEntry {
  id: string;
  tokenCode: string;
  maskedName: string;
  status: TokenStatus;
  priorityCategory: string;
  isWalkIn: boolean;
  position: number;
  requeueAfter: string | null;
}

export type PredictionConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface ServiceSummary {
  code: ServiceCode;
  name: string;
  description: string;
  counterRangeLabel: string;
  avgServiceMinutes: number;
  effectiveAvgServiceMinutes: number;
  predictionConfidence: PredictionConfidence;
  predictionSampleCount: number;
  predictionUpdatedAt: string;
  nextPredictionAt: string;
  peopleAhead: number;
  activeCountersCount: number;
  totalCountersCount: number;
  waitMinMinutes: number;
  waitMaxMinutes: number;
  estimatedWaitRange: string;
  currentServingToken: string | null;
  calledTokens: Array<{
    tokenId: string;
    tokenCode: string;
    counterNumber: number;
    graceExpiresAt: string | null;
    maskedName: string;
  }>;
  counters: CounterInfo[];
  maskedQueue: MaskedQueueEntry[];
  deferredCount: number;
}

export interface QueueTokenPass {
  id: string;
  tokenCode: string;
  serviceCode: ServiceCode;
  serviceName: string;
  pin: string;
  fullName: string;
  maskedName: string;
  phone: string | null;
  email: string | null;
  priorityCategory: string;
  serviceDetail: string;
  assistedByName: string | null;
  isWalkIn: boolean;
  status: TokenStatus;
  assignedCounterId: string | null;
  assignedCounterNumber: number | null;
  deferralCount: number;
  graceExpiresAt: string | null;
  requeueAfter: string | null;
  targetReadyTime: string | null;
  peopleAhead: number;
  currentServingToken: string | null;
  activeCountersCount: number;
  effectiveAvgServiceMinutes: number;
  predictionConfidence: PredictionConfidence;
  predictionUpdatedAt: string;
  nextPredictionAt: string;
  waitMinMinutes: number;
  waitMaxMinutes: number;
  estimatedWaitRange: string;
  twoTokensAway: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface CallLogEntry {
  id: string;
  tokenId: string;
  tokenCode: string;
  staffId: string;
  staffName: string;
  outcome: CallOutcome;
  notes: string | null;
  createdAt: string;
}

export interface QueueTokenStaff {
  id: string;
  tokenCode: string;
  serviceCode: ServiceCode;
  pin: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  priorityCategory: string;
  priorityWeight: number;
  serviceDetail: string;
  serviceDetailRedacted: boolean;
  assistedByName: string | null;
  isWalkIn: boolean;
  status: TokenStatus;
  assignedCounterId: string | null;
  assignedCounterNumber: number | null;
  queueOrder: number;
  deferralCount: number;
  graceExpiresAt: string | null;
  requeueAfter: string | null;
  targetReadyTime: string | null;
  calledAt: string | null;
  serviceStartedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  callLogs: CallLogEntry[];
}

export interface EmergencyAlert {
  id: string;
  serviceCode: ServiceCode;
  location: string;
  description: string;
  reporterName: string | null;
  contactPhone: string | null;
  status: 'ACTIVE' | 'ACKNOWLEDGED' | 'RESOLVED';
  resolvedBy: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface StaffUserPublic {
  id: string;
  staffCode: string;
  email: string;
  fullName: string;
  role: StaffRole;
  assignedServiceCode: ServiceCode | null;
}

export interface ServiceMetricEvent {
  id: string;
  serviceCode: ServiceCode;
  eventType: string;
  tokenCode: string | null;
  counterId: string | null;
  waitSeconds: number | null;
  createdAt: string;
}

export interface StaffDashboardPayload {
  staff: StaffUserPublic;
  services: ServiceSummary[];
  tokensByService: Record<ServiceCode, QueueTokenStaff[]>;
  emergencies: EmergencyAlert[];
  recentMetrics: ServiceMetricEvent[];
  serverTime: string;
}
