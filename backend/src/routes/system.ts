import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import { promisify } from 'node:util';
import { Router, Request, Response } from 'express';
import { listContainers } from '../services/docker.js';
import { SystemNotification, systemEvents } from '../services/events.js';
import { auditLog } from '../services/security.js';
import { requireAdmin } from './auth.js';

const execFileAsync = promisify(execFile);
const router = Router();

interface CpuTimes {
  idle: number;
  total: number;
}

function getCpuSnapshot(): CpuTimes {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    idle += cpu.times.idle;
    total +=
      cpu.times.user +
      cpu.times.nice +
      cpu.times.sys +
      cpu.times.idle +
      cpu.times.irq;
  }
  return { idle, total };
}

let lastCpuSnapshot: CpuTimes = getCpuSnapshot();

async function getCpuUsagePercent(): Promise<number> {
  const current = getCpuSnapshot();
  const totalDelta = current.total - lastCpuSnapshot.total;
  const idleDelta = current.idle - lastCpuSnapshot.idle;
  lastCpuSnapshot = current;

  if (totalDelta <= 0) {
    // Take a short 100ms sample on first/rapid call
    const start = getCpuSnapshot();
    await new Promise((r) => setTimeout(r, 100));
    const end = getCpuSnapshot();
    const td = end.total - start.total;
    const id = end.idle - start.idle;
    lastCpuSnapshot = end;
    if (td <= 0) return 0;
    return Math.round(((td - id) / td) * 1000) / 10;
  }

  return Math.round(((totalDelta - idleDelta) / totalDelta) * 1000) / 10;
}

async function getMemoryInfo(): Promise<{
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  usedPercent: number;
}> {
  const totalFallback = os.totalmem();
  const freeFallback = os.freemem();

  try {
    const meminfo = await fs.readFile('/proc/meminfo', 'utf-8');
    const values: Record<string, number> = {};
    for (const line of meminfo.split('\n')) {
      const match = line.match(/^(\w+):\s+(\d+)\s+kB/);
      if (match) {
        values[match[1]] = Number(match[2]) * 1024;
      }
    }

    const totalBytes = values.MemTotal ?? totalFallback;
    const availableBytes = values.MemAvailable ?? values.MemFree ?? freeFallback;
    const usedBytes = Math.max(0, totalBytes - availableBytes);
    const usedPercent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 1000) / 10 : 0;

    return { totalBytes, usedBytes, availableBytes, usedPercent };
  } catch {
    const usedBytes = Math.max(0, totalFallback - freeFallback);
    const usedPercent =
      totalFallback > 0 ? Math.round((usedBytes / totalFallback) * 1000) / 10 : 0;
    return {
      totalBytes: totalFallback,
      usedBytes,
      availableBytes: freeFallback,
      usedPercent,
    };
  }
}

async function getOsPrettyName(): Promise<string> {
  try {
    const content = await fs.readFile('/etc/os-release', 'utf-8');
    const match = content.match(/^PRETTY_NAME="?(.*?)"?$/m);
    if (match?.[1]) return match[1];
  } catch {
    // ignore
  }
  return `${os.type()} ${os.release()}`;
}

export interface MountedDisk {
  filesystem: string;
  fsType: string;
  sizeBytes: number;
  usedBytes: number;
  availableBytes: number;
  usedPercent: number;
  mountpoint: string;
}

async function getMountedDisks(): Promise<MountedDisk[]> {
  const excludedFsTypes = new Set([
    'tmpfs',
    'devtmpfs',
    'squashfs',
    'overlay',
    'efivarfs',
    'proc',
    'sysfs',
    'cgroup',
    'cgroup2',
  ]);

  try {
    const { stdout } = await execFileAsync('df', ['-B1', '-P', '-T'], {
      timeout: 5000,
    });

    const lines = stdout.trim().split('\n').slice(1);
    const disks: MountedDisk[] = [];
    const seenMounts = new Set<string>();

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 7) continue;
      const [filesystem, fsType, sizeStr, usedStr, availStr, pctStr, ...mountParts] = parts;
      const mountpoint = mountParts.join(' ');

      if (excludedFsTypes.has(fsType)) continue;
      if (mountpoint.startsWith('/snap') || mountpoint.startsWith('/var/lib/docker/')) continue;
      if (seenMounts.has(mountpoint)) continue;
      seenMounts.add(mountpoint);

      const sizeBytes = Number(sizeStr) || 0;
      const usedBytes = Number(usedStr) || 0;
      const availableBytes = Number(availStr) || 0;
      const usedPercent = Number(pctStr.replace('%', '')) || 0;

      disks.push({
        filesystem,
        fsType,
        sizeBytes,
        usedBytes,
        availableBytes,
        usedPercent,
        mountpoint,
      });
    }

    return disks;
  } catch {
    return [];
  }
}

