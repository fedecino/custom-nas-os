import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Router, Request, Response } from 'express';
import { DATA_DIR } from '../services/docker.js';
import { resolveRealPathSafe } from '../services/security.js';
import { isUserAdmin } from './settings.js';
import type { NasShare } from './shares.js';

const router = Router();
const NAS_OS_INTERNAL_DIR = path.resolve(path.join(DATA_DIR, '.nas-os'));
const SHARES_FILE = path.join(NAS_OS_INTERNAL_DIR, 'shares.json');
const DANGEROUS_INLINE_EXTS = new Set(['.html', '.htm', '.svg', '.xhtml', '.xml', '.js', '.mjs']);

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

async function checkUserAccess(
  ctx: Awaited<ReturnType<typeof getUserFileContext>>,
  targetPath: string,
  requiredMode: 'ro' | 'rw'
): Promise<{ allowed: boolean; matchedRoot: string | null; realPath: string }> {
  const realPath = await resolveRealPathSafe(targetPath);
  // Never allow reading/writing internal SiloOs secrets directory via File Manager
  if (isInsideRoot(realPath, NAS_OS_INTERNAL_DIR)) {
    return { allowed: false, matchedRoot: null, realPath };
  }
  if (ctx.isAdmin) {
    return { allowed: true, matchedRoot: null, realPath };
  }
  for (const root of ctx.allowedRoots) {
    const realRoot = await resolveRealPathSafe(root.path);
    if (isInsideRoot(realPath, realRoot)) {
      if (requiredMode === 'rw' && root.mode !== 'rw') {
        return { allowed: false, matchedRoot: realRoot, realPath };
      }
      return { allowed: true, matchedRoot: realRoot, realPath };
    }
  }
  return { allowed: false, matchedRoot: null, realPath };
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
  if (isInsideRoot(resolved, NAS_OS_INTERNAL_DIR)) return true;
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

  const access = await checkUserAccess(ctx, resolved, 'ro');
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
  if (!(await checkUserAccess(ctx, target, 'rw')).allowed) {
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
  if (!(await checkUserAccess(ctx, target, 'rw')).allowed) {
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
    !(await checkUserAccess(ctx, resolvedOld, 'rw')).allowed ||
    !(await checkUserAccess(ctx, resolvedNew, 'rw')).allowed
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

async function resolveUniqueDestPath(targetDir: string, baseName: string): Promise<string> {
  const initial = path.join(targetDir, baseName);
  try {
    await fs.access(initial);
  } catch {
    return initial;
  }

  const ext = path.extname(baseName);
  const stem = ext ? baseName.slice(0, -ext.length) : baseName;
  for (let i = 1; i <= 999; i++) {
    const suffix = i === 1 ? ' (copia)' : ` (copia ${i})`;
    const candidate = path.join(targetDir, `${stem}${suffix}${ext}`);
    try {
      await fs.access(candidate);
    } catch {
      return candidate;
    }
  }
  return path.join(targetDir, `${stem}-${Date.now()}${ext}`);
}

router.post('/paste', async (req: Request, res: Response) => {
  const ctx = await getUserFileContext(req);
  const { mode, sources, targetDir } = req.body as {
    mode?: 'copy' | 'cut';
    sources?: string[];
    targetDir?: string;
  };

  if (mode !== 'copy' && mode !== 'cut') {
    res.status(400).json({ error: 'Modalità non valida (usa copy o cut)' });
    return;
  }
  const sourceList = (Array.isArray(sources) ? sources : [])
    .map((s) => String(s).trim())
    .filter(Boolean);
  if (sourceList.length === 0 || !targetDir?.trim()) {
    res.status(400).json({ error: 'Sorgenti o cartella di destinazione mancanti' });
    return;
  }

  const resolvedTargetDir = path.resolve(targetDir.trim());
  if (isProtectedPath(resolvedTargetDir)) {
    res.status(403).json({ error: 'Cartella di destinazione protetta' });
    return;
  }
  if (!(await checkUserAccess(ctx, resolvedTargetDir, 'rw')).allowed) {
    res.status(403).json({ error: 'Permessi di scrittura mancanti nella cartella di destinazione' });
    return;
  }

  try {
    const destStat = await fs.stat(resolvedTargetDir);
    if (!destStat.isDirectory()) {
      res.status(400).json({ error: 'La destinazione non è una cartella' });
      return;
    }

    const processed: string[] = [];
    for (const rawSrc of sourceList) {
      const resolvedSrc = path.resolve(rawSrc);
      if (isProtectedPath(resolvedSrc)) {
        res.status(403).json({ error: `Percorso protetto: ${resolvedSrc}` });
        return;
      }
      if (mode === 'cut' && (resolvedSrc === DATA_DIR || resolvedSrc === ctx.homePath)) {
        res.status(403).json({ error: 'Impossibile spostare questa directory principale' });
        return;
      }
      if (!(await checkUserAccess(ctx, resolvedSrc, mode === 'cut' ? 'rw' : 'ro')).allowed) {
        res.status(403).json({ error: `Permesso negato su: ${path.basename(resolvedSrc)}` });
        return;
      }

      // Prevent copying/moving a folder into itself
      if (
        resolvedTargetDir === resolvedSrc ||
        resolvedTargetDir.startsWith(`${resolvedSrc}/`)
      ) {
        res.status(400).json({
          error: `Impossibile ${mode === 'cut' ? 'spostare' : 'copiare'} "${path.basename(resolvedSrc)}" dentro se stessa`,
        });
        return;
      }

      const baseName = path.basename(resolvedSrc);
      if (mode === 'cut' && path.dirname(resolvedSrc) === resolvedTargetDir) {
        // Already in the same directory: no-op
        continue;
      }

      const finalDest = await resolveUniqueDestPath(resolvedTargetDir, baseName);
      if (mode === 'copy') {
        await fs.cp(resolvedSrc, finalDest, { recursive: true });
      } else {
        try {
          await fs.rename(resolvedSrc, finalDest);
        } catch (err) {
          if ((err as NodeJS.ErrnoException)?.code === 'EXDEV') {
            await fs.cp(resolvedSrc, finalDest, { recursive: true });
            await fs.rm(resolvedSrc, { recursive: true, force: false });
          } else {
            throw err;
          }
        }
      }
      processed.push(finalDest);
    }

    res.json({ success: true, count: processed.length, paths: processed });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Operazione copia/spostamento fallita';
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
  if (!(await checkUserAccess(ctx, resolved, 'rw')).allowed) {
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
  const access = await checkUserAccess(ctx, resolved, 'ro');
  if (!access.allowed) {
    res.status(403).json({ error: 'Accesso negato' });
    return;
  }
  res.download(access.realPath, (err) => {
    if (err && !res.headersSent) {
      res.status(404).json({ error: 'File non trovato o non leggibile' });
    }
  });
});

router.get('/view', async (req: Request, res: Response) => {
  const ctx = await getUserFileContext(req);
  const target = String(req.query.path ?? '').trim();
  if (!target) {
    res.status(400).json({ error: 'Percorso mancante' });
    return;
  }
  const resolved = path.resolve(target);
  const access = await checkUserAccess(ctx, resolved, 'ro');
  if (!access.allowed) {
    res.status(403).json({ error: 'Accesso negato' });
    return;
  }
  const ext = path.extname(access.realPath).toLowerCase();
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox"
  );
  if (DANGEROUS_INLINE_EXTS.has(ext)) {
    res.download(access.realPath, (err) => {
      if (err && !res.headersSent) {
        res.status(404).json({ error: 'File non trovato o non leggibile' });
      }
    });
    return;
  }
  res.setHeader('Content-Disposition', 'inline');
  res.sendFile(access.realPath, (err) => {
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
  if (!(await checkUserAccess(ctx, dir, 'rw')).allowed) {
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
