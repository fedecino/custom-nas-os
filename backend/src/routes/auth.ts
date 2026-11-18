import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { NextFunction, Request, Response, Router } from 'express';
import { DATA_DIR } from '../services/docker.js';
import { isUserAdmin, verifyLinuxUserPassword } from './settings.js';
import { setSambaPassword } from './users.js';

const router = Router();
const COOKIE_NAME = 'silo_session';
const SECRET_FILE = path.join(DATA_DIR, '.nas-os', 'session.secret');
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

let cachedSecret: string | null = null;

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
    await fs.mkdir(path.dirname(SECRET_FILE), { recursive: true });
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
    out[k] = decodeURIComponent(v);
  }
  return out;
}

async function signToken(username: string): Promise<string> {
  const secret = await getSessionSecret();
  const exp = Date.now() + SESSION_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ u: username, exp })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

async function verifyToken(token: string | undefined): Promise<{ username: string } | null> {
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
      exp?: number;
    };
    if (!data.u || !data.exp || Date.now() > data.exp) return null;
    return { username: data.u };
  } catch {
    return null;
  }
}

export async function authenticateCookieHeader(
  cookieHeader: string | undefined
): Promise<{ username: string } | null> {
  if (process.env.SILO_DEV_NO_AUTH === '1') {
    return { username: 'dev' };
  }
  const cookies = parseCookies(cookieHeader);
  return verifyToken(cookies[COOKIE_NAME]);
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (process.env.SILO_DEV_NO_AUTH === '1') {
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
  if (process.env.SILO_DEV_NO_AUTH === '1') {
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
  if (process.env.SILO_DEV_NO_AUTH === '1') {
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
    res.status(401).json({ error: 'Username o password non validi' });
    return;
  }

  // Keep Samba tdbsam password in sync for system admin accounts created outside the UI
  await setSambaPassword(cleanUser, cleanPass).catch(() => {});

  const homePath = path.join(DATA_DIR, 'Homes', cleanUser);
  await fs.mkdir(homePath, { recursive: true }).catch(() => {});
  const isAdmin = await isUserAdmin(cleanUser);

  const token = await signToken(cleanUser);
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS,
  });

  res.json({ authenticated: true, username: cleanUser, isAdmin, homePath });
});

router.post('/logout', (_req: Request, res: Response) => {
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ success: true });
});

export default router;
