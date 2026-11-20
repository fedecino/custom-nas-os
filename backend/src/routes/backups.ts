import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import dgram from 'node:dgram';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import { Router, Request, Response } from 'express';
import { DATA_DIR } from '../services/docker.js';
import { requireAdmin } from './auth.js';

const execFileAsync = promisify(execFile);
const router = Router();

const BACKUPS_FILE = path.join(DATA_DIR, '.nas-os', 'backups.json');
const NETWORK_MOUNTS_FILE = path.join(DATA_DIR, '.nas-os', 'network-mounts.json');
const WOL_SSH_KEY_PATH = path.join(DATA_DIR, '.nas-os', 'backup-wol.key');
const WOL_SSH_PUB_PATH = `${WOL_SSH_KEY_PATH}.pub`;

export interface RemotePowerConfig {
  enabled: boolean;
  macAddress: string;
  host: string;
  checkPort: number;
  waitTimeoutSec: number;
  autoMountNetworkName?: string;
  shutdownAfter: boolean;
  shutdownOnlyIfWoken: boolean;
  sshUser: string;
  sshPort: number;
  shutdownCommand: string;
}

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
  remotePower?: RemotePowerConfig;
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

function isValidMac(mac: string): boolean {
  return /^([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}$/.test(mac.trim());
}

async function sendWakeOnLan(macAddress: string): Promise<void> {
  const clean = macAddress.trim();
  if (!isValidMac(clean)) {
    throw new Error('MAC Address non valido (usa formato AA:BB:CC:DD:EE:FF)');
  }
  const macBytes = Buffer.from(clean.replace(/[:-]/g, ''), 'hex');
  const packet = Buffer.alloc(6 + 16 * 6, 0xff);
  for (let i = 0; i < 16; i++) {
    macBytes.copy(packet, 6 + i * 6);
  }

  await new Promise<void>((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    socket.once('error', (err) => {
      socket.close();
      reject(err);
    });
    socket.bind(() => {
      socket.setBroadcast(true);
      let sent = 0;
      const sendOnce = () => {
        socket.send(packet, 0, packet.length, 9, '255.255.255.255', (err) => {
          if (err) {
            socket.close();
            reject(err);
            return;
          }
          sent++;
          if (sent < 3) {
            setTimeout(sendOnce, 200);
          } else {
            socket.close();
            resolve();
          }
        });
      };
      sendOnce();
    });
  });
}

async function isTcpPortOpen(host: string, port: number, timeoutMs = 2500): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
    sock.connect(port, host);
  });
}

async function ensureWolSshKey(): Promise<string> {
  try {
    const existing = (await fs.readFile(WOL_SSH_PUB_PATH, 'utf-8')).trim();
    if (existing) return existing;
  } catch {
    // generate below
  }
  await fs.mkdir(path.dirname(WOL_SSH_KEY_PATH), { recursive: true });
  await execFileAsync(
    'ssh-keygen',
    ['-t', 'ed25519', '-N', '', '-C', 'siloos-backup-wol', '-f', WOL_SSH_KEY_PATH],
    { timeout: 10_000 }
  );
  await fs.chmod(WOL_SSH_KEY_PATH, 0o600).catch(() => {});
  return (await fs.readFile(WOL_SSH_PUB_PATH, 'utf-8')).trim();
}

