import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { Router, Request, Response } from 'express';
import { DATA_DIR } from '../services/docker.js';
import { requireAdmin } from './auth.js';

const execFileAsync = promisify(execFile);
const router = Router();

const BACKUPS_FILE = path.join(DATA_DIR, '.nas-os', 'backups.json');

export interface BackupRepository {
  id: string;
  name: string;
  type: 'local' | 'sftp' | 's3';
  url: string;
  password: string;
  s3AccessKey?: string;
  s3SecretKey?: string;
  createdAt: string;
}

export interface BackupJob {
  id: string;
  name: string;
  repoId: string;
  sources: string[];
  excludes: string[];
  schedule: 'manual' | 'hourly' | 'daily' | 'weekly';
  scheduleTime: string; // HH:MM
  keepDaily: number;
  keepWeekly: number;
  keepMonthly: number;
  enabled: boolean;
  lastRunAt: string | null;
  lastStatus: 'ok' | 'error' | 'running' | null;
  lastMessage: string | null;
}

interface BackupStoreData {
  repos: BackupRepository[];
  jobs: BackupJob[];
}

export interface ResticSnapshot {
  id: string;
  short_id: string;
  time: string;
  hostname: string;
  paths: string[];
  tags?: string[];
}

let runningJobId: string | null = null;
const lastTriggeredMinute = new Map<string, string>();

async function readStore(): Promise<BackupStoreData> {
  try {
    const raw = await fs.readFile(BACKUPS_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<BackupStoreData>;
    return {
      repos: Array.isArray(parsed.repos) ? parsed.repos : [],
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
    };
  } catch {
    return { repos: [], jobs: [] };
  }
}

async function saveStore(data: BackupStoreData): Promise<void> {
  await fs.mkdir(path.dirname(BACKUPS_FILE), { recursive: true });
  await fs.writeFile(BACKUPS_FILE, JSON.stringify(data, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  });
}

function sanitizeRepo(repo: BackupRepository) {
  return {
    id: repo.id,
    name: repo.name,
    type: repo.type,
    url: repo.url,
    hasPassword: Boolean(repo.password),
    hasS3Keys: Boolean(repo.s3AccessKey && repo.s3SecretKey),
    createdAt: repo.createdAt,
  };
}

function buildResticEnv(repo: BackupRepository): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    RESTIC_REPOSITORY: repo.url,
    RESTIC_PASSWORD: repo.password,
  };
  if (repo.type === 's3') {
    if (repo.s3AccessKey) env['AWS_ACCESS_KEY_ID'] = repo.s3AccessKey;
    if (repo.s3SecretKey) env['AWS_SECRET_ACCESS_KEY'] = repo.s3SecretKey;
  }
  return env;
}

async function getResticVersion(): Promise<{ installed: boolean; version: string | null }> {
  try {
    const { stdout } = await execFileAsync('restic', ['version'], { timeout: 4000 });
    return { installed: true, version: stdout.trim() };
  } catch {
    return { installed: false, version: null };
  }
}

