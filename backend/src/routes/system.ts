import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import { promisify } from 'node:util';
import { Router, Request, Response } from 'express';
import { listContainers } from '../services/docker.js';
import { SystemNotification, systemEvents } from '../services/events.js';

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
  { id: 'nas-os', label: 'NAS-OS Backend', description: 'API Server & Web UI backend (:3000)' },
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
}

router.get('/ports', async (_req: Request, res: Response) => {
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
      });
    }

    ports.sort((a, b) => a.port - b.port);

    res.json({ ports, services: serviceStatuses });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to inspect ports and services';
    res.status(500).json({ error: message });
  }
});

router.post('/services/:name/:action', async (req: Request, res: Response) => {
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

router.get('/logs', async (req: Request, res: Response) => {
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

export default router;
