import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { StaffRole, ServiceCode, StaffUserPublic } from '../shared/types.ts';

const JWT_SECRET =
  process.env.STAFF_JWT_SECRET ||
  crypto.createHash('sha256').update(`queueless-staff-secret-${process.env.APP_URL || 'local'}`).digest('hex');

export interface StaffJwtPayload {
  sub: string;
  staffCode: string;
  email: string;
  fullName: string;
  role: StaffRole;
  assignedServiceCode: ServiceCode | null;
  iat: number;
  exp: number;
}

export interface StaffAuthRequest extends Request {
  staff?: StaffJwtPayload;
}

export function hashPassword(password: string, salt?: string): string {
  const usedSalt = salt ?? crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, usedSalt, 64).toString('hex');
  return `${usedSalt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, keyHex] = storedHash.split(':');
  if (!salt || !keyHex) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(keyHex, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

function base64UrlEncode(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((input.length + 3) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
}

export function signStaffJwt(user: StaffUserPublic, ttlSeconds = 12 * 3600): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload: StaffJwtPayload = {
    sub: user.id,
    staffCode: user.staffCode,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    assignedServiceCode: user.assignedServiceCode,
    iat: now,
    exp: now + ttlSeconds,
  };
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = base64UrlEncode(
    crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest()
  );
  return `${header}.${body}.${signature}`;
}

export function verifyStaffJwt(token: string): StaffJwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const expectedSig = base64UrlEncode(
      crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest()
    );
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }
    const parsed = JSON.parse(base64UrlDecode(body)) as StaffJwtPayload;
    if (!parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function requireStaffAuth(req: StaffAuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Staff authentication required.' });
    return;
  }
  const token = authHeader.slice('Bearer '.length).trim();
  const payload = verifyStaffJwt(token);
  if (!payload) {
    res.status(401).json({ error: 'Session expired or invalid staff token.' });
    return;
  }
  req.staff = payload;
  next();
}