async function executeBackupJob(jobId: string): Promise<{
  success: boolean;
  output: string;
  job: BackupJob;
}> {
  if (runningJobId) {
    throw new Error('Un altro job di backup è già in esecuzione');
  }

  const store = await readStore();
  const job = store.jobs.find((j) => j.id === jobId);
  if (!job) throw new Error('Job di backup non trovato');

  const repo = store.repos.find((r) => r.id === job.repoId);
  if (!repo) throw new Error('Repository associato non trovato');

  const validSources = job.sources.map((s) => s.trim()).filter((s) => s.startsWith('/'));
  if (validSources.length === 0) {
    throw new Error('Nessuna cartella sorgente valida configurata');
  }

  runningJobId = job.id;
  job.lastStatus = 'running';
  job.lastRunAt = new Date().toISOString();
  job.lastMessage = 'Backup in corso...';
  await saveStore(store);

  const env = buildResticEnv(repo);
  const logs: string[] = [];

  try {
    const backupArgs = ['backup', ...validSources, '--tag', `siloos-${job.id}`];
    for (const ex of job.excludes) {
      const cleaned = ex.trim();
      if (cleaned) backupArgs.push('--exclude', cleaned);
    }

    const backupRes = await execFileAsync('restic', backupArgs, {
      env,
      timeout: 60 * 60 * 1000, // up to 1h
      maxBuffer: 10 * 1024 * 1024,
    });
    logs.push(backupRes.stdout.trim());
    if (backupRes.stderr.trim()) logs.push(backupRes.stderr.trim());

    // Apply retention policy if configured
    if (job.keepDaily > 0 || job.keepWeekly > 0 || job.keepMonthly > 0) {
      const forgetArgs = ['forget', '--tag', `siloos-${job.id}`, '--prune'];
      if (job.keepDaily > 0) forgetArgs.push('--keep-daily', String(job.keepDaily));
      if (job.keepWeekly > 0) forgetArgs.push('--keep-weekly', String(job.keepWeekly));
      if (job.keepMonthly > 0) forgetArgs.push('--keep-monthly', String(job.keepMonthly));
      const forgetRes = await execFileAsync('restic', forgetArgs, {
        env,
        timeout: 30 * 60 * 1000,
        maxBuffer: 10 * 1024 * 1024,
      });
      if (forgetRes.stdout.trim()) logs.push(forgetRes.stdout.trim());
    }

    const freshStore = await readStore();
    const target = freshStore.jobs.find((j) => j.id === job.id);
    if (target) {
      target.lastStatus = 'ok';
      target.lastRunAt = new Date().toISOString();
      target.lastMessage = 'Backup completato con successo';
      await saveStore(freshStore);
      return { success: true, output: logs.filter(Boolean).join('\n'), job: target };
    }
    return { success: true, output: logs.filter(Boolean).join('\n'), job };
  } catch (err) {
    const errMsg =
      err instanceof Error
        ? (err as Error & { stderr?: string }).stderr?.trim() || err.message
        : String(err);
    const freshStore = await readStore();
    const target = freshStore.jobs.find((j) => j.id === job.id);
    if (target) {
      target.lastStatus = 'error';
      target.lastRunAt = new Date().toISOString();
      target.lastMessage = errMsg.slice(0, 300);
      await saveStore(freshStore);
    }
    throw new Error(errMsg);
  } finally {
    runningJobId = null;
  }
}

