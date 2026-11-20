import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import express from 'express';
import type { Request, Response } from 'express';
import type {
  CallOutcome,
  CounterStatus,
  ServiceCode,
  StaffDashboardPayload,
} from './src/shared/types.ts';
import {
  requireStaffAuth,
  signStaffJwt,
  verifyPassword,
  type StaffAuthRequest,
} from './src/server/auth.ts';
import {
  buildTokenPass,
  computeAllServices,
  getOrderedWaitingTokens,
  getPredictionTimestamps,
  mapTokenForStaff,
  refreshPredictionSnapshot,
} from './src/server/engine.ts';
import { withQueueLock } from './src/server/mutex.ts';
import {
  generatePin,
  getDb,
  getPriorityWeight,
  persistDb,
  type StoredQueueToken,
} from './src/server/store.ts';
import { startBackgroundWorker } from './src/server/worker.ts';

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';

// Rate limiting state: IP -> timestamps[]
const tokenCreateRateMap = new Map<string, number[]>();
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX_REQUESTS = 10;

function checkTokenCreateRateLimit(ip: string): boolean {
  const now = Date.now();
  const prev = tokenCreateRateMap.get(ip) ?? [];
  const recent = prev.filter((ts) => now - ts < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX_REQUESTS) {
    tokenCreateRateMap.set(ip, recent);
    return false;
  }
  recent.push(now);
  tokenCreateRateMap.set(ip, recent);
  return true;
}

// SSE Subscribers
const sseClients = new Set<Response>();

function broadcastEvent(event: string, payload: unknown): void {
  const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(data);
    } catch {
      sseClients.delete(res);
    }
  }
}

function broadcastQueueUpdate(reason: string, serviceCode?: ServiceCode): void {
  const db = getDb();
  refreshPredictionSnapshot(db);
  const { predictionUpdatedAt, nextPredictionAt } = getPredictionTimestamps();
  const payload = {
    reason,
    serviceCode: serviceCode ?? null,
    services: computeAllServices(db),
    predictionUpdatedAt,
    nextPredictionAt,
    refreshIntervalSeconds: 30,
    serverTime: new Date().toISOString(),
  };
  broadcastEvent('queue:updated', payload);
  if (reason === 'prediction:refresh') {
    broadcastEvent('prediction:updated', payload);
  }
}

function promoteNextTokenToCounter(
  db: ReturnType<typeof getDb>,
  counterId: string,
  nowIso: string
): StoredQueueToken | null {
  const ctr = db.counters.find((c) => c.id === counterId);
  if (!ctr || ctr.status === 'PAUSED' || ctr.currentTokenId) return null;

  const waiting = getOrderedWaitingTokens(db, ctr.serviceCode);
  const nextTok = waiting[0];
  if (!nextTok) return null;

  nextTok.status = 'CALLED';
  nextTok.assignedCounterId = ctr.id;
  nextTok.calledAt = nowIso;
  nextTok.graceExpiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  nextTok.updatedAt = nowIso;

  ctr.currentTokenId = nextTok.id;
  ctr.updatedAt = nowIso;

  db.metrics.unshift({
    id: crypto.randomUUID(),
    serviceCode: ctr.serviceCode,
    eventType: 'TOKEN_CALLED',
    tokenCode: nextTok.tokenCode,
    counterId: ctr.id,
    waitSeconds: Math.round((Date.now() - new Date(nextTok.createdAt).getTime()) / 1000),
    createdAt: nowIso,
  });

  return nextTok;
}

