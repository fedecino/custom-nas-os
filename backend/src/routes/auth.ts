import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { NextFunction, Request, Response, Router } from 'express';
import { DATA_DIR } from '../services/docker.js';
import { auditLog, getClientIp } from '../services/security.js';
import { isUserAdmin, verifyLinuxUserPassword } from './settings.js';
import { setSambaPassword } from './users.js';

const router = Router();
const COOKIE_NAME = 'silo_session';
const SECRET_FILE = path.join(DATA_DIR, '.nas-os', 'session.secret');
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h

// In-memory revoked token IDs (jti -> expMs) and per-user revocation timestamps
const revokedJtis = new Map<string, number>();
const userRevokedBefore = new Map<string, number>();

// Login brute-force protection: max 5 failed attempts per 15 minutes per IP
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;
const loginFailures = new Map<string, { count: number; resetAt: number }>();

let cachedSecret: string | null = null;

function isDevNoAuthEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.SILO_DEV_NO_AUTH === '1';
}

export function revokeUserSessions(username: string): void {
  userRevokedBefore.set(username, Date.now());
}

function cleanupExpiredMaps(): void {
  const now = Date.now();
  for (const [jti, exp] of revokedJtis) {
    if (exp <= now) revokedJtis.delete(jti);
  }
  for (const [ip, rec] of loginFailures) {
    if (rec.resetAt <= now) loginFailures.delete(ip);
  }
}

setInterval(cleanupExpiredMaps, 10 * 60 * 1000).unref();

async function getSessionSecret(): Promise<string> {
  if (cachedSecret) return cachedSecret;
  try {
    const raw = (await fs.readFile(SECRET_FILE, 'utf-8')).trim();
    if (raw.length >= 32) {
      cachedSecret = raw;
      return raw;
    }
  } catch {
    // generate new
  }
  const generated = crypto.randomBytes(32).toString('hex');
  try {
    await fs.mkdir(path.dirname(SECRET_FILE), { recursive: true, mode: 0o700 });
    await fs.writeFile(SECRET_FILE, generated, { mode: 0o600 });
  } catch {
    // ignore if non-writable
  }
  cachedSecret = generated;
  return generated;
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

async function signToken(username: string): Promise<string> {
  const secret = await getSessionSecret();
  const iat = Date.now();
  const exp = iat + SESSION_TTL_MS;
  const jti = crypto.randomBytes(12).toString('hex');
  const payload = Buffer.from(JSON.stringify({ u: username, iat, exp, jti })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

async function verifyToken(
  token: string | undefined
): Promise<{ username: string; jti?: string; exp?: number } | null> {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;

  const secret = await getSessionSecret();
  const expectedSig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as {
      u?: string;
      iat?: number;
      exp?: number;
      jti?: string;
    };
    if (!data.u || !data.exp || Date.now() > data.exp) return null;
    if (data.jti && revokedJtis.has(data.jti)) return null;
    const revokedBefore = userRevokedBefore.get(data.u);
    if (revokedBefore && (!data.iat || data.iat < revokedBefore)) return null;
    return { username: data.u, jti: data.jti, exp: data.exp };
  } catch {
    return null;
  }
}

export async function authenticateCookieHeader(
  cookieHeader: string | undefined
): Promise<{ username: string } | null> {
  if (isDevNoAuthEnabled()) {
    return { username: 'dev' };
  }
  const cookies = parseCookies(cookieHeader);
  const session = await verifyToken(cookies[COOKIE_NAME]);
  return session ? { username: session.username } : null;
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (isDevNoAuthEnabled()) {
    (req as Request & { user?: string }).user = 'dev';
    next();
    return;
  }

  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[COOKIE_NAME];
  const session = await verifyToken(token);

  if (!session) {
    res.status(401).json({ error: 'Autenticazione richiesta' });
    return;
  }

  (req as Request & { user?: string }).user = session.username;
  next();
}

export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (isDevNoAuthEnabled()) {
    next();
    return;
  }
  const username = (req as Request & { user?: string }).user;
  if (!username || !(await isUserAdmin(username))) {
    res.status(403).json({ error: 'Privilegi amministratore richiesti' });
    return;
  }
  next();
}

router.get('/status', async (req: Request, res: Response) => {
  if (isDevNoAuthEnabled()) {
    const homePath = path.join(DATA_DIR, 'Homes', 'dev');
    await fs.mkdir(homePath, { recursive: true }).catch(() => {});
    res.json({ authenticated: true, username: 'dev', isAdmin: true, homePath });
    return;
  }
  const cookies = parseCookies(req.headers.cookie);
  const session = await verifyToken(cookies[COOKIE_NAME]);
  if (!session) {
    res.json({ authenticated: false, username: null, isAdmin: false, homePath: null });
    return;
  }
  const homePath = path.join(DATA_DIR, 'Homes', session.username);
  await fs.mkdir(homePath, { recursive: true }).catch(() => {});
  const isAdmin = await isUserAdmin(session.username);
  res.json({
    authenticated: true,
    username: session.username,
    isAdmin,
    homePath,
  });
});

router.post('/login', async (req: Request, res: Response) => {
  const clientIp = getClientIp(req);
  const now = Date.now();
  const failRec = loginFailures.get(clientIp);
  if (failRec && failRec.resetAt > now && failRec.count >= LOGIN_MAX_ATTEMPTS) {
    const retryMin = Math.max(1, Math.ceil((failRec.resetAt - now) / 60000));
    await auditLog('auth.login.rate_limited', { ip: clientIp });
    res.status(429).json({
      error: `Troppi tentativi di accesso falliti. Riprova tra ${retryMin} minuti.`,
    });
    return;
  }

  const { username, password } = req.body as {
    username?: string;
    password?: string;
  };

  const cleanUser = String(username ?? '').trim();
  const cleanPass = String(password ?? '');

  if (!cleanUser || !cleanPass) {
    res.status(400).json({ error: 'Inserisci username e password' });
    return;
  }

  const valid = await verifyLinuxUserPassword(cleanUser, cleanPass);
  if (!valid) {
    const prev = failRec && failRec.resetAt > now ? failRec : { count: 0, resetAt: now + LOGIN_WINDOW_MS };
    loginFailures.set(clientIp, { count: prev.count + 1, resetAt: prev.resetAt });
    await auditLog('auth.login.failed', { ip: clientIp, username: cleanUser });
    res.status(401).json({ error: 'Username o password non validi' });
    return;
  }

  loginFailures.delete(clientIp);

  // Keep Samba tdbsam password in sync for system admin accounts created outside the UI
  await setSambaPassword(cleanUser, cleanPass).catch(() => {});

  const homePath = path.join(DATA_DIR, 'Homes', cleanUser);
  await fs.mkdir(homePath, { recursive: true }).catch(() => {});
  const isAdmin = await isUserAdmin(cleanUser);

  const token = await signToken(cleanUser);
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';

  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: isHttps,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS,
  });

  await auditLog('auth.login.success', { ip: clientIp, username: cleanUser, isAdmin });
  res.json({ authenticated: true, username: cleanUser, isAdmin, homePath });
});

router.post('/logout', async (req: Request, res: Response) => {
  const cookies = parseCookies(req.headers.cookie);
  const session = await verifyToken(cookies[COOKIE_NAME]);
  if (session?.jti && session.exp) {
    revokedJtis.set(session.jti, session.exp);
    await auditLog('auth.logout', { ip: getClientIp(req), username: session.username });
  }
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ success: true });
});

export default router;
