import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import { promisify } from 'node:util';
import { Router, Request, Response } from 'express';

const execFileAsync = promisify(execFile);
const router = Router();

const INSTALL_SCRIPT = '/usr/local/sbin/nas-os-install';
const SAFE_DISK_RE = /^\/dev\/[a-zA-Z0-9_-]+$/;
const SAFE_USER_RE = /^[a-z_][a-z0-9_-]{1,30}$/;
const SAFE_HOST_RE = /^[a-zA-Z0-9-]{1,63}$/;

let installInProgress = false;
let installCompleted = false;

export interface InstallTargetDisk {
  path: string;
  name: string;
  sizeBytes: number;
  model: string;
  transport: string;
  removable: boolean;
  isLiveMedium: boolean;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function isLiveInstallMode(): Promise<boolean> {
  if (process.env.NODE_ENV !== 'production' && process.env.SILO_FORCE_LIVE_INSTALLER === '1') {
    return true;
  }
  if (await pathExists('/run/live/medium')) return true;
  if (await pathExists('/lib/live/mount/medium')) return true;

  try {
    const mounts = await fs.readFile('/proc/mounts', 'utf-8');
    const rootLine = mounts.split('\n').find((l) => l.split(' ')[1] === '/');
    if (rootLine) {
      const fsType = rootLine.split(' ')[2];
      if (fsType === 'overlay' && (await pathExists(INSTALL_SCRIPT))) {
        return true;
      }
    }
  } catch {
    // ignore
  }
  return false;
}

async function detectBootMode(): Promise<'uefi' | 'bios'> {
  return (await pathExists('/sys/firmware/efi')) ? 'uefi' : 'bios';
}

async function detectLiveMediumDisk(): Promise<string | null> {
  for (const mp of ['/run/live/medium', '/lib/live/mount/medium']) {
    try {
      const { stdout } = await execFileAsync('findmnt', ['-n', '-o', 'SOURCE', mp], {
        timeout: 3000,
      });
      const src = stdout.trim();
      if (!src || !src.startsWith('/dev/')) continue;
      const { stdout: pk } = await execFileAsync('lsblk', ['-no', 'PKNAME', src], {
        timeout: 3000,
      });
      const parent = pk.trim().split('\n')[0]?.trim();
      return parent ? `/dev/${parent}` : src;
    } catch {
      // try next mountpoint
    }
  }
  return null;
}

async function listInstallableDisks(): Promise<InstallTargetDisk[]> {
  const liveDisk = await detectLiveMediumDisk();
  try {
    const { stdout } = await execFileAsync(
      'lsblk',
      ['-d', '-b', '-J', '-o', 'NAME,SIZE,MODEL,TRAN,RM,TYPE'],
      { timeout: 5000 }
    );
    const parsed = JSON.parse(stdout) as {
      blockdevices?: Array<{
        name?: string;
        size?: number | string;
        model?: string | null;
        tran?: string | null;
        rm?: boolean | number | string;
        type?: string;
      }>;
    };

    const disks: InstallTargetDisk[] = [];
    for (const d of parsed.blockdevices ?? []) {
      const name = String(d.name ?? '').trim();
      if (!name || d.type !== 'disk') continue;
      if (/^(loop|ram|zram|sr|fd)/.test(name)) continue;
      const devPath = `/dev/${name}`;
      disks.push({
        path: devPath,
        name,
        sizeBytes: Number(d.size) || 0,
        model: (d.model ?? '').trim() || 'Disco generico',
        transport: (d.tran ?? '').trim().toUpperCase() || 'DISK',
        removable: d.rm === true || d.rm === 1 || d.rm === '1',
        isLiveMedium: liveDisk !== null && devPath === liveDisk,
      });
    }
    return disks;
  } catch {
    return [];
  }
}

// Public status endpoint — tells the frontend whether to display the Live Install Wizard
router.get('/status', async (_req: Request, res: Response) => {
  const isLiveMode = await isLiveInstallMode();
  if (!isLiveMode) {
    res.json({ isLiveMode: false });
    return;
  }

  const [bootMode, liveMediumDisk] = await Promise.all([
    detectBootMode(),
    detectLiveMediumDisk(),
  ]);

  res.json({
    isLiveMode: true,
    bootMode,
    liveMediumDisk,
    installing: installInProgress,
    completed: installCompleted,
    hostname: os.hostname() || 'siloos',
  });
});

// Guard: all remaining installer routes are strictly disabled outside Live USB mode
router.use(async (_req, res, next) => {
  if (!(await isLiveInstallMode())) {
    res.status(403).json({
      error: 'Installazione Web disponibile solo in modalità Live USB',
    });
    return;
  }
  next();
});

router.get('/disks', async (_req: Request, res: Response) => {
  try {
    const [disks, bootMode, liveMediumDisk] = await Promise.all([
      listInstallableDisks(),
      detectBootMode(),
      detectLiveMediumDisk(),
    ]);
    res.json({ disks, bootMode, liveMediumDisk });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Impossibile leggere i dischi';
    res.status(500).json({ error: message });
  }
});

router.post('/run', async (req: Request, res: Response) => {
  if (installInProgress) {
    res.status(409).json({ error: 'Installazione già in corso' });
    return;
  }

  const { targetDisk, username, password, hostname } = req.body as {
    targetDisk?: string;
    username?: string;
    password?: string;
    hostname?: string;
  };

  const cleanDisk = String(targetDisk ?? '').trim();
  const cleanUser = String(username ?? 'nas').trim();
  const cleanPass = String(password ?? '');
  const cleanHost = String(hostname ?? 'siloos').trim() || 'siloos';

  if (!SAFE_DISK_RE.test(cleanDisk)) {
    res.status(400).json({ error: 'Disco di destinazione non valido' });
    return;
  }
  if (!SAFE_USER_RE.test(cleanUser)) {
    res.status(400).json({
      error: 'Username non valido (2-31 caratteri minuscoli, numeri, _ o -)',
    });
    return;
  }
  if (cleanPass.length < 6) {
    res.status(400).json({ error: 'La password deve avere almeno 6 caratteri' });
    return;
  }
  if (!SAFE_HOST_RE.test(cleanHost)) {
    res.status(400).json({ error: 'Hostname non valido (lettere, numeri e trattini)' });
    return;
  }

  const liveDisk = await detectLiveMediumDisk();
  if (liveDisk && cleanDisk === liveDisk) {
    res.status(400).json({
      error: `Non puoi sovrascrivere la chiavetta USB Live in uso (${liveDisk}). Usa un SSD interno o una seconda chiavetta USB.`,
    });
    return;
  }

  if (!(await pathExists(INSTALL_SCRIPT))) {
    res.status(500).json({ error: `Script di installazione non trovato (${INSTALL_SCRIPT})` });
    return;
  }

  installInProgress = true;
  installCompleted = false;

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sendEvent = (event: string, data: Record<string, unknown>) => {
    if (!res.writableEnded) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }
  };

  sendEvent('step', { step: 0, total: 5, label: 'Avvio installazione su disco...' });

  const child = spawn(INSTALL_SCRIPT, [], {
    env: {
      ...process.env,
      SILO_NONINTERACTIVE: '1',
      SILO_TARGET_DISK: cleanDisk,
      SILO_NEW_USER: cleanUser,
      SILO_HOSTNAME: cleanHost,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Pass password securely over stdin
  child.stdin.write(`${cleanPass}\n`);
  child.stdin.end();

  const handleChunk = (chunk: Buffer, stream: 'stdout' | 'stderr') => {
    const text = chunk.toString('utf-8');
    for (const rawLine of text.split('\n')) {
      const line = rawLine.trimEnd();
      if (!line) continue;
      const stepMatch = line.match(/^\[STEP (\d+)\/(\d+)\]\s*(.+)$/);
      if (stepMatch) {
        sendEvent('step', {
          step: Number(stepMatch[1]),
          total: Number(stepMatch[2]),
          label: stepMatch[3].trim(),
        });
      }
      sendEvent('log', { message: line, stream });
    }
  };

  child.stdout.on('data', (chunk: Buffer) => handleChunk(chunk, 'stdout'));
  child.stderr.on('data', (chunk: Buffer) => handleChunk(chunk, 'stderr'));

  child.on('error', (err) => {
    installInProgress = false;
    sendEvent('error', { message: err.message });
    sendEvent('done', { success: false, exitCode: 1 });
    if (!res.writableEnded) res.end();
  });

  child.on('close', (code) => {
    installInProgress = false;
    const ok = code === 0;
    if (ok) {
      installCompleted = true;
      sendEvent('step', { step: 5, total: 5, label: 'Installazione completata con successo!' });
    }
    sendEvent('done', { success: ok, exitCode: code ?? 1, hostname: cleanHost, username: cleanUser });
    if (!res.writableEnded) res.end();
  });
});

router.post('/power', async (req: Request, res: Response) => {
  const action = (req.body as { action?: string }).action;
  if (action !== 'reboot' && action !== 'poweroff') {
    res.status(400).json({ error: 'Azione non valida (usa reboot o poweroff)' });
    return;
  }

  res.json({ success: true, action });
  setTimeout(() => {
    execFileAsync('systemctl', [action], { timeout: 5000 }).catch(() => {});
  }, 600);
});

export default router;
