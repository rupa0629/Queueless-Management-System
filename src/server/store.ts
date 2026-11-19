import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type {
  CallLogEntry,
  CounterStatus,
  EmergencyAlert,
  ServiceCode,
  ServiceMetricEvent,
  StaffRole,
  TokenStatus,
} from '../shared/types.ts';
import { hashPassword } from './auth.ts';

export interface StoredStaffUser {
  id: string;
  staffCode: string;
  email: string;
  passwordHash: string;
  fullName: string;
  role: StaffRole;
  assignedServiceCode: ServiceCode | null;
}

export interface StoredService {
  code: ServiceCode;
  name: string;
  description: string;
  counterRangeLabel: string;
  avgServiceMinutes: number;
  tokenSequence: number;
}

export interface StoredCounter {
  id: string;
  counterNumber: number;
  serviceCode: ServiceCode;
  label: string;
  status: CounterStatus;
  currentTokenId: string | null;
  updatedAt: string;
}

export interface StoredQueueToken {
  id: string;
  tokenCode: string;
  serviceCode: ServiceCode;
  pin: string;
  citizenUid: string | null;
  fullName: string;
  phone: string | null;
  email: string | null;
  priorityCategory: string;
  priorityWeight: number;
  serviceDetail: string;
  assistedByName: string | null;
  isWalkIn: boolean;
  status: TokenStatus;
  assignedCounterId: string | null;
  queueOrder: number;
  deferralCount: number;
  graceExpiresAt: string | null;
  requeueAfter: string | null;
  targetReadyTime: string | null;
  calledAt: string | null;
  serviceStartedAt: string | null;
  completedAt: string | null;
  piiAnonymizedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QueuelessDatabase {
  services: StoredService[];
  counters: StoredCounter[];
  staffUsers: StoredStaffUser[];
  tokens: StoredQueueToken[];
  callLogs: CallLogEntry[];
  emergencies: EmergencyAlert[];
  metrics: ServiceMetricEvent[];
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'queueless-db.json');

export const DEMO_STAFF_PASSWORD = 'QueueStaff#2026';

function createInitialSeed(): QueuelessDatabase {
  const now = Date.now();
  const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();
  const demoHash = hashPassword(DEMO_STAFF_PASSWORD);

  const staffUsers: StoredStaffUser[] = [
    {
      id: 'staff-hopd-1',
      staffCode: 'STAFF-HOPD-1',
      email: 'opd.staff@queueless.org',
      passwordHash: demoHash,
      fullName: 'Dr. Meera Nair',
      role: 'COUNTER_STAFF',
      assignedServiceCode: 'HOPD',
    },
    {
      id: 'staff-bank-1',
      staffCode: 'STAFF-BANK-1',
      email: 'bank.staff@queueless.org',
      passwordHash: demoHash,
      fullName: 'Rohan Deshmukh',
      role: 'COUNTER_STAFF',
      assignedServiceCode: 'BANK',
    },
    {
      id: 'staff-pass-1',
      staffCode: 'STAFF-PASS-1',
      email: 'pass.staff@queueless.org',
      passwordHash: demoHash,
      fullName: 'Ananya Kulkarni',
      role: 'COUNTER_STAFF',
      assignedServiceCode: 'PASS',
    },
    {
      id: 'staff-lib-1',
      staffCode: 'STAFF-LIB-1',
      email: 'lib.staff@queueless.org',
      passwordHash: demoHash,
      fullName: 'Vikram Sethi',
      role: 'COUNTER_STAFF',
      assignedServiceCode: 'LIB',
    },
    {
      id: 'staff-supv-1',
      staffCode: 'SUPV-ADMIN-1',
      email: 'supervisor@queueless.org',
      passwordHash: demoHash,
      fullName: 'Arjun Mehta',
      role: 'SUPERVISOR',
      assignedServiceCode: null,
    },
  ];

  const services: StoredService[] = [
    {
      code: 'HOPD',
      name: 'Hospital OPD',
      description: 'Outpatient consultations, vitals checkup, lab report review, and prescription renewals.',
      counterRangeLabel: 'Counters 1–3',
      avgServiceMinutes: 8,
      tokenSequence: 105,
    },
    {
      code: 'BANK',
      name: 'Bank Counter',
      description: 'Cash deposit/withdrawal, demand drafts, account KYC updates, and loan inquiries.',
      counterRangeLabel: 'Counters 4–6',
      avgServiceMinutes: 6,
      tokenSequence: 204,
    },
    {
      code: 'PASS',
      name: 'Passport Office',
      description: 'Fresh passport verification, renewal, biometric capture, and document scrutiny.',
      counterRangeLabel: 'Counters 7–8',
      avgServiceMinutes: 10,
      tokenSequence: 303,
    },
    {
      code: 'LIB',
      name: 'Library Desk',
      description: 'Zero-friction book check-out & returns, memberships, and digital archive access.',
      counterRangeLabel: 'Counter 9',
      avgServiceMinutes: 3,
      tokenSequence: 402,
    },
  ];

  const counters: StoredCounter[] = [
    { id: 'ctr-1', counterNumber: 1, serviceCode: 'HOPD', label: 'Counter 1 · General OPD', status: 'OPEN', currentTokenId: 'tok-hopd-101', updatedAt: iso(-120000) },
    { id: 'ctr-2', counterNumber: 2, serviceCode: 'HOPD', label: 'Counter 2 · Vitals & Checkup', status: 'OPEN', currentTokenId: 'tok-hopd-102', updatedAt: iso(-60000) },
    { id: 'ctr-3', counterNumber: 3, serviceCode: 'HOPD', label: 'Counter 3 · Senior Priority', status: 'OPEN', currentTokenId: null, updatedAt: iso(-60000) },
    { id: 'ctr-4', counterNumber: 4, serviceCode: 'BANK', label: 'Counter 4 · Cash & Teller', status: 'OPEN', currentTokenId: 'tok-bank-201', updatedAt: iso(-150000) },
    { id: 'ctr-5', counterNumber: 5, serviceCode: 'BANK', label: 'Counter 5 · KYC & Cheques', status: 'OPEN', currentTokenId: null, updatedAt: iso(-150000) },
    { id: 'ctr-6', counterNumber: 6, serviceCode: 'BANK', label: 'Counter 6 · Loan & Senior', status: 'BUSY_COMPLEX', currentTokenId: null, updatedAt: iso(-90000) },
    { id: 'ctr-7', counterNumber: 7, serviceCode: 'PASS', label: 'Counter 7 · Biometrics', status: 'OPEN', currentTokenId: 'tok-pass-301', updatedAt: iso(-180000) },
    { id: 'ctr-8', counterNumber: 8, serviceCode: 'PASS', label: 'Counter 8 · Tatkaal & Docs', status: 'OPEN', currentTokenId: null, updatedAt: iso(-180000) },
    { id: 'ctr-9', counterNumber: 9, serviceCode: 'LIB', label: 'Counter 9 · Express Desk', status: 'OPEN', currentTokenId: 'tok-lib-401', updatedAt: iso(-45000) },
  ];

  const tokens: StoredQueueToken[] = [
    {
      id: 'tok-hopd-101',
      tokenCode: 'HOPD-101',
      serviceCode: 'HOPD',
      pin: '4821',
      citizenUid: null,
      fullName: 'Aarav Tiwari',
      phone: '+91 98201 44102',
      email: null,
      priorityCategory: 'Standard',
      priorityWeight: 0,
      serviceDetail: 'General Physician Consultation',
      assistedByName: null,
      isWalkIn: false,
      status: 'IN_SERVICE',
      assignedCounterId: 'ctr-1',
      queueOrder: now - 900000,
      deferralCount: 0,
      graceExpiresAt: null,
      requeueAfter: null,
      targetReadyTime: null,
      calledAt: iso(-300000),
      serviceStartedAt: iso(-180000),
      completedAt: null,
      piiAnonymizedAt: null,
      createdAt: iso(-900000),
      updatedAt: iso(-180000),
    },
    {
      id: 'tok-hopd-102',
      tokenCode: 'HOPD-102',
      serviceCode: 'HOPD',
      pin: '3194',
      citizenUid: null,
      fullName: 'Kamala Devi',
      phone: '+91 98201 55210',
      email: null,
      priorityCategory: 'Senior Citizen / Differently Abled',
      priorityWeight: 2,
      serviceDetail: 'Vitals & Checkup',
      assistedByName: 'Suresh Kumar',
      isWalkIn: false,
      status: 'CALLED',
      assignedCounterId: 'ctr-2',
      queueOrder: now - 720000,
      deferralCount: 0,
      graceExpiresAt: iso(240000),
      requeueAfter: null,
      targetReadyTime: null,
      calledAt: iso(-60000),
      serviceStartedAt: null,
      completedAt: null,
      piiAnonymizedAt: null,
      createdAt: iso(-720000),
      updatedAt: iso(-60000),
    },
    {
      id: 'tok-hopd-103',
      tokenCode: 'HOPD-103',
      serviceCode: 'HOPD',
      pin: '7740',
      citizenUid: null,
      fullName: 'Priya Nair',
      phone: '+91 98111 72019',
      email: null,
      priorityCategory: 'Follow-up',
      priorityWeight: 1,
      serviceDetail: 'Lab Report Review',
      assistedByName: null,
      isWalkIn: false,
      status: 'WAITING',
      assignedCounterId: null,
      queueOrder: now - 480000,
      deferralCount: 0,
      graceExpiresAt: null,
      requeueAfter: null,
      targetReadyTime: null,
      calledAt: null,
      serviceStartedAt: null,
      completedAt: null,
      piiAnonymizedAt: null,
      createdAt: iso(-480000),
      updatedAt: iso(-480000),
    },
    {
      id: 'tok-hopd-104',
      tokenCode: 'HOPD-104',
      serviceCode: 'HOPD',
      pin: '6158',
      citizenUid: null,
      fullName: 'Siddharth Rao',
      phone: '+91 99002 18344',
      email: null,
      priorityCategory: 'Standard',
      priorityWeight: 0,
      serviceDetail: 'Prescription Renewal',
      assistedByName: null,
      isWalkIn: false,
      status: 'WAITING',
      assignedCounterId: null,
      queueOrder: now - 300000,
      deferralCount: 0,
      graceExpiresAt: null,
      requeueAfter: null,
      targetReadyTime: null,
      calledAt: null,
      serviceStartedAt: null,
      completedAt: null,
      piiAnonymizedAt: null,
      createdAt: iso(-300000),
      updatedAt: iso(-300000),
    },
    {
      id: 'tok-hopd-105',
      tokenCode: 'HOPD-105',
      serviceCode: 'HOPD',
      pin: '2049',
      citizenUid: null,
      fullName: 'Neha Verma',
      phone: '+91 97412 66189',
      email: null,
      priorityCategory: 'Standard',
      priorityWeight: 0,
      serviceDetail: 'General Physician Consultation',
      assistedByName: null,
      isWalkIn: true,
      status: 'WAITING',
      assignedCounterId: null,
      queueOrder: now - 120000,
      deferralCount: 0,
      graceExpiresAt: null,
      requeueAfter: null,
      targetReadyTime: null,
      calledAt: null,
      serviceStartedAt: null,
      completedAt: null,
      piiAnonymizedAt: null,
      createdAt: iso(-120000),
      updatedAt: iso(-120000),
    },
    {
      id: 'tok-bank-201',
      tokenCode: 'BANK-201',
      serviceCode: 'BANK',
      pin: '5290',
      citizenUid: null,
      fullName: 'Rajesh Malhotra',
      phone: '+91 98104 33190',
      email: null,
      priorityCategory: 'Standard',
      priorityWeight: 0,
      serviceDetail: 'Account / KYC Update',
      assistedByName: null,
      isWalkIn: false,
      status: 'IN_SERVICE',
      assignedCounterId: 'ctr-4',
      queueOrder: now - 600000,
      deferralCount: 0,
      graceExpiresAt: null,
      requeueAfter: null,
      targetReadyTime: null,
      calledAt: iso(-220000),
      serviceStartedAt: iso(-150000),
      completedAt: null,
      piiAnonymizedAt: null,
      createdAt: iso(-600000),
      updatedAt: iso(-150000),
    },
    {
      id: 'tok-bank-202',
      tokenCode: 'BANK-202',
      serviceCode: 'BANK',
      pin: '8831',
      citizenUid: null,
      fullName: 'Sunita Iyer',
      phone: '+91 98450 22911',
      email: null,
      priorityCategory: 'Senior Citizen',
      priorityWeight: 2,
      serviceDetail: 'Demand Draft / Cheque',
      assistedByName: null,
      isWalkIn: false,
      status: 'WAITING',
      assignedCounterId: null,
      queueOrder: now - 420000,
      deferralCount: 0,
      graceExpiresAt: null,
      requeueAfter: null,
      targetReadyTime: null,
      calledAt: null,
      serviceStartedAt: null,
      completedAt: null,
      piiAnonymizedAt: null,
      createdAt: iso(-420000),
      updatedAt: iso(-420000),
    },
    {
      id: 'tok-bank-203',
      tokenCode: 'BANK-203',
      serviceCode: 'BANK',
      pin: '1492',
      citizenUid: null,
      fullName: 'Karan Kapoor',
      phone: '+91 98220 77812',
      email: null,
      priorityCategory: 'Standard',
      priorityWeight: 0,
      serviceDetail: 'Cash Deposit / Withdrawal',
      assistedByName: null,
      isWalkIn: false,
      status: 'WAITING',
      assignedCounterId: null,
      queueOrder: now - 210000,
      deferralCount: 0,
      graceExpiresAt: null,
      requeueAfter: null,
      targetReadyTime: null,
      calledAt: null,
      serviceStartedAt: null,
      completedAt: null,
      piiAnonymizedAt: null,
      createdAt: iso(-210000),
      updatedAt: iso(-210000),
    },
    {
      id: 'tok-pass-301',
      tokenCode: 'PASS-301',
      serviceCode: 'PASS',
      pin: '9043',
      citizenUid: null,
      fullName: 'Divya Sharma',
      phone: '+91 99100 45123',
      email: 'divya.s@example.com',
      priorityCategory: 'Tatkaal / Urgent',
      priorityWeight: 2,
      serviceDetail: 'Biometric Capture',
      assistedByName: null,
      isWalkIn: false,
      status: 'IN_SERVICE',
      assignedCounterId: 'ctr-7',
      queueOrder: now - 800000,
      deferralCount: 0,
      graceExpiresAt: null,
      requeueAfter: null,
      targetReadyTime: null,
      calledAt: iso(-260000),
      serviceStartedAt: iso(-180000),
      completedAt: null,
      piiAnonymizedAt: null,
      createdAt: iso(-800000),
      updatedAt: iso(-180000),
    },
    {
      id: 'tok-pass-302',
      tokenCode: 'PASS-302',
      serviceCode: 'PASS',
      pin: '6672',
      citizenUid: null,
      fullName: 'Manish Joshi',
      phone: '+91 98765 11029',
      email: null,
      priorityCategory: 'Standard',
      priorityWeight: 0,
      serviceDetail: 'Fresh Passport Verification',
      assistedByName: null,
      isWalkIn: false,
      status: 'WAITING',
      assignedCounterId: null,
      queueOrder: now - 360000,
      deferralCount: 0,
      graceExpiresAt: null,
      requeueAfter: null,
      targetReadyTime: null,
      calledAt: null,
      serviceStartedAt: null,
      completedAt: null,
      piiAnonymizedAt: null,
      createdAt: iso(-360000),
      updatedAt: iso(-360000),
    },
    {
      id: 'tok-pass-303',
      tokenCode: 'PASS-303',
      serviceCode: 'PASS',
      pin: '3318',
      citizenUid: null,
      fullName: 'Farah Khan',
      phone: '+91 98332 90841',
      email: null,
      priorityCategory: 'Standard',
      priorityWeight: 0,
      serviceDetail: 'Passport Renewal',
      assistedByName: null,
      isWalkIn: false,
      status: 'WAITING',
      assignedCounterId: null,
      queueOrder: now - 150000,
      deferralCount: 0,
      graceExpiresAt: null,
      requeueAfter: null,
      targetReadyTime: null,
      calledAt: null,
      serviceStartedAt: null,
      completedAt: null,
      piiAnonymizedAt: null,
      createdAt: iso(-150000),
      updatedAt: iso(-150000),
    },
    {
      id: 'tok-lib-401',
      tokenCode: 'LIB-401',
      serviceCode: 'LIB',
      pin: '7105',
      citizenUid: null,
      fullName: 'STU-2026-884',
      phone: null,
      email: null,
      priorityCategory: 'Standard',
      priorityWeight: 0,
      serviceDetail: 'Book Check-Out & Returns',
      assistedByName: null,
      isWalkIn: true,
      status: 'IN_SERVICE',
      assignedCounterId: 'ctr-9',
      queueOrder: now - 200000,
      deferralCount: 0,
      graceExpiresAt: null,
      requeueAfter: null,
      targetReadyTime: null,
      calledAt: iso(-90000),
      serviceStartedAt: iso(-45000),
      completedAt: null,
      piiAnonymizedAt: null,
      createdAt: iso(-200000),
      updatedAt: iso(-45000),
    },
    {
      id: 'tok-lib-402',
      tokenCode: 'LIB-402',
      serviceCode: 'LIB',
      pin: '4490',
      citizenUid: null,
      fullName: 'Riya Sen',
      phone: null,
      email: null,
      priorityCategory: 'Standard',
      priorityWeight: 0,
      serviceDetail: 'Digital Archive Access',
      assistedByName: null,
      isWalkIn: false,
      status: 'WAITING',
      assignedCounterId: null,
      queueOrder: now - 90000,
      deferralCount: 0,
      graceExpiresAt: null,
      requeueAfter: null,
      targetReadyTime: null,
      calledAt: null,
      serviceStartedAt: null,
      completedAt: null,
      piiAnonymizedAt: null,
      createdAt: iso(-90000),
      updatedAt: iso(-90000),
    },
  ];

  return {
    services,
    counters,
    staffUsers,
    tokens,
    callLogs: [],
    emergencies: [],
    metrics: [
      {
        id: crypto.randomUUID(),
        serviceCode: 'HOPD',
        eventType: 'SYSTEM_READY',
        tokenCode: null,
        counterId: null,
        waitSeconds: null,
        createdAt: iso(-120000),
      },
    ],
  };
}

let cachedDb: QueuelessDatabase | null = null;

export function getDb(): QueuelessDatabase {
  if (cachedDb) return cachedDb;
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      cachedDb = JSON.parse(raw) as QueuelessDatabase;
      return cachedDb;
    }
  } catch (err) {
    console.error('Failed to read persisted database, initializing fresh seed:', err);
  }
  cachedDb = createInitialSeed();
  persistDb();
  return cachedDb;
}

export function persistDb(): void {
  if (!cachedDb) return;
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const tmpFile = `${DB_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(cachedDb, null, 2), 'utf8');
    fs.renameSync(tmpFile, DB_FILE);
  } catch (err) {
    console.error('Failed to persist queue state:', err);
  }
}

export function getPriorityWeight(priorityCategory: string): number {
  const norm = priorityCategory.toLowerCase();
  if (norm.includes('senior') || norm.includes('differently') || norm.includes('tatkaal') || norm.includes('urgent')) {
    return 2;
  }
  if (norm.includes('follow')) {
    return 1;
  }
  return 0;
}

export function generatePin(): string {
  return String(crypto.randomInt(1000, 10000));
}