// Built-in lightweight scheduler for Restic backup jobs (checks every 60s)
export function startBackupScheduler(): void {
  setInterval(async () => {
    if (runningJobId) return;
    try {
      const restic = await getResticVersion();
      if (!restic.installed) return;

      const store = await readStore();
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      const currentHHMM = `${hh}:${mm}`;
      const minuteKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${currentHHMM}`;

      for (const job of store.jobs) {
        if (!job.enabled || job.schedule === 'manual') continue;
        if (lastTriggeredMinute.get(job.id) === minuteKey) continue;

        let shouldRun = false;
        const targetTime = /^\d{2}:\d{2}$/.test(job.scheduleTime) ? job.scheduleTime : '03:00';
        const targetMin = targetTime.split(':')[1] ?? '00';

        if (job.schedule === 'hourly' && mm === targetMin) {
          shouldRun = true;
        } else if (job.schedule === 'daily' && currentHHMM === targetTime) {
          shouldRun = true;
        } else if (
          job.schedule === 'weekly' &&
          now.getDay() === 0 &&
          currentHHMM === targetTime
        ) {
          shouldRun = true;
        }

        if (shouldRun) {
          lastTriggeredMinute.set(job.id, minuteKey);
          executeBackupJob(job.id).catch((err) => {
            console.error(`[Backup] Scheduled job "${job.name}" failed:`, err);
          });
          break; // run one scheduled job at a time
        }
      }
    } catch {
      // ignore transient scheduler read errors
    }
  }, 60_000);
}

// All backup management endpoints require Admin privileges
router.use(requireAdmin);

router.get('/status', async (_req: Request, res: Response) => {
  try {
    const [restic, store] = await Promise.all([getResticVersion(), readStore()]);
    res.json({
      installed: restic.installed,
      version: restic.version,
      runningJobId,
      repos: store.repos.map(sanitizeRepo),
      jobs: store.jobs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Errore stato backup';
    res.status(500).json({ error: message });
  }
});

router.post('/install-restic', async (_req: Request, res: Response) => {
  try {
    await execFileAsync('apt-get', ['update'], {
      timeout: 120_000,
      env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive' },
    });
    await execFileAsync('apt-get', ['install', '-y', 'restic'], {
      timeout: 180_000,
      env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive' },
    });
    const restic = await getResticVersion();
    res.json({ success: true, ...restic });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Installazione Restic fallita';
    res.status(500).json({ error: message });
  }
});

router.post('/repos', async (req: Request, res: Response) => {
  const { name, type, url, password, s3AccessKey, s3SecretKey } = req.body as {
    name?: string;
    type?: 'local' | 'sftp' | 's3';
    url?: string;
    password?: string;
    s3AccessKey?: string;
    s3SecretKey?: string;
  };

  const cleanName = String(name ?? '').trim();
  const cleanUrl = String(url ?? '').trim();
  const cleanPass = String(password ?? '');
  const cleanType = type === 'sftp' || type === 's3' ? type : 'local';

  if (!cleanName || !cleanUrl || cleanPass.length < 4) {
    res.status(400).json({
      error: 'Nome, percorso/URL repository e password (min. 4 caratteri) sono obbligatori',
    });
    return;
  }

  if (cleanType === 'local' && !cleanUrl.startsWith('/')) {
    res.status(400).json({ error: 'Il percorso locale deve iniziare con / (es. /DATA/Backups)' });
    return;
  }

  const repo: BackupRepository = {
    id: `repo-${crypto.randomBytes(4).toString('hex')}`,
    name: cleanName,
    type: cleanType,
    url: cleanUrl,
    password: cleanPass,
    s3AccessKey: s3AccessKey?.trim() || undefined,
    s3SecretKey: s3SecretKey?.trim() || undefined,
    createdAt: new Date().toISOString(),
  };

  try {
    if (cleanType === 'local') {
      await fs.mkdir(cleanUrl, { recursive: true });
    }

    const env = buildResticEnv(repo);
    // Try opening existing repo; if not initialized yet, run `restic init`
    try {
      await execFileAsync('restic', ['snapshots', '--json'], { env, timeout: 15_000 });
    } catch {
      await execFileAsync('restic', ['init'], { env, timeout: 25_000 });
    }

    const store = await readStore();
    store.repos.push(repo);
    await saveStore(store);

    res.json({ success: true, repo: sanitizeRepo(repo) });
  } catch (err) {
    const errMsg =
      err instanceof Error
        ? (err as Error & { stderr?: string }).stderr?.trim() || err.message
        : 'Inizializzazione repository Restic fallita';
    res.status(400).json({ error: errMsg });
  }
});

router.delete('/repos/:id', async (req: Request, res: Response) => {
  const id = String(req.params.id ?? '');
  const store = await readStore();
  store.repos = store.repos.filter((r) => r.id !== id);
  store.jobs = store.jobs.filter((j) => j.repoId !== id);
  await saveStore(store);
  res.json({ success: true });
});

router.get('/repos/:id/snapshots', async (req: Request, res: Response) => {
  const id = String(req.params.id ?? '');
  const store = await readStore();
  const repo = store.repos.find((r) => r.id === id);
  if (!repo) {
    res.status(404).json({ error: 'Repository non trovato' });
    return;
  }

  try {
    const { stdout } = await execFileAsync('restic', ['snapshots', '--json'], {
      env: buildResticEnv(repo),
      timeout: 20_000,
      maxBuffer: 5 * 1024 * 1024,
    });
    const snapshots = (JSON.parse(stdout || '[]') as ResticSnapshot[]).reverse();
    res.json({ snapshots });
  } catch (err) {
    const errMsg =
      err instanceof Error
        ? (err as Error & { stderr?: string }).stderr?.trim() || err.message
        : 'Errore lettura snapshot';
    res.status(500).json({ error: errMsg });
  }
});

router.post('/repos/:id/check', async (req: Request, res: Response) => {
  const id = String(req.params.id ?? '');
  const store = await readStore();
  const repo = store.repos.find((r) => r.id === id);
  if (!repo) {
    res.status(404).json({ error: 'Repository non trovato' });
    return;
  }

  try {
    const { stdout, stderr } = await execFileAsync('restic', ['check'], {
      env: buildResticEnv(repo),
      timeout: 120_000,
    });
    res.json({ success: true, output: (stdout + '\n' + stderr).trim() });
  } catch (err) {
    const errMsg =
      err instanceof Error
        ? (err as Error & { stderr?: string }).stderr?.trim() || err.message
        : 'Verifica integrità fallita';
    res.status(500).json({ error: errMsg });
  }
});

router.post('/repos/:id/restore', async (req: Request, res: Response) => {
  const id = String(req.params.id ?? '');
  const { snapshotId, targetDir } = req.body as { snapshotId?: string; targetDir?: string };
  const cleanSnap = String(snapshotId ?? '').trim();
  const cleanTarget = String(targetDir ?? '').trim();

  if (!/^[a-f0-9]{6,64}$|^latest$/i.test(cleanSnap)) {
    res.status(400).json({ error: 'ID snapshot non valido' });
    return;
  }
  if (!cleanTarget.startsWith('/')) {
    res.status(400).json({ error: 'Cartella di destinazione deve essere un percorso assoluto (/...)' });
    return;
  }

  const store = await readStore();
  const repo = store.repos.find((r) => r.id === id);
  if (!repo) {
    res.status(404).json({ error: 'Repository non trovato' });
    return;
  }

  try {
    await fs.mkdir(cleanTarget, { recursive: true });
    const { stdout, stderr } = await execFileAsync(
      'restic',
      ['restore', cleanSnap, '--target', cleanTarget],
      {
        env: buildResticEnv(repo),
        timeout: 60 * 60 * 1000,
        maxBuffer: 10 * 1024 * 1024,
      }
    );
    res.json({
      success: true,
      targetDir: cleanTarget,
      output: (stdout + '\n' + stderr).trim(),
    });
  } catch (err) {
    const errMsg =
      err instanceof Error
        ? (err as Error & { stderr?: string }).stderr?.trim() || err.message
        : 'Ripristino fallito';
    res.status(500).json({ error: errMsg });
  }
});

router.post('/jobs', async (req: Request, res: Response) => {
  const body = req.body as Partial<BackupJob>;
  const name = String(body.name ?? '').trim();
  const repoId = String(body.repoId ?? '').trim();
  const sources = (Array.isArray(body.sources) ? body.sources : [])
    .map((s) => String(s).trim())
    .filter((s) => s.startsWith('/'));

  if (!name || !repoId || sources.length === 0) {
    res.status(400).json({
      error: 'Nome job, repository e almeno una cartella sorgente sono obbligatori',
    });
    return;
  }

  const store = await readStore();
  if (!store.repos.some((r) => r.id === repoId)) {
    res.status(400).json({ error: 'Repository selezionato non valido' });
    return;
  }

  const existing = body.id ? store.jobs.find((j) => j.id === body.id) : null;
  const nextJob: BackupJob = {
    id: existing?.id ?? `job-${crypto.randomBytes(4).toString('hex')}`,
    name,
    repoId,
    sources,
    excludes: (Array.isArray(body.excludes) ? body.excludes : [])
      .map((e) => String(e).trim())
      .filter(Boolean),
    schedule:
      body.schedule === 'hourly' || body.schedule === 'daily' || body.schedule === 'weekly'
        ? body.schedule
        : 'manual',
    scheduleTime: /^\d{2}:\d{2}$/.test(String(body.scheduleTime ?? ''))
      ? String(body.scheduleTime)
      : '03:00',
    keepDaily: Math.max(0, Number(body.keepDaily ?? 7) || 0),
    keepWeekly: Math.max(0, Number(body.keepWeekly ?? 4) || 0),
    keepMonthly: Math.max(0, Number(body.keepMonthly ?? 6) || 0),
    enabled: body.enabled !== false,
    lastRunAt: existing?.lastRunAt ?? null,
    lastStatus: existing?.lastStatus ?? null,
    lastMessage: existing?.lastMessage ?? null,
  };

  if (existing) {
    const idx = store.jobs.findIndex((j) => j.id === existing.id);
    store.jobs[idx] = nextJob;
  } else {
    store.jobs.push(nextJob);
  }

  await saveStore(store);
  res.json({ success: true, job: nextJob });
});

router.delete('/jobs/:id', async (req: Request, res: Response) => {
  const id = String(req.params.id ?? '');
  const store = await readStore();
  store.jobs = store.jobs.filter((j) => j.id !== id);
  await saveStore(store);
  res.json({ success: true });
});

router.post('/jobs/:id/run', async (req: Request, res: Response) => {
  const id = String(req.params.id ?? '');
  try {
    const result = await executeBackupJob(id);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Esecuzione backup fallita';
    res.status(500).json({ error: message });
  }
});

export default router;
