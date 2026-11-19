/**
 * Queueless Firestore Rules Adversarial Test Specification
 * Covers the "Dirty Dozen" security payloads defined in security_spec.md.
 * Run against Firebase Emulator Suite when testing locally:
 *   firebase emulators:exec --only firestore "npx tsx firestore.rules.test.ts"
 */

export interface DirtyDozenCase {
  id: number;
  name: string;
  path: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  auth: { uid: string; email: string; email_verified: boolean } | null;
  payload?: Record<string, unknown>;
  expectedResult: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_TESTS: DirtyDozenCase[] = [
  {
    id: 1,
    name: 'Unauthenticated Profile Read',
    path: '/users/u1/private/profile',
    operation: 'get',
    auth: null,
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Cross-User Profile Read',
    path: '/users/u1/private/profile',
    operation: 'get',
    auth: { uid: 'u2', email: 'u2@example.com', email_verified: true },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Unverified Email Write',
    path: '/users/u1/private/profile',
    operation: 'create',
    auth: { uid: 'u1', email: 'u1@example.com', email_verified: false },
    payload: { uid: 'u1', displayName: 'Asha', email: 'u1@example.com', preferredLang: 'en' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Identity Spoofing on Token Pass',
    path: '/users/u2/tokens/tok_1',
    operation: 'create',
    auth: { uid: 'u2', email: 'u2@example.com', email_verified: true },
    payload: {
      uid: 'u1',
      tokenId: 'tok_1',
      tokenCode: 'HOPD-104',
      serviceCode: 'HOPD',
      pin: '4821',
      status: 'WAITING',
      bookedForName: 'Spoofed',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Shadow / Ghost Field Injection',
    path: '/users/u1/private/profile',
    operation: 'create',
    auth: { uid: 'u1', email: 'u1@example.com', email_verified: true },
    payload: {
      uid: 'u1',
      displayName: 'Asha',
      email: 'u1@example.com',
      preferredLang: 'en',
      role: 'SUPERVISOR',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'ID Poisoning with Invalid Path Characters',
    path: '/users/u1/tokens/invalid$id!with@spaces',
    operation: 'create',
    auth: { uid: 'u1', email: 'u1@example.com', email_verified: true },
    payload: { tokenId: 'invalid$id!with@spaces' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Resource Exhaustion via Oversized String',
    path: '/users/u1/private/profile',
    operation: 'create',
    auth: { uid: 'u1', email: 'u1@example.com', email_verified: true },
    payload: {
      uid: 'u1',
      displayName: 'X'.repeat(500),
      email: 'u1@example.com',
      preferredLang: 'en',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Client-Spoofed Timestamp',
    path: '/users/u1/private/profile',
    operation: 'create',
    auth: { uid: 'u1', email: 'u1@example.com', email_verified: true },
    payload: {
      uid: 'u1',
      displayName: 'Asha',
      email: 'u1@example.com',
      preferredLang: 'en',
      updatedAt: '2020-01-01T00:00:00Z',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Immutable Field Mutation (PIN / Token Code)',
    path: '/users/u1/tokens/tok_1',
    operation: 'update',
    auth: { uid: 'u1', email: 'u1@example.com', email_verified: true },
    payload: { pin: '9999', tokenCode: 'HOPD-001' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Terminal State Resurrection',
    path: '/users/u1/tokens/tok_completed',
    operation: 'update',
    auth: { uid: 'u1', email: 'u1@example.com', email_verified: true },
    payload: { status: 'WAITING' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Admin Registry Escalation',
    path: '/admins/u1',
    operation: 'create',
    auth: { uid: 'u1', email: 'u1@example.com', email_verified: true },
    payload: { uid: 'u1', email: 'u1@example.com' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Blanket Cross-User Token List',
    path: '/users/u1/tokens',
    operation: 'list',
    auth: { uid: 'u2', email: 'u2@example.com', email_verified: true },
    expectedResult: 'PERMISSION_DENIED',
  },
];
