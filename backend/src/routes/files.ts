import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Router, Request, Response } from 'express';
import { DATA_DIR } from '../services/docker.js';

const router = Router();

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

router.get('/list', async (req: Request, res: Response) => {
  const requested = String(req.query.path ?? DATA_DIR).trim() || DATA_DIR;
  const resolved = path.resolve(requested);

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

    const parentPath = resolved === '/' ? null : path.dirname(resolved);
    res.json({ currentPath: resolved, parentPath, items });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Cannot list directory';
    res.status(400).json({ error: message });
  }
});

router.post('/mkdir', async (req: Request, res: Response) => {
  const { parentPath, name } = req.body as { parentPath?: string; name?: string };
  const cleanName = String(name ?? '').trim();
  if (!cleanName || cleanName.includes('/') || cleanName === '.' || cleanName === '..') {
    res.status(400).json({ error: 'Nome cartella non valido' });
    return;
  }

  const target = path.join(path.resolve(parentPath || DATA_DIR), cleanName);
  if (isProtectedPath(target)) {
    res.status(403).json({ error: 'Percorso di sistema protetto' });
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
  const { parentPath, name } = req.body as { parentPath?: string; name?: string };
  const cleanName = String(name ?? '').trim();
  if (!cleanName || cleanName.includes('/') || cleanName === '.' || cleanName === '..') {
    res.status(400).json({ error: 'Nome file non valido' });
    return;
  }

  const target = path.join(path.resolve(parentPath || DATA_DIR), cleanName);
  if (isProtectedPath(target)) {
    res.status(403).json({ error: 'Percorso di sistema protetto' });
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

  try {
    await fs.rename(resolvedOld, resolvedNew);
    res.json({ success: true, newPath: resolvedNew });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Errore rinomina';
    res.status(500).json({ error: message });
  }
});

router.delete('/delete', async (req: Request, res: Response) => {
  const target = String(req.query.path ?? '').trim();
  if (!target) {
    res.status(400).json({ error: 'Percorso mancante' });
    return;
  }

  const resolved = path.resolve(target);
  if (isProtectedPath(resolved) || resolved === DATA_DIR) {
    res.status(403).json({ error: 'Impossibile eliminare questa directory di sistema' });
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

router.get('/download', (req: Request, res: Response) => {
  const target = String(req.query.path ?? '').trim();
  if (!target) {
    res.status(400).json({ error: 'Percorso mancante' });
    return;
  }
  const resolved = path.resolve(target);
  res.download(resolved, (err) => {
    if (err && !res.headersSent) {
      res.status(404).json({ error: 'File non trovato o non leggibile' });
    }
  });
});

router.post('/upload', async (req: Request, res: Response) => {
  const dir = path.resolve(String(req.query.dir ?? DATA_DIR).trim() || DATA_DIR);
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