async function createTokenInternal(params: {
  serviceCode: ServiceCode;
  fullName: string;
  phone: string | null;
  email: string | null;
  priorityCategory: string;
  serviceDetail: string;
  assistedByName: string | null;
  isWalkIn: boolean;
  citizenUid: string | null;
}) {
  return withQueueLock(`service:${params.serviceCode}`, () => {
    const db = getDb();
    const service = db.services.find((s) => s.code === params.serviceCode);
    if (!service) {
      throw new Error('Unknown service code.');
    }

    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    service.tokenSequence += 1;

    const priorityWeight = getPriorityWeight(params.priorityCategory);
    const priorityOffsetMs = priorityWeight * 6 * 60 * 1000;

    const newToken: StoredQueueToken = {
      id: `tok-${params.serviceCode.toLowerCase()}-${service.tokenSequence}-${crypto.randomBytes(2).toString('hex')}`,
      tokenCode: `${params.serviceCode}-${service.tokenSequence}`,
      serviceCode: params.serviceCode,
      pin: generatePin(),
      citizenUid: params.citizenUid,
      fullName: params.fullName.trim(),
      phone: params.phone?.trim() || null,
      email: params.email?.trim() || null,
      priorityCategory: params.priorityCategory || 'Standard',
      priorityWeight,
      serviceDetail: params.serviceDetail.trim(),
      assistedByName: params.assistedByName?.trim() || null,
      isWalkIn: params.isWalkIn,
      status: 'WAITING',
      assignedCounterId: null,
      queueOrder: now - priorityOffsetMs,
      deferralCount: 0,
      graceExpiresAt: null,
      requeueAfter: null,
      targetReadyTime: null,
      calledAt: null,
      serviceStartedAt: null,
      completedAt: null,
      piiAnonymizedAt: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    db.tokens.push(newToken);
    db.metrics.unshift({
      id: crypto.randomUUID(),
      serviceCode: params.serviceCode,
      eventType: params.isWalkIn ? 'WALK_IN_ISSUED' : 'TOKEN_JOINED',
      tokenCode: newToken.tokenCode,
      counterId: null,
      waitSeconds: null,
      createdAt: nowIso,
    });
    persistDb();

    const pass = buildTokenPass(db, newToken);
    broadcastQueueUpdate('token:created', params.serviceCode);
    return pass;
  });
}

async function bootstrap() {
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  // Health Check
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true, serverTime: new Date().toISOString() });
  });

  // SSE Live Real-Time Broadcaster
  app.get('/api/events', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const db = getDb();
    const { predictionUpdatedAt, nextPredictionAt } = getPredictionTimestamps();
    res.write(
      `event: snapshot\ndata: ${JSON.stringify({
        services: computeAllServices(db),
        predictionUpdatedAt,
        nextPredictionAt,
        refreshIntervalSeconds: 30,
        serverTime: new Date().toISOString(),
      })}\n\n`
    );

    sseClients.add(res);

    const heartbeat = setInterval(() => {
      try {
        res.write(`: heartbeat ${Date.now()}\n\n`);
      } catch {
        clearInterval(heartbeat);
        sseClients.delete(res);
      }
    }, 20_000);

    req.on('close', () => {
      clearInterval(heartbeat);
      sseClients.delete(res);
    });
  });

  // Unified Service Metrics, Predictions & Live Token Pass Endpoint
  app.get('/api/services', (req: Request, res: Response) => {
    const db = getDb();
    const tokenId = typeof req.query.tokenId === 'string' ? req.query.tokenId.trim() : '';
    const token = tokenId
      ? db.tokens.find(
          (t) => t.id === tokenId || t.tokenCode.toUpperCase() === tokenId.toUpperCase()
        )
      : undefined;
    const { predictionUpdatedAt, nextPredictionAt } = getPredictionTimestamps();

    res.json({
      services: computeAllServices(db),
      activePass: token ? buildTokenPass(db, token) : null,
      predictionUpdatedAt,
      nextPredictionAt,
      refreshIntervalSeconds: 30,
      serverTime: new Date().toISOString(),
    });
  });

  // Track My Token Lookup (by Token Code like HOPD-104 or Phone Number)
  app.get('/api/tokens/lookup', (req: Request, res: Response) => {
    const rawQuery = String(req.query.query || '').trim();
    if (!rawQuery) {
      res.status(400).json({ error: 'Please enter a Token ID or phone number.' });
      return;
    }

    const db = getDb();
    const upper = rawQuery.toUpperCase();
    const digitsOnly = rawQuery.replace(/\D/g, '');

    const matches = db.tokens.filter((t) => {
      if (t.tokenCode.toUpperCase() === upper || t.id.toUpperCase() === upper) {
        return true;
      }
      if (digitsOnly.length >= 6 && t.phone) {
        const tokDigits = t.phone.replace(/\D/g, '');
        return tokDigits.endsWith(digitsOnly) || tokDigits === digitsOnly;
      }
      return false;
    });

    if (matches.length === 0) {
      res.status(404).json({ error: 'No matching token found. Verify your Token ID or phone number.' });
      return;
    }

    // Return latest match first
    const sorted = [...matches].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json({
      passes: sorted.map((tok) => buildTokenPass(db, tok)),
      serverTime: new Date().toISOString(),
    });
  });

  // Live Token Pass Fetch
  app.get('/api/tokens/:id', (req: Request, res: Response) => {
    const db = getDb();
    const token = db.tokens.find((t) => t.id === req.params.id || t.tokenCode.toUpperCase() === String(req.params.id).toUpperCase());
    if (!token) {
      res.status(404).json({ error: 'Token not found.' });
      return;
    }
    res.json({
      pass: buildTokenPass(db, token),
      serverTime: new Date().toISOString(),
    });
  });

  // Public Join Queue (Rate-limited + Domain-validated + Atomic)
  app.post('/api/tokens', async (req: Request, res: Response) => {
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    if (!checkTokenCreateRateLimit(clientIp)) {
      res.status(429).json({
        error: 'Too many queue requests from this device. Please wait a few minutes before joining again.',
      });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const serviceCode = String(body.serviceCode || '').toUpperCase() as ServiceCode;
    const fullName = String(body.fullName || '').trim();
    const phone = body.phone ? String(body.phone).trim() : null;
    const email = body.email ? String(body.email).trim() : null;
    const priorityCategory = String(body.priorityCategory || 'Standard').trim();
    const serviceDetail = String(body.serviceDetail || '').trim();
    const assistedByName = body.assistedByName ? String(body.assistedByName).trim() : null;
    const citizenUid = body.citizenUid ? String(body.citizenUid).trim() : null;
    const isWalkIn = Boolean(body.isWalkIn);

    if (!['HOPD', 'BANK', 'PASS', 'LIB'].includes(serviceCode)) {
      res.status(400).json({ error: 'Invalid service desk selected.' });
      return;
    }
    if (fullName.length < 2 || fullName.length > 100) {
      res.status(400).json({ error: 'Please provide a valid name or identifier (2–100 characters).' });
      return;
    }
    if ((serviceCode === 'HOPD' || serviceCode === 'PASS') && (!phone || phone.replace(/\D/g, '').length < 7)) {
      res.status(400).json({ error: 'Phone number is required for call and SMS verification at this desk.' });
      return;
    }
    if (serviceCode === 'BANK' && !isWalkIn && (!phone || phone.replace(/\D/g, '').length < 7)) {
      res.status(400).json({ error: 'Phone number is required for virtual Bank Counter verification.' });
      return;
    }
    if (!serviceDetail) {
      res.status(400).json({ error: 'Please select a visit reason or service task.' });
      return;
    }

    try {
      const pass = await createTokenInternal({
        serviceCode,
        fullName,
        phone,
        email,
        priorityCategory,
        serviceDetail,
        assistedByName,
        isWalkIn,
        citizenUid,
      });
      res.status(201).json({ pass, serverTime: new Date().toISOString() });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unable to issue token.' });
    }
  });

  // Self-Service +30 Mins Defer (Atomic, 1-Deferral Cap)
  app.post('/api/tokens/:id/defer', async (req: Request, res: Response) => {
    const { pin } = req.body as { pin?: string };
    const tokenLookupId = String(req.params.id);

    const dbSnap = getDb();
    const found = dbSnap.tokens.find((t) => t.id === tokenLookupId);
    if (!found) {
      res.status(404).json({ error: 'Token not found.' });
      return;
    }

    const result = await withQueueLock(`service:${found.serviceCode}`, () => {
      const db = getDb();
      const token = db.tokens.find((t) => t.id === tokenLookupId);
      if (!token) return { status: 404, error: 'Token not found.' } as const;
      if (pin && token.pin !== String(pin).trim()) {
        return { status: 403, error: 'Invalid 4-digit verification PIN.' } as const;
      }
      if (token.deferralCount >= 1) {
        return { status: 409, error: 'Deferral limit reached (maximum 1 deferral per token).' } as const;
      }
      if (!['WAITING', 'CALLED', 'GRACE_EXPIRED'].includes(token.status)) {
        return { status: 400, error: `Cannot defer a token in state ${token.status}.` } as const;
      }

      const now = Date.now();
      const nowIso = new Date(now).toISOString();
      const targetMs = now + 30 * 60 * 1000;
      const targetIso = new Date(targetMs).toISOString();

      if (token.assignedCounterId) {
        const ctr = db.counters.find((c) => c.id === token.assignedCounterId);
        if (ctr && ctr.currentTokenId === token.id) {
          ctr.currentTokenId = null;
          ctr.updatedAt = nowIso;
        }
      }

      token.status = 'DEFERRED_30M';
      token.deferralCount += 1;
      token.requeueAfter = targetIso;
      token.targetReadyTime = targetIso;
      token.assignedCounterId = null;
      token.graceExpiresAt = null;
      token.updatedAt = nowIso;

      db.metrics.unshift({
        id: crypto.randomUUID(),
        serviceCode: token.serviceCode,
        eventType: 'USER_DEFERRED_30M',
        tokenCode: token.tokenCode,
        counterId: null,
        waitSeconds: null,
        createdAt: nowIso,
      });

      persistDb();
      return { status: 200, pass: buildTokenPass(db, token), serviceCode: token.serviceCode } as const;
    });

    if ('error' in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }

    broadcastQueueUpdate('token:deferred', result.serviceCode);
    res.json({ pass: result.pass, serverTime: new Date().toISOString() });
  });

  // Self-Service Cancel Token
  app.post('/api/tokens/:id/cancel', async (req: Request, res: Response) => {
    const { pin } = (req.body || {}) as { pin?: string };
    const tokenLookupId = String(req.params.id);

    const dbSnap = getDb();
    const found = dbSnap.tokens.find((t) => t.id === tokenLookupId);
    if (!found) {
      res.status(404).json({ error: 'Token not found.' });
      return;
    }

    const result = await withQueueLock(`service:${found.serviceCode}`, () => {
      const db = getDb();
      const token = db.tokens.find((t) => t.id === tokenLookupId);
      if (!token) return { status: 404, error: 'Token not found.' } as const;
      if (pin && token.pin !== String(pin).trim()) {
        return { status: 403, error: 'Invalid 4-digit verification PIN.' } as const;
      }
      if (['COMPLETED', 'CANCELLED_BY_USER', 'CANCELLED_NO_ANSWER'].includes(token.status)) {
        return { status: 400, error: 'Token is already closed.' } as const;
      }

      const nowIso = new Date().toISOString();
      if (token.assignedCounterId) {
        const ctr = db.counters.find((c) => c.id === token.assignedCounterId);
        if (ctr && ctr.currentTokenId === token.id) {
          ctr.currentTokenId = null;
          ctr.updatedAt = nowIso;
        }
      }

      token.status = 'CANCELLED_BY_USER';
      token.assignedCounterId = null;
      token.graceExpiresAt = null;
      token.completedAt = nowIso;
      token.updatedAt = nowIso;

      db.metrics.unshift({
        id: crypto.randomUUID(),
        serviceCode: token.serviceCode,
        eventType: 'USER_CANCELLED',
        tokenCode: token.tokenCode,
        counterId: null,
        waitSeconds: null,
        createdAt: nowIso,
      });

      persistDb();
      return { status: 200, pass: buildTokenPass(db, token), serviceCode: token.serviceCode } as const;
    });

    if ('error' in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }

    broadcastQueueUpdate('token:cancelled', result.serviceCode);
    res.json({ pass: result.pass, serverTime: new Date().toISOString() });
  });

  // Safe Emergency SOS Escalation (Strictly separate from regular queue tokens)
  app.post('/api/emergency', async (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const location = String(body.location || '').trim();
    const description = String(body.description || '').trim();
    const reporterName = body.reporterName ? String(body.reporterName).trim() : null;
    const contactPhone = body.contactPhone ? String(body.contactPhone).trim() : null;

    if (location.length < 2 || description.length < 3) {
      res.status(400).json({ error: 'Please specify the location and brief emergency description.' });
      return;
    }

    const alert = await withQueueLock('emergencies', () => {
      const db = getDb();
      const newAlert = {
        id: `sos-${crypto.randomUUID().slice(0, 8)}`,
        serviceCode: 'HOPD' as const,
        location: location.slice(0, 160),
        description: description.slice(0, 400),
        reporterName: reporterName?.slice(0, 100) || null,
        contactPhone: contactPhone?.slice(0, 24) || null,
        status: 'ACTIVE' as const,
        resolvedBy: null,
        createdAt: new Date().toISOString(),
        resolvedAt: null,
      };
      db.emergencies.unshift(newAlert);
      persistDb();
      return newAlert;
    });

    broadcastEvent('emergency:alert', alert);
    res.status(201).json({ alert });
  });

  // ============================================================================
  // STAFF AUTHENTICATION & PROTECTED COUNTER OPERATIONS
  // ============================================================================

  app.post('/api/staff/login', (req: Request, res: Response) => {
    const { identifier, password } = req.body as { identifier?: string; password?: string };
    const idNorm = String(identifier || '').trim().toLowerCase();
    const pwd = String(password || '');

    if (!idNorm || !pwd) {
      res.status(400).json({ error: 'Staff ID/Email and password are required.' });
      return;
    }

    const db = getDb();
    const user = db.staffUsers.find(
      (u) => u.email.toLowerCase() === idNorm || u.staffCode.toLowerCase() === idNorm
    );

    if (!user || !verifyPassword(pwd, user.passwordHash)) {
      res.status(401).json({ error: 'Invalid staff credentials.' });
      return;
    }

    const publicUser = {
      id: user.id,
      staffCode: user.staffCode,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      assignedServiceCode: user.assignedServiceCode,
    };

    const token = signStaffJwt(publicUser);
    res.json({ token, staff: publicUser });
  });

  app.get('/api/staff/me', requireStaffAuth, (req: StaffAuthRequest, res: Response) => {
    const s = req.staff!;
    res.json({
      staff: {
        id: s.sub,
        staffCode: s.staffCode,
        email: s.email,
        fullName: s.fullName,
        role: s.role,
        assignedServiceCode: s.assignedServiceCode,
      },
    });
  });

  app.get('/api/staff/dashboard', requireStaffAuth, (req: StaffAuthRequest, res: Response) => {
    const s = req.staff!;
    const db = getDb();

    const allowedServices: ServiceCode[] =
      s.role === 'SUPERVISOR'
        ? ['HOPD', 'BANK', 'PASS', 'LIB']
        : s.assignedServiceCode
        ? [s.assignedServiceCode]
        : [];

    const allSummaries = computeAllServices(db);
    const services = allSummaries.filter((svc) => allowedServices.includes(svc.code));

    const tokensByService: Record<ServiceCode, ReturnType<typeof mapTokenForStaff>[]> = {
      HOPD: [],
      BANK: [],
      PASS: [],
      LIB: [],
    };

    for (const code of allowedServices) {
      tokensByService[code] = db.tokens
        .filter((t) => t.serviceCode === code)
        .sort((a, b) => {
          const activeOrder = (status: string) =>
            status === 'IN_SERVICE' ? 0 : status === 'CALLED' ? 1 : status === 'WAITING' ? 2 : status === 'DEFERRED_30M' ? 3 : status === 'GRACE_EXPIRED' ? 4 : 5;
          const diff = activeOrder(a.status) - activeOrder(b.status);
          if (diff !== 0) return diff;
          if (a.status === 'WAITING' && b.status === 'WAITING') {
            return a.queueOrder - b.queueOrder;
          }
          return b.updatedAt.localeCompare(a.updatedAt);
        })
        .slice(0, 60)
        .map((tok) => mapTokenForStaff(db, tok, s.role, s.assignedServiceCode));
    }

    const emergencies =
      s.role === 'SUPERVISOR' || s.assignedServiceCode === 'HOPD' ? db.emergencies : [];

    const payload: StaffDashboardPayload = {
      staff: {
        id: s.sub,
        staffCode: s.staffCode,
        email: s.email,
        fullName: s.fullName,
        role: s.role,
        assignedServiceCode: s.assignedServiceCode,
      },
      services,
      tokensByService,
      emergencies,
      recentMetrics: db.metrics.filter((m) => allowedServices.includes(m.serviceCode)).slice(0, 20),
      serverTime: new Date().toISOString(),
    };

    res.json(payload);
  });

  // Counter Status Toggle (OPEN | BUSY_COMPLEX | PAUSED)
  app.post('/api/staff/counters/:counterId/status', requireStaffAuth, async (req: StaffAuthRequest, res: Response) => {
    const s = req.staff!;
    const { status } = req.body as { status?: CounterStatus };
    const counterId = String(req.params.counterId);

    if (!status || !['OPEN', 'BUSY_COMPLEX', 'PAUSED'].includes(status)) {
      res.status(400).json({ error: 'Invalid counter status.' });
      return;
    }

    const dbSnap = getDb();
    const ctrCheck = dbSnap.counters.find((c) => c.id === counterId);
    if (!ctrCheck) {
      res.status(404).json({ error: 'Counter not found.' });
      return;
    }
    if (s.role !== 'SUPERVISOR' && s.assignedServiceCode !== ctrCheck.serviceCode) {
      res.status(403).json({ error: 'You are not assigned to this service desk.' });
      return;
    }

    const updated = await withQueueLock(`service:${ctrCheck.serviceCode}`, () => {
      const db = getDb();
      const ctr = db.counters.find((c) => c.id === counterId)!;
      ctr.status = status;
      ctr.updatedAt = new Date().toISOString();
      persistDb();
      return ctr;
    });

    broadcastQueueUpdate('counter:status', updated.serviceCode);
    res.json({ counter: updated });
  });

  // Atomic Call Next Token onto Counter -> Starts 5-Minute Grace Countdown
  app.post('/api/staff/counters/:counterId/call-next', requireStaffAuth, async (req: StaffAuthRequest, res: Response) => {
    const s = req.staff!;
    const counterId = String(req.params.counterId);
    const dbSnap = getDb();
    const ctrCheck = dbSnap.counters.find((c) => c.id === counterId);

    if (!ctrCheck) {
      res.status(404).json({ error: 'Counter not found.' });
      return;
    }
    if (s.role !== 'SUPERVISOR' && s.assignedServiceCode !== ctrCheck.serviceCode) {
      res.status(403).json({ error: 'You are not assigned to this counter.' });
      return;
    }

    const result = await withQueueLock(`service:${ctrCheck.serviceCode}`, () => {
      const db = getDb();
      const ctr = db.counters.find((c) => c.id === counterId)!;
      if (ctr.status === 'PAUSED') {
        return { status: 409, error: 'Counter is Paused. Switch to Open before calling a token.' } as const;
      }
      if (ctr.currentTokenId) {
        const cur = db.tokens.find((t) => t.id === ctr.currentTokenId);
        if (cur && (cur.status === 'CALLED' || cur.status === 'IN_SERVICE')) {
          return {
            status: 409,
            error: `Counter ${ctr.counterNumber} is currently handling ${cur.tokenCode}. Complete or resolve it first.`,
          } as const;
        }
        ctr.currentTokenId = null;
      }

      const nowIso = new Date().toISOString();
      const nextTok = promoteNextTokenToCounter(db, ctr.id, nowIso);
      if (!nextTok) {
        return { status: 404, error: 'No waiting tokens in this queue.' } as const;
      }
      persistDb();
      return {
        status: 200,
        token: mapTokenForStaff(db, nextTok, s.role, s.assignedServiceCode),
        serviceCode: ctr.serviceCode,
      } as const;
    });

    if ('error' in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }

    broadcastQueueUpdate('token:called', result.serviceCode);
    res.json({ token: result.token });
  });

  // Call Specific Token onto Counter
  app.post('/api/staff/tokens/:id/call', requireStaffAuth, async (req: StaffAuthRequest, res: Response) => {
    const s = req.staff!;
    const tokenId = String(req.params.id);
    const { counterId } = req.body as { counterId?: string };

    const dbSnap = getDb();
    const tokCheck = dbSnap.tokens.find((t) => t.id === tokenId);
    if (!tokCheck) {
      res.status(404).json({ error: 'Token not found.' });
      return;
    }
    if (s.role !== 'SUPERVISOR' && s.assignedServiceCode !== tokCheck.serviceCode) {
      res.status(403).json({ error: 'You are not authorized for this service desk.' });
      return;
    }

    const result = await withQueueLock(`service:${tokCheck.serviceCode}`, () => {
      const db = getDb();
      const tok = db.tokens.find((t) => t.id === tokenId)!;
      if (!['WAITING', 'GRACE_EXPIRED'].includes(tok.status)) {
        return { status: 409, error: `Token ${tok.tokenCode} cannot be called from status ${tok.status}.` } as const;
      }

      const ctr = counterId
        ? db.counters.find((c) => c.id === counterId && c.serviceCode === tok.serviceCode)
        : db.counters.find((c) => c.serviceCode === tok.serviceCode && c.status !== 'PAUSED' && !c.currentTokenId);

      if (!ctr) {
        return { status: 409, error: 'No free open counter available for this service.' } as const;
      }
      if (ctr.status === 'PAUSED') {
        return { status: 409, error: 'Target counter is paused.' } as const;
      }
      if (ctr.currentTokenId) {
        return { status: 409, error: `Counter ${ctr.counterNumber} is occupied.` } as const;
      }

      const nowIso = new Date().toISOString();
      tok.status = 'CALLED';
      tok.assignedCounterId = ctr.id;
      tok.calledAt = nowIso;
      tok.graceExpiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      tok.updatedAt = nowIso;

      ctr.currentTokenId = tok.id;
      ctr.updatedAt = nowIso;

      persistDb();
      return {
        status: 200,
        token: mapTokenForStaff(db, tok, s.role, s.assignedServiceCode),
        serviceCode: tok.serviceCode,
      } as const;
    });

    if ('error' in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }

    broadcastQueueUpdate('token:called', result.serviceCode);
    res.json({ token: result.token });
  });

  // Check In & Start Service (Verifies 4-digit PIN unless walk-in bypass confirmed)
  app.post('/api/staff/tokens/:id/check-in', requireStaffAuth, async (req: StaffAuthRequest, res: Response) => {
    const s = req.staff!;
    const tokenId = String(req.params.id);
    const { pin, skipPinForWalkIn } = req.body as { pin?: string; skipPinForWalkIn?: boolean };

    const dbSnap = getDb();
    const tokCheck = dbSnap.tokens.find((t) => t.id === tokenId);
    if (!tokCheck) {
      res.status(404).json({ error: 'Token not found.' });
      return;
    }
    if (s.role !== 'SUPERVISOR' && s.assignedServiceCode !== tokCheck.serviceCode) {
      res.status(403).json({ error: 'Access denied for this service desk.' });
      return;
    }

    const result = await withQueueLock(`service:${tokCheck.serviceCode}`, () => {
      const db = getDb();
      const tok = db.tokens.find((t) => t.id === tokenId)!;
      if (tok.status !== 'CALLED') {
        return { status: 409, error: 'Token must be in CALLED state before check-in.' } as const;
      }
      if (!(tok.isWalkIn && skipPinForWalkIn) && String(pin || '').trim() !== tok.pin) {
        return { status: 403, error: '4-digit verification PIN does not match.' } as const;
      }

      const nowIso = new Date().toISOString();
      tok.status = 'IN_SERVICE';
      tok.serviceStartedAt = nowIso;
      tok.graceExpiresAt = null;
      tok.updatedAt = nowIso;

      persistDb();
      return {
        status: 200,
        token: mapTokenForStaff(db, tok, s.role, s.assignedServiceCode),
        serviceCode: tok.serviceCode,
      } as const;
    });

    if ('error' in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }

    broadcastQueueUpdate('token:in_service', result.serviceCode);
    res.json({ token: result.token });
  });

  // Complete Service & Free Counter
  app.post('/api/staff/tokens/:id/complete', requireStaffAuth, async (req: StaffAuthRequest, res: Response) => {
    const s = req.staff!;
    const tokenId = String(req.params.id);

    const dbSnap = getDb();
    const tokCheck = dbSnap.tokens.find((t) => t.id === tokenId);
    if (!tokCheck) {
      res.status(404).json({ error: 'Token not found.' });
      return;
    }
    if (s.role !== 'SUPERVISOR' && s.assignedServiceCode !== tokCheck.serviceCode) {
      res.status(403).json({ error: 'Access denied for this service desk.' });
      return;
    }

    const result = await withQueueLock(`service:${tokCheck.serviceCode}`, () => {
      const db = getDb();
      const tok = db.tokens.find((t) => t.id === tokenId)!;
      if (tok.status !== 'IN_SERVICE') {
        return { status: 409, error: 'Token must be IN_SERVICE to complete.' } as const;
      }

      const nowIso = new Date().toISOString();
      if (tok.assignedCounterId) {
        const ctr = db.counters.find((c) => c.id === tok.assignedCounterId);
        if (ctr && ctr.currentTokenId === tok.id) {
          ctr.currentTokenId = null;
          ctr.updatedAt = nowIso;
        }
      }

      tok.status = 'COMPLETED';
      tok.completedAt = nowIso;
      tok.updatedAt = nowIso;

      db.metrics.unshift({
        id: crypto.randomUUID(),
        serviceCode: tok.serviceCode,
        eventType: 'SERVICE_COMPLETED',
        tokenCode: tok.tokenCode,
        counterId: tok.assignedCounterId,
        waitSeconds: tok.serviceStartedAt
          ? Math.round((new Date(tok.serviceStartedAt).getTime() - new Date(tok.createdAt).getTime()) / 1000)
          : null,
        createdAt: nowIso,
      });

      refreshPredictionSnapshot(db);
      persistDb();
      return {
        status: 200,
        token: mapTokenForStaff(db, tok, s.role, s.assignedServiceCode),
        serviceCode: tok.serviceCode,
      } as const;
    });

    if ('error' in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }

    broadcastQueueUpdate('token:completed', result.serviceCode);
    res.json({ token: result.token });
  });

  // Staff Call Verification & Outcome Logging (3 explicit outcomes)
  app.post('/api/staff/tokens/:id/call-outcome', requireStaffAuth, async (req: StaffAuthRequest, res: Response) => {
    const s = req.staff!;
    const tokenId = String(req.params.id);
    const { outcome, notes } = req.body as { outcome?: CallOutcome; notes?: string };

    if (!outcome || !['ANSWERED_COMING', 'ANSWERED_DEFER_30M', 'NO_ANSWER_CANCEL'].includes(outcome)) {
      res.status(400).json({ error: 'Invalid call verification outcome.' });
      return;
    }

    const dbSnap = getDb();
    const tokCheck = dbSnap.tokens.find((t) => t.id === tokenId);
    if (!tokCheck) {
      res.status(404).json({ error: 'Token not found.' });
      return;
    }
    if (s.role !== 'SUPERVISOR' && s.assignedServiceCode !== tokCheck.serviceCode) {
      res.status(403).json({ error: 'Access denied for this service desk.' });
      return;
    }

    const result = await withQueueLock(`service:${tokCheck.serviceCode}`, () => {
      const db = getDb();
      const tok = db.tokens.find((t) => t.id === tokenId)!;
      if (['COMPLETED', 'CANCELLED_BY_USER', 'CANCELLED_NO_ANSWER'].includes(tok.status)) {
        return { status: 409, error: 'Token is already in a terminal state.' } as const;
      }

      const now = Date.now();
      const nowIso = new Date(now).toISOString();
      const freedCounterId = tok.assignedCounterId;

      db.callLogs.unshift({
        id: crypto.randomUUID(),
        tokenId: tok.id,
        tokenCode: tok.tokenCode,
        staffId: s.sub,
        staffName: s.fullName,
        outcome,
        notes: notes ? String(notes).trim().slice(0, 200) : null,
        createdAt: nowIso,
      });

      let autoAdvancedToken: ReturnType<typeof mapTokenForStaff> | null = null;

      if (outcome === 'ANSWERED_COMING') {
        // Keeps the active 5-minute grace window running
        if (tok.status === 'GRACE_EXPIRED' && freedCounterId) {
          const ctr = db.counters.find((c) => c.id === freedCounterId);
          if (ctr && !ctr.currentTokenId && ctr.status !== 'PAUSED') {
            tok.status = 'CALLED';
            tok.graceExpiresAt = new Date(now + 5 * 60 * 1000).toISOString();
            ctr.currentTokenId = tok.id;
            ctr.updatedAt = nowIso;
          }
        }
        tok.updatedAt = nowIso;
      } else if (outcome === 'ANSWERED_DEFER_30M') {
        if (tok.deferralCount >= 1) {
          return {
            status: 409,
            error: 'Token already used its 1 allowed 30-minute deferral.',
          } as const;
        }
        const targetIso = new Date(now + 30 * 60 * 1000).toISOString();
        if (freedCounterId) {
          const ctr = db.counters.find((c) => c.id === freedCounterId);
          if (ctr && ctr.currentTokenId === tok.id) {
            ctr.currentTokenId = null;
            ctr.updatedAt = nowIso;
          }
        }
        tok.status = 'DEFERRED_30M';
        tok.deferralCount += 1;
        tok.requeueAfter = targetIso;
        tok.targetReadyTime = targetIso;
        tok.assignedCounterId = null;
        tok.graceExpiresAt = null;
        tok.updatedAt = nowIso;

        if (freedCounterId) {
          const nextTok = promoteNextTokenToCounter(db, freedCounterId, nowIso);
          if (nextTok) {
            autoAdvancedToken = mapTokenForStaff(db, nextTok, s.role, s.assignedServiceCode);
          }
        }
      } else if (outcome === 'NO_ANSWER_CANCEL') {
        if (freedCounterId) {
          const ctr = db.counters.find((c) => c.id === freedCounterId);
          if (ctr && ctr.currentTokenId === tok.id) {
            ctr.currentTokenId = null;
            ctr.updatedAt = nowIso;
          }
        }
        tok.status = 'CANCELLED_NO_ANSWER';
        tok.assignedCounterId = null;
        tok.graceExpiresAt = null;
        tok.completedAt = nowIso;
        tok.updatedAt = nowIso;

        db.metrics.unshift({
          id: crypto.randomUUID(),
          serviceCode: tok.serviceCode,
          eventType: 'CANCELLED_NO_ANSWER',
          tokenCode: tok.tokenCode,
          counterId: freedCounterId,
          waitSeconds: null,
          createdAt: nowIso,
        });

        // Auto-advance to the next waiting person on that counter
        if (freedCounterId) {
          const nextTok = promoteNextTokenToCounter(db, freedCounterId, nowIso);
          if (nextTok) {
            autoAdvancedToken = mapTokenForStaff(db, nextTok, s.role, s.assignedServiceCode);
          }
        }
      }

      persistDb();
      return {
        status: 200,
        token: mapTokenForStaff(db, tok, s.role, s.assignedServiceCode),
        autoAdvancedToken,
        serviceCode: tok.serviceCode,
      } as const;
    });

    if ('error' in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }

    broadcastQueueUpdate(`call:${outcome}`, result.serviceCode);
    res.json({
      token: result.token,
      autoAdvancedToken: result.autoAdvancedToken,
    });
  });

  // 1-Click Walk-In Token Sync (Staff Desk)
  app.post('/api/staff/walk-in', requireStaffAuth, async (req: StaffAuthRequest, res: Response) => {
    const s = req.staff!;
    const body = req.body as Record<string, unknown>;
    const serviceCode = String(body.serviceCode || s.assignedServiceCode || '').toUpperCase() as ServiceCode;
    const fullName = String(body.fullName || 'Walk-In Visitor').trim();
    const priorityCategory = String(body.priorityCategory || 'Standard').trim();
    const serviceDetail = String(body.serviceDetail || 'Walk-In Desk Service').trim();
    const phone = body.phone ? String(body.phone).trim() : null;

    if (!['HOPD', 'BANK', 'PASS', 'LIB'].includes(serviceCode)) {
      res.status(400).json({ error: 'Invalid service desk.' });
      return;
    }
    if (s.role !== 'SUPERVISOR' && s.assignedServiceCode !== serviceCode) {
      res.status(403).json({ error: 'You cannot issue walk-in tokens for another service desk.' });
      return;
    }

    const pass = await createTokenInternal({
      serviceCode,
      fullName,
      phone,
      email: null,
      priorityCategory,
      serviceDetail,
      assistedByName: s.fullName,
      isWalkIn: true,
      citizenUid: null,
    });

    res.status(201).json({ pass });
  });

  // Resolve / Acknowledge Emergency SOS Alert
  app.post('/api/staff/emergencies/:id/resolve', requireStaffAuth, async (req: StaffAuthRequest, res: Response) => {
    const s = req.staff!;
    if (s.role !== 'SUPERVISOR' && s.assignedServiceCode !== 'HOPD') {
      res.status(403).json({ error: 'Only Hospital OPD staff or Supervisors can resolve SOS alerts.' });
      return;
    }

    const alertId = String(req.params.id);
    const nextStatus = (req.body?.status === 'ACKNOWLEDGED' ? 'ACKNOWLEDGED' : 'RESOLVED') as 'ACKNOWLEDGED' | 'RESOLVED';

    const updated = await withQueueLock('emergencies', () => {
      const db = getDb();
      const alert = db.emergencies.find((e) => e.id === alertId);
      if (!alert) return null;
      alert.status = nextStatus;
      alert.resolvedBy = s.fullName;
      if (nextStatus === 'RESOLVED') {
        alert.resolvedAt = new Date().toISOString();
      }
      persistDb();
      return alert;
    });

    if (!updated) {
      res.status(404).json({ error: 'Emergency alert not found.' });
      return;
    }

    broadcastEvent('emergency:updated', updated);
    res.json({ alert: updated });
  });

  // Start 10-second background timer worker
  const stopWorker = startBackgroundWorker((reason, serviceCode) => {
    broadcastQueueUpdate(reason, serviceCode);
  });

  // Vite Middleware (dev) vs Static Serving (prod)
  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (req: Request, res: Response) => {
      if (req.path.startsWith('/api/')) {
        res.status(404).json({ error: 'API route not found.' });
        return;
      }
      const indexPath = path.join(distDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(500).send('Build output missing. Run npm run build first.');
      }
    });
  }

  let activePort = PORT;
  const server = app.listen(PORT, '0.0.0.0');
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE' && activePort < 65535) {
      const previousPort = activePort;
      activePort += 1;
      console.warn(
        `Port ${previousPort} is already in use; trying port ${activePort}.`
      );
      server.listen(activePort, '0.0.0.0');
      return;
    }

    console.error(`Failed to listen on port ${activePort}:`, err);
    stopWorker();
    process.exit(1);
  });
  server.on('listening', () => {
    const address = server.address();
    const listeningPort =
      address && typeof address === 'object' ? address.port : activePort;
    console.log(`Queueless server listening on http://localhost:${listeningPort}`);
  });

  process.on('SIGTERM', () => {
    stopWorker();
    server.close();
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start Queueless server:', err);
  process.exit(1);
});
