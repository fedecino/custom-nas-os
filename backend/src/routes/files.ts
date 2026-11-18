import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Router, Request, Response } from 'express';
import { DATA_DIR } from '../services/docker.js';
import { isUserAdmin } from './settings.js';
import type { NasShare } from './shares.js';

const router = Router();
const SHARES_FILE = path.join(DATA_DIR, '.nas-os', 'shares.json');

function isInsideRoot(target: string, root: string): boolean {
  const rTarget = path.resolve(target);
  const rRoot = path.resolve(root);
  return rTarget === rRoot || rTarget.startsWith(`${rRoot}/`);
}

async function getUserFileContext(req: Request): Promise<{
  username: string;
  isAdmin: boolean;
  homePath: string;
  allowedRoots: Array<{ label: string; path: string; mode: 'ro' | 'rw' }>;
}> {
  const username = (req as Request & { user?: string }).user || 'root';
  const admin = await isUserAdmin(username);
  const homePath = path.join(DATA_DIR, 'Homes', username);
  await fs.mkdir(homePath, { recursive: true }).catch(() => {});

  if (admin) {
    return { username, isAdmin: true, homePath, allowedRoots: [] };
  }

  const allowedRoots: Array<{ label: string; path: string; mode: 'ro' | 'rw' }> = [
    { label: `Home (${username})`, path: homePath, mode: 'rw' },
  ];

  try {
    const raw = await fs.readFile(SHARES_FILE, 'utf-8');
    const shares = JSON.parse(raw) as NasShare[];
    if (Array.isArray(shares)) {
      for (const s of shares) {
        if (!s.path) continue;
        let perm: 'none' | 'ro' | 'rw' = 'none';
        if (s.guestOk) {
          perm = s.readOnly ? 'ro' : 'rw';
        } else if (s.userPermissions && Object.keys(s.userPermissions).length > 0) {
          perm = s.userPermissions[username] ?? 'none';
        } else if (Array.isArray(s.validUsers) && s.validUsers.length > 0) {
          perm = s.validUsers.includes(username) ? (s.readOnly ? 'ro' : 'rw') : 'none';
        } else {
          perm = s.readOnly ? 'ro' : 'rw';
        }
        if (s.readOnly && perm === 'rw') perm = 'ro';
        if (perm !== 'none') {
          allowedRoots.push({ label: s.name, path: path.resolve(s.path), mode: perm });
        }
      }
    }
  } catch {
    // no shares configured
  }

  return { username, isAdmin: false, homePath, allowedRoots };
}

function checkUserAccess(
  ctx: Awaited<ReturnType<typeof getUserFileContext>>,
  targetPath: string,
  requiredMode: 'ro' | 'rw'
): { allowed: boolean; matchedRoot: string | null } {
  if (ctx.isAdmin) {
    return { allowed: true, matchedRoot: null };
  }
  const resolved = path.resolve(targetPath);
  for (const root of ctx.allowedRoots) {
    if (isInsideRoot(resolved, root.path)) {
      if (requiredMode === 'rw' && root.mode !== 'rw') {
        return { allowed: false, matchedRoot: root.path };
      }
      return { allowed: true, matchedRoot: root.path };
    }
  }
  return { allowed: false, matchedRoot: null };
}

const PROTECTED_ROOTS = new Set([
  '/',
  '/bin',
  '/boot',
  '/dev',
  '/etc',
  '/lib',
  '/lib64',
  '/opt',
  '/proc',
  '/root',
  '/run',
  '/sbin',
  '/sys',
  '/usr',
  '/var',
]);

function isProtectedPath(targetPath: string): boolean {
  const resolved = path.resolve(targetPath);
  if (PROTECTED_ROOTS.has(resolved)) return true;
  for (const root of ['/bin', '/boot', '/dev', '/etc', '/lib', '/lib64', '/proc', '/sbin', '/sys', '/usr']) {
    if (resolved === root || resolved.startsWith(`${root}/`)) return true;
  }
  return false;
}