async function getBlockDevices(): Promise<unknown[]> {
  try {
    const { stdout } = await execFileAsync(
      'lsblk',
      ['-J', '-b', '-o', 'NAME,SIZE,TYPE,MOUNTPOINT,FSTYPE,MODEL'],
      { timeout: 5000 }
    );
    const parsed = JSON.parse(stdout) as { blockdevices?: unknown[] };
    return parsed.blockdevices ?? [];
  } catch {
    return [];
  }
}

interface NetSample {
  timestampMs: number;
  interfaces: Record<string, { rxBytes: number; txBytes: number }>;
}

let lastNetSample: NetSample | null = null;

async function getNetworkStats(): Promise<{
  rxBytesPerSec: number;
  txBytesPerSec: number;
  totalRxBytes: number;
  totalTxBytes: number;
  interfaces: Array<{
    name: string;
    rxBytes: number;
    txBytes: number;
    rxBytesPerSec: number;
    txBytesPerSec: number;
  }>;
}> {
  try {
    const raw = await fs.readFile('/proc/net/dev', 'utf-8');
    const now = Date.now();
    const currentIfaces: Record<string, { rxBytes: number; txBytes: number }> = {};

    for (const line of raw.split('\n').slice(2)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx <= 0) continue;
      const iface = trimmed.slice(0, colonIdx).trim();
      if (iface === 'lo') continue;

      const cols = trimmed.slice(colonIdx + 1).trim().split(/\s+/);
      if (cols.length < 9) continue;
      const rxBytes = Number(cols[0]) || 0;
      const txBytes = Number(cols[8]) || 0;
      currentIfaces[iface] = { rxBytes, txBytes };
    }

    const elapsedSec = lastNetSample
      ? Math.max(0.2, (now - lastNetSample.timestampMs) / 1000)
      : 1;

    let totalRxBytesPerSec = 0;
    let totalTxBytesPerSec = 0;
    let totalRxBytes = 0;
    let totalTxBytes = 0;

    const interfaces = Object.entries(currentIfaces).map(([name, cur]) => {
      const prev = lastNetSample?.interfaces[name];
      const rxBytesPerSec = prev
        ? Math.max(0, Math.round((cur.rxBytes - prev.rxBytes) / elapsedSec))
        : 0;
      const txBytesPerSec = prev
        ? Math.max(0, Math.round((cur.txBytes - prev.txBytes) / elapsedSec))
        : 0;

      totalRxBytesPerSec += rxBytesPerSec;
      totalTxBytesPerSec += txBytesPerSec;
      totalRxBytes += cur.rxBytes;
      totalTxBytes += cur.txBytes;

      return {
        name,
        rxBytes: cur.rxBytes,
        txBytes: cur.txBytes,
        rxBytesPerSec,
        txBytesPerSec,
      };
    });

    lastNetSample = { timestampMs: now, interfaces: currentIfaces };

    return {
      rxBytesPerSec: totalRxBytesPerSec,
      txBytesPerSec: totalTxBytesPerSec,
      totalRxBytes,
      totalTxBytes,
      interfaces,
    };
  } catch {
    return {
      rxBytesPerSec: 0,
      txBytesPerSec: 0,
      totalRxBytes: 0,
      totalTxBytes: 0,
      interfaces: [],
    };
  }
}