async function mountSavedNetworkDrive(name: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(NETWORK_MOUNTS_FILE, 'utf-8');
    const list = JSON.parse(raw) as Array<{
      name: string;
      protocol: 'smb' | 'nfs';
      host: string;
      sharePath: string;
      mountpoint: string;
      username?: string;
    }>;
    const entry = list.find((m) => m.name === name);
    if (!entry) return null;

    const procMounts = await fs.readFile('/proc/mounts', 'utf-8').catch(() => '');
    const alreadyMounted = procMounts
      .split('\n')
      .some((l) => l.split(' ')[1]?.replace(/\\040/g, ' ') === entry.mountpoint);
    if (alreadyMounted) return entry.mountpoint;

    await fs.mkdir(entry.mountpoint, { recursive: true });
    if (entry.protocol === 'nfs') {
      const exportPath = entry.sharePath.startsWith('/')
        ? entry.sharePath
        : `/${entry.sharePath}`;
      await execFileAsync('mount', ['-t', 'nfs', `${entry.host}:${exportPath}`, entry.mountpoint], {
        timeout: 15_000,
      });
    } else {
      const shareClean = entry.sharePath.replace(/^\/+/, '');
      const source = `//${entry.host}/${shareClean}`;
      const credsFile = path.join(DATA_DIR, '.nas-os', `netcred-${entry.name}`);
      let opts = 'iocharset=utf8,file_mode=0775,dir_mode=0775';
      try {
        await fs.access(credsFile);
        opts = `credentials=${credsFile},${opts}`;
      } catch {
        opts = `guest,${opts}`;
      }
      await execFileAsync('mount', ['-t', 'cifs', source, entry.mountpoint, '-o', opts], {
        timeout: 15_000,
      });
    }
    return entry.mountpoint;
  } catch (err) {
    throw new Error(
      `Mount disco di rete "${name}" fallito: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

async function unmountPathCleanly(mountpoint: string): Promise<void> {
  await execFileAsync('umount', [mountpoint], { timeout: 10_000 }).catch(() =>
    execFileAsync('umount', ['-l', mountpoint], { timeout: 10_000 }).catch(() => {})
  );
}

async function triggerRemoteShutdown(rp: RemotePowerConfig): Promise<string> {
  await ensureWolSshKey();
  const cmd = rp.shutdownCommand?.trim() || 'sudo -n poweroff || poweroff';
  const port = rp.sshPort > 0 && rp.sshPort <= 65535 ? rp.sshPort : 22;
  const user = rp.sshUser?.trim() || 'root';
  try {
    const { stdout, stderr } = await execFileAsync(
      'ssh',
      [
        '-i',
        WOL_SSH_KEY_PATH,
        '-p',
        String(port),
        '-o',
        'StrictHostKeyChecking=accept-new',
        '-o',
        'BatchMode=yes',
        '-o',
        'ConnectTimeout=10',
        `${user}@${rp.host}`,
        cmd,
      ],
      { timeout: 15_000 }
    );
    return (stdout + '\n' + stderr).trim() || 'Comando spegnimento remoto inviato.';
  } catch (err) {
    // SSH often exits with 255 when remote host powers off immediately
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('closed by remote host') || msg.includes('255')) {
      return 'Comando spegnimento inviato (connessione chiusa dal server remoto).';
    }
    throw err;
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
  const rp = job.remotePower?.enabled ? job.remotePower : null;
  let wasAlreadyAwake = true;
  let mountedTempPath: string | null = null;

  try {
    // Phase 1: Optional Wake-on-LAN & wait for target service port
    if (rp && rp.host && rp.macAddress) {
      const checkPort = rp.checkPort || 2049;
      wasAlreadyAwake = await isTcpPortOpen(rp.host, checkPort, 2500);
      if (wasAlreadyAwake) {
        logs.push(`[WoL] Host remoto ${rp.host}:${checkPort} già acceso e pronto.`);
      } else {
        logs.push(`[WoL] Invio Magic Packet a ${rp.macAddress} per accendere ${rp.host}...`);
        await sendWakeOnLan(rp.macAddress);
        const deadline = Date.now() + Math.max(30, rp.waitTimeoutSec || 150) * 1000;
        let ready = false;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 4000));
          if (await isTcpPortOpen(rp.host, checkPort, 2500)) {
            ready = true;
            break;
          }
        }
        if (!ready) {
          throw new Error(
            `Timeout WoL: ${rp.host}:${checkPort} non è diventato raggiungibile entro ${rp.waitTimeoutSec || 150}s`
          );
        }
        logs.push(`[WoL] Host ${rp.host}:${checkPort} pronto! Attesa 3s stabilizzazione...`);
        await new Promise((r) => setTimeout(r, 3000));
      }

      if (rp.autoMountNetworkName) {
        mountedTempPath = await mountSavedNetworkDrive(rp.autoMountNetworkName);
        if (mountedTempPath) {
          logs.push(`[Mount] Disco di rete montato su ${mountedTempPath}`);
        }
      }
    }

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
    // Always unmount network share cleanly BEFORE powering off the remote host
    if (mountedTempPath) {
      await unmountPathCleanly(mountedTempPath);
      logs.push(`[Mount] Disco di rete smontato (${mountedTempPath}).`);
    }
    if (rp && rp.shutdownAfter && (!rp.shutdownOnlyIfWoken || !wasAlreadyAwake)) {
      try {
        const sdMsg = await triggerRemoteShutdown(rp);
        logs.push(`[Shutdown] ${sdMsg}`);
      } catch (sdErr) {
        logs.push(
          `[Shutdown] Avviso: spegnimento remoto non riuscito (${
            sdErr instanceof Error ? sdErr.message : String(sdErr)
          })`
        );
      }
    }
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

router.get('/ssh-key', async (_req: Request, res: Response) => {
  try {
    const publicKey = await ensureWolSshKey();
    res.json({ publicKey });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Errore generazione chiave SSH';
    res.status(500).json({ error: message });
  }
});

router.post('/wol-test', async (req: Request, res: Response) => {
  const { macAddress } = req.body as { macAddress?: string };
  try {
    await sendWakeOnLan(String(macAddress ?? ''));
    res.json({ success: true, message: `Magic Packet WoL inviato a ${macAddress}` });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invio WoL fallito';
    res.status(400).json({ error: message });
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
    remotePower:
      body.remotePower && body.remotePower.enabled
        ? {
            enabled: true,
            macAddress: String(body.remotePower.macAddress ?? '').trim(),
            host: String(body.remotePower.host ?? '').trim(),
            checkPort: Math.max(1, Math.min(65535, Number(body.remotePower.checkPort ?? 2049) || 2049)),
            waitTimeoutSec: Math.max(30, Math.min(600, Number(body.remotePower.waitTimeoutSec ?? 150) || 150)),
            autoMountNetworkName: body.remotePower.autoMountNetworkName?.trim() || undefined,
            shutdownAfter: Boolean(body.remotePower.shutdownAfter),
            shutdownOnlyIfWoken: body.remotePower.shutdownOnlyIfWoken !== false,
            sshUser: String(body.remotePower.sshUser ?? 'root').trim() || 'root',
            sshPort: Math.max(1, Math.min(65535, Number(body.remotePower.sshPort ?? 22) || 22)),
            shutdownCommand:
              String(body.remotePower.shutdownCommand ?? 'sudo -n poweroff || poweroff').trim() ||
              'sudo -n poweroff || poweroff',
          }
        : undefined,
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