router.get('/roots', async (req: Request, res: Response) => {
  const ctx = await getUserFileContext(req);
  res.json({
    username: ctx.username,
    isAdmin: ctx.isAdmin,
    homePath: ctx.homePath,
    allowedRoots: ctx.allowedRoots,
  });
});

router.get('/list', async (req: Request, res: Response) => {
  const ctx = await getUserFileContext(req);
  const rawReq = String(req.query.path ?? '').trim();
  const requested = rawReq || (ctx.isAdmin ? DATA_DIR : ctx.homePath);
  const resolved = path.resolve(requested);

  const access = checkUserAccess(ctx, resolved, 'ro');
  if (!access.allowed) {
    res.status(403).json({ error: 'Accesso negato a questa cartella' });
    return;
  }

  try {
    const entries = await fs.readdir(resolved, { withFileTypes: true });
    const items = await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(resolved, entry.name);
        let size = 0;
        let modifiedAt: string | null = null;
        try {
          const stat = await fs.stat(fullPath);
          size = entry.isDirectory() ? 0 : stat.size;
          modifiedAt = stat.mtime.toISOString();
        } catch {
          // broken symlink or unreadable
        }
        return {
          name: entry.name,
          path: fullPath,
          isDirectory: entry.isDirectory(),
          size,
          modifiedAt,
        };
      })
    );

    items.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    const parentPath =
      resolved === '/' || (!ctx.isAdmin && access.matchedRoot === resolved)
        ? null
        : path.dirname(resolved);
    res.json({ currentPath: resolved, parentPath, items });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Cannot list directory';
    res.status(400).json({ error: message });
  }
});

router.post('/mkdir', async (req: Request, res: Response) => {
  const ctx = await getUserFileContext(req);
  const { parentPath, name } = req.body as { parentPath?: string; name?: string };
  const cleanName = String(name ?? '').trim();
  if (!cleanName || cleanName.includes('/') || cleanName === '.' || cleanName === '..') {
    res.status(400).json({ error: 'Nome cartella non valido' });
    return;
  }

  const target = path.join(path.resolve(parentPath || (ctx.isAdmin ? DATA_DIR : ctx.homePath)), cleanName);
  if (isProtectedPath(target)) {
    res.status(403).json({ error: 'Percorso di sistema protetto' });
    return;
  }
  if (!checkUserAccess(ctx, target, 'rw').allowed) {
    res.status(403).json({ error: 'Permessi di scrittura mancanti' });
    return;
  }

  try {
    await fs.mkdir(target, { recursive: true });
    res.json({ success: true, path: target });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Errore creazione cartella';
    res.status(500).json({ error: message });
  }
});

router.post('/touch', async (req: Request, res: Response) => {
  const ctx = await getUserFileContext(req);
  const { parentPath, name } = req.body as { parentPath?: string; name?: string };
  const cleanName = String(name ?? '').trim();
  if (!cleanName || cleanName.includes('/') || cleanName === '.' || cleanName === '..') {
    res.status(400).json({ error: 'Nome file non valido' });
    return;
  }

  const target = path.join(path.resolve(parentPath || (ctx.isAdmin ? DATA_DIR : ctx.homePath)), cleanName);
  if (isProtectedPath(target)) {
    res.status(403).json({ error: 'Percorso di sistema protetto' });
    return;
  }
  if (!checkUserAccess(ctx, target, 'rw').allowed) {
    res.status(403).json({ error: 'Permessi di scrittura mancanti' });
    return;
  }

  try {
    await fs.writeFile(target, '', { flag: 'wx' });
    res.json({ success: true, path: target });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Errore creazione file';
    res.status(500).json({ error: message });
  }
});