router.get('/info', async (_req: Request, res: Response) => {
  try {
    const cpus = os.cpus();
    const [cpuUsagePercent, memory, osName, disks, blockDevices, network] =
      await Promise.all([
        getCpuUsagePercent(),
        getMemoryInfo(),
        getOsPrettyName(),
        getMountedDisks(),
        getBlockDevices(),
        getNetworkStats(),
      ]);

    res.json({
      hostname: os.hostname(),
      osName,
      arch: os.arch(),
      kernel: os.release(),
      uptimeSeconds: Math.floor(os.uptime()),
      cpu: {
        model: cpus[0]?.model ?? 'Unknown CPU',
        cores: cpus.length,
        usagePercent: cpuUsagePercent,
        loadAverage: os.loadavg().map((n) => Math.round(n * 100) / 100),
      },
      memory,
      disks,
      blockDevices,
      network,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to collect system info';
    res.status(500).json({ error: message });
  }
});

const MANAGED_SYSTEM_SERVICES = [
  { id: 'nas-os', label: 'SiloOs Backend', description: 'API Server & Web UI backend (:3000)' },
  { id: 'nginx', label: 'Nginx Web Server', description: 'Reverse Proxy Web UI (:80)' },
  { id: 'docker', label: 'Docker Engine', description: 'Container runtime' },
  { id: 'smbd', label: 'Samba (SMB/CIFS)', description: 'Condivisione file Windows/macOS' },
  { id: 'nfs-kernel-server', label: 'NFS Server', description: 'Condivisione file Linux/Unix' },
  { id: 'vsftpd', label: 'FTP Server (vsftpd)', description: 'Trasferimento file FTP' },
  { id: 'ssh', label: 'OpenSSH / SFTP', description: 'Accesso terminale e SFTP (:22)' },
  { id: 'avahi-daemon', label: 'Avahi mDNS', description: 'Discovery .local sulla LAN' },
];

export interface ListeningPort {
  protocol: string;
  address: string;
  port: number;
  processName: string;
  pid: string | null;
  containerName: string | null;
  description: string;
}

function describeListeningPort(
  processName: string,
  port: number,
  containerName: string | null
): string {
  if (containerName) {
    return `Container Docker "${containerName}" esposto sulla porta ${port}`;
  }
  const byProcess: Record<string, string> = {
    nginx: 'Web Server & Reverse Proxy SiloOs (interfaccia grafica Web)',
    node: 'SiloOs Backend API Server (comunicazione interna con Nginx)',
    sshd: 'OpenSSH Server — Accesso terminale remoto SSH e trasferimento file SFTP',
    smbd: 'Samba (SMB/CIFS) — Condivisione cartelle di rete per Windows, macOS e Linux',
    nmbd: 'Samba NetBIOS — Annuncio e risoluzione nomi di rete Windows',
    nfsd: 'NFS Server — Condivisione cartelle ad alte prestazioni per Linux/Unix',
    'rpc.mountd': 'NFS Mount Daemon — Gestione mount delle condivisioni NFS',
    rpcbind: 'RPC Portmapper — Servizio di supporto per il protocollo NFS',
    vsftpd: 'FTP Server — Trasferimento file tramite protocollo FTP',
    'avahi-daemon': 'Avahi mDNS — Rilevamento automatico del NAS sulla rete locale (.local)',
    'systemd-resolve': 'Risoluzione DNS locale di sistema',
    'docker-proxy': 'Docker Proxy — Inoltro traffico verso un container Docker',
    dockerd: 'Docker Engine Daemon',
  };
  if (byProcess[processName]) return byProcess[processName];

  const byPort: Record<number, string> = {
    21: 'FTP — Trasferimento file',
    22: 'SSH / SFTP — Accesso terminale e trasferimento file cifrato',
    53: 'DNS — Risoluzione nomi di dominio',
    80: 'HTTP — Interfaccia Web SiloOs',
    111: 'RPCBind — Supporto NFS',
    139: 'SMB/NetBIOS — Condivisione file Windows',
    443: 'HTTPS — Traffico Web cifrato',
    445: 'SMB/CIFS — Condivisione file di rete',
    2049: 'NFS — Condivisione file Linux/Unix',
    3000: 'API Server SiloOs',
    5353: 'mDNS — Rilevamento dispositivi in LAN',
  };
  return byPort[port] ?? `Servizio di sistema (${processName})`;
}

router.get('/ports', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const [ssRes, containers, serviceStatuses] = await Promise.all([
      execFileAsync('ss', ['-tulnp'], { timeout: 5000 }).catch(() => ({ stdout: '' })),
      listContainers().catch(() => []),
      Promise.all(
        MANAGED_SYSTEM_SERVICES.map(async (svc) => {
          try {
            const { stdout } = await execFileAsync('systemctl', ['is-active', svc.id], {
              timeout: 3000,
            });
            const state = stdout.trim();
            return { ...svc, active: state === 'active', state };
          } catch {
            return { ...svc, active: false, state: 'inactive' };
          }
        })
      ),
    ]);

    // Map host port -> container name
    const portToContainer = new Map<number, string>();
    for (const c of containers) {
      if (!c.ports) continue;
      const matches = c.ports.matchAll(/:(\d+)->/g);
      for (const m of matches) {
        const p = Number(m[1]);
        if (p) portToContainer.set(p, c.name);
      }
    }

    const ports: ListeningPort[] = [];
    const seen = new Set<string>();

    for (const line of ssRes.stdout.split('\n').slice(1)) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 5) continue;
      const protocol = cols[0].toUpperCase();
      const localAddr = cols[4];
      const lastColon = localAddr.lastIndexOf(':');
      if (lastColon < 0) continue;

      const address = localAddr.slice(0, lastColon);
      const port = Number(localAddr.slice(lastColon + 1));
      if (!port) continue;

      const procInfo = cols.slice(6).join(' ');
      const procMatch = procInfo.match(/\("([^"]+)",pid=(\d+)/);
      const processName = procMatch?.[1] ?? 'system';
      const pid = procMatch?.[2] ?? null;

      const key = `${protocol}:${port}:${processName}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const containerName =
        processName === 'docker-proxy' || processName === 'dockerd'
          ? portToContainer.get(port) ?? null
          : null;

      ports.push({
        protocol,
        address,
        port,
        processName,
        pid,
        containerName,
        description: describeListeningPort(processName, port, containerName),
      });
    }

    ports.sort((a, b) => a.port - b.port);

    res.json({ ports, services: serviceStatuses });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to inspect ports and services';
    res.status(500).json({ error: message });
  }
});

router.post('/services/:name/:action', requireAdmin, async (req: Request, res: Response) => {
  const name = String(req.params.name ?? '');
  const action = String(req.params.action ?? '');

  if (!MANAGED_SYSTEM_SERVICES.some((s) => s.id === name)) {
    res.status(400).json({ error: `Unsupported service: ${name}` });
    return;
  }
  if (!['start', 'stop', 'restart'].includes(action)) {
    res.status(400).json({ error: `Unsupported action: ${action}` });
    return;
  }

  try {
    await execFileAsync('systemctl', [action, name], { timeout: 10000 });
    res.json({ success: true, name, action });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Service action failed';
    res.status(500).json({ error: message });
  }
});

router.get('/events', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Send recent history immediately
  res.write(
    `event: history\ndata: ${JSON.stringify({ notifications: systemEvents.getHistory() })}\n\n`
  );

  const onNotification = (evt: SystemNotification) => {
    if (!res.writableEnded) {
      res.write(`event: notification\ndata: ${JSON.stringify(evt)}\n\n`);
    }
  };

  systemEvents.on('notification', onNotification);
  const keepAlive = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n');
  }, 25000);

  req.on('close', () => {
    clearInterval(keepAlive);
    systemEvents.off('notification', onNotification);
  });
});

router.get('/logs', requireAdmin, async (req: Request, res: Response) => {
  const unit = String(req.query.unit ?? 'all').trim();
  const lines = Math.min(500, Math.max(20, Number(req.query.lines ?? 150) || 150));

  const allowedUnits = new Set([
    'all',
    'kernel',
    'nas-os',
    'docker',
    'nginx',
    'smbd',
    'nfs-kernel-server',
    'vsftpd',
    'ssh',
  ]);

  if (!allowedUnits.has(unit)) {
    res.status(400).json({ error: `Unsupported log unit: ${unit}` });
    return;
  }

  try {
    const args = ['-n', String(lines), '--no-pager', '-o', 'short-iso'];
    if (unit === 'kernel') {
      args.push('-k');
    } else if (unit !== 'all') {
      args.push('-u', unit);
    }

    const { stdout } = await execFileAsync('journalctl', args, { timeout: 8000 });
    res.json({ unit, lines: stdout.split('\n').filter(Boolean) });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to read system logs';
    res.status(500).json({ error: message });
  }
});

export interface FirewallRule {
  index: number;
  to: string;
  action: string;
  from: string;
}

async function readFirewallStatus(): Promise<{
  installed: boolean;
  enabled: boolean;
  rules: FirewallRule[];
}> {
  try {
    const { stdout } = await execFileAsync('ufw', ['status', 'numbered'], {
      timeout: 5000,
    });
    const enabled = /^Status:\s+active/m.test(stdout);
    const rules: FirewallRule[] = [];

    for (const line of stdout.split('\n')) {
      const m = line.match(/^\[\s*(\d+)\]\s+(.+?)\s{2,}(ALLOW IN|DENY IN|REJECT IN|ALLOW|DENY|REJECT|LIMIT IN)\s+(.+)$/i);
      if (m) {
        rules.push({
          index: Number(m[1]),
          to: m[2].trim(),
          action: m[3].trim(),
          from: m[4].trim(),
        });
      }
    }

    return { installed: true, enabled, rules };
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('ENOENT')) {
      return { installed: false, enabled: false, rules: [] };
    }
    throw err;
  }
}

router.get('/firewall', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const status = await readFirewallStatus();
    res.json(status);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to read firewall status';
    res.status(500).json({ error: message });
  }
});

router.post('/firewall/toggle', requireAdmin, async (req: Request, res: Response) => {
  const enabled = Boolean((req.body as { enabled?: boolean }).enabled);
  try {
    if (enabled) {
      // Ensure Web UI (80/443) and SSH (22) are always allowed before enabling UFW
      await execFileAsync('ufw', ['allow', '80/tcp'], { timeout: 5000 });
      await execFileAsync('ufw', ['allow', '443/tcp'], { timeout: 5000 }).catch(() => {});
      await execFileAsync('ufw', ['allow', '22/tcp'], { timeout: 5000 });
      await execFileAsync('ufw', ['--force', 'enable'], { timeout: 8000 });
    } else {
      await execFileAsync('ufw', ['disable'], { timeout: 8000 });
    }
    await auditLog('firewall.toggle', { enabled, user: (req as Request & { user?: string }).user });
    const status = await readFirewallStatus();
    res.json({ success: true, ...status });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to toggle firewall';
    res.status(500).json({ error: message });
  }
});

router.post('/firewall/rules', requireAdmin, async (req: Request, res: Response) => {
  const { port, protocol, action } = req.body as {
    port?: string | number;
    protocol?: 'tcp' | 'udp' | 'any';
    action?: 'allow' | 'deny';
  };

  const portStr = String(port ?? '').trim();
  if (!/^\d{1,5}(:\d{1,5})?$/.test(portStr)) {
    res.status(400).json({ error: 'Porta non valida (usa es. 8080 o 8000:8010)' });
    return;
  }
  const act = action === 'deny' ? 'deny' : 'allow';
  const target =
    protocol === 'tcp' || protocol === 'udp' ? `${portStr}/${protocol}` : portStr;

  try {
    await execFileAsync('ufw', [act, target], { timeout: 5000 });
    await auditLog('firewall.rule.add', { action: act, target, user: (req as Request & { user?: string }).user });
    const status = await readFirewallStatus();
    res.json({ success: true, ...status });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to add firewall rule';
    res.status(500).json({ error: message });
  }
});

router.delete('/firewall/rules/:index', requireAdmin, async (req: Request, res: Response) => {
  const index = Number(req.params.index);
  if (!Number.isInteger(index) || index < 1) {
    res.status(400).json({ error: 'Invalid rule index' });
    return;
  }

  try {
    await execFileAsync('ufw', ['--force', 'delete', String(index)], {
      timeout: 5000,
    });
    await auditLog('firewall.rule.delete', { index, user: (req as Request & { user?: string }).user });
    const status = await readFirewallStatus();
    res.json({ success: true, ...status });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete firewall rule';
    res.status(500).json({ error: message });
  }
});

router.get('/processes', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const [mem, psRes] = await Promise.all([
      getMemoryInfo(),
      execFileAsync(
        'ps',
        ['-eo', 'pid,user:20,comm,%mem,rss,%cpu,args', '--sort=-rss'],
        { timeout: 5000 }
      ),
    ]);

    const processes = psRes.stdout
      .split('\n')
      .slice(1, 41)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const match = line.match(
          /^(\d+)\s+(\S+)\s+(\S+)\s+([\d.]+)\s+(\d+)\s+([\d.]+)\s+(.*)$/
        );
        if (!match) return null;
        return {
          pid: Number(match[1]),
          user: match[2],
          command: match[3],
          memPercent: Number(match[4]),
          rssBytes: Number(match[5]) * 1024,
          cpuPercent: Number(match[6]),
          args: match[7],
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);

    res.json({ memory: mem, processes });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to list processes';
    res.status(500).json({ error: message });
  }
});

router.get('/reboot-status', async (_req: Request, res: Response) => {
  let rebootRequired = false;
  let packages: string[] = [];
  try {
    await fs.access('/var/run/reboot-required');
    rebootRequired = true;
    const pkgRaw = await fs.readFile('/var/run/reboot-required.pkgs', 'utf-8').catch(() => '');
    packages = pkgRaw
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    rebootRequired = false;
  }
  res.json({ rebootRequired, packages });
});

router.post('/reboot', requireAdmin, async (req: Request, res: Response) => {
  await auditLog('system.reboot', { user: (req as Request & { user?: string }).user });
  res.json({ success: true, message: 'Riavvio del sistema in corso...' });
  setTimeout(() => {
    execFileAsync('systemctl', ['reboot'], { timeout: 5000 }).catch(() => {});
  }, 600);
});

export default router;