router.post('/rename', async (req: Request, res: Response) => {
  const ctx = await getUserFileContext(req);
  const { oldPath, newName } = req.body as { oldPath?: string; newName?: string };
  const cleanName = String(newName ?? '').trim();
  if (!oldPath || !cleanName || cleanName.includes('/') || cleanName === '.' || cleanName === '..') {
    res.status(400).json({ error: 'Nome o percorso non valido' });
    return;
  }

  const resolvedOld = path.resolve(oldPath);
  const resolvedNew = path.join(path.dirname(resolvedOld), cleanName);

  if (isProtectedPath(resolvedOld) || isProtectedPath(resolvedNew)) {
    res.status(403).json({ error: 'Percorso di sistema protetto' });
    return;
  }
  if (
    !checkUserAccess(ctx, resolvedOld, 'rw').allowed ||
    !checkUserAccess(ctx, resolvedNew, 'rw').allowed
  ) {
    res.status(403).json({ error: 'Permessi di scrittura mancanti' });
    return;
  }

  try {
    await fs.rename(resolvedOld, resolvedNew);
    res.json({ success: true, newPath: resolvedNew });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Errore rinomina';
    res.status(500).json({ error: message });
  }
});

router.delete('/delete', async (req: Request, res: Response) => {
  const ctx = await getUserFileContext(req);
  const target = String(req.query.path ?? '').trim();
  if (!target) {
    res.status(400).json({ error: 'Percorso mancante' });
    return;
  }

  const resolved = path.resolve(target);
  if (isProtectedPath(resolved) || resolved === DATA_DIR || resolved === ctx.homePath) {
    res.status(403).json({ error: 'Impossibile eliminare questa directory di sistema' });
    return;
  }
  if (!checkUserAccess(ctx, resolved, 'rw').allowed) {
    res.status(403).json({ error: 'Permessi di scrittura mancanti' });
    return;
  }

  try {
    await fs.rm(resolved, { recursive: true, force: false });
    res.json({ success: true, deleted: resolved });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Errore eliminazione';
    res.status(500).json({ error: message });
  }
});

router.get('/download', async (req: Request, res: Response) => {
  const ctx = await getUserFileContext(req);
  const target = String(req.query.path ?? '').trim();
  if (!target) {
    res.status(400).json({ error: 'Percorso mancante' });
    return;
  }
  const resolved = path.resolve(target);
  if (!checkUserAccess(ctx, resolved, 'ro').allowed) {
    res.status(403).json({ error: 'Accesso negato' });
    return;
  }
  res.download(resolved, (err) => {
    if (err && !res.headersSent) {
      res.status(404).json({ error: 'File non trovato o non leggibile' });
    }
  });
});

router.post('/upload', async (req: Request, res: Response) => {
  const ctx = await getUserFileContext(req);
  const rawDir = String(req.query.dir ?? '').trim();
  const dir = path.resolve(rawDir || (ctx.isAdmin ? DATA_DIR : ctx.homePath));
  const rawName = String(req.query.filename ?? '').trim();
  const safeName = path.basename(rawName);

  if (!safeName || safeName === '.' || safeName === '..') {
    res.status(400).json({ error: 'Nome file non valido' });
    return;
  }
  if (isProtectedPath(dir)) {
    res.status(403).json({ error: 'Cartella di destinazione protetta' });
    return;
  }
  if (!checkUserAccess(ctx, dir, 'rw').allowed) {
    res.status(403).json({ error: 'Permessi di scrittura mancanti' });
    return;
  }

  try {
    await fs.mkdir(dir, { recursive: true });
    const dest = path.join(dir, safeName);
    const writeStream = createWriteStream(dest);

    req.pipe(writeStream);

    writeStream.on('finish', () => {
      if (!res.headersSent) {
        res.json({ success: true, path: dest, filename: safeName });
      }
    });

    writeStream.on('error', (err) => {
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      }
    });

    req.on('error', (err) => {
      writeStream.destroy();
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upload fallito';
    res.status(500).json({ error: message });
  }
});

export default router;
