import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { Router, Request, Response } from 'express';
import { DATA_DIR } from '../services/docker.js';
import { systemEvents } from '../services/events.js';
import { requireAdmin } from './auth.js';

const execFileAsync = promisify(execFile);
const router = Router();

const USB_AUTOMOUNT_FLAG = path.join(DATA_DIR, '.nas-os', 'usb-automount.enabled');

const SAFE_DEV_REGEX = /^\/dev\/[a-zA-Z0-9_-]+$/;
const SAFE_LABEL_REGEX = /^[a-zA-Z0-9_-]{1,32}$/;

router.get('/disks', async (_req: Request, res: Response) => {
  try {
    const [lsblkRes, dfRes] = await Promise.allSettled([
      execFileAsync(
        'lsblk',
        [
          '-e',
          '7',
          '-J',
          '-b',
          '-o',
          'NAME,KNAME,SIZE,TYPE,MOUNTPOINT,FSTYPE,MODEL,SERIAL,TRAN,ROTA,RM,LABEL',
        ],
        { timeout: 5000 }
      ),
      execFileAsync('df', ['-B1', '-P', '-T'], { timeout: 5000 }),
    ]);

    let blockdevices: unknown[] = [];
    if (lsblkRes.status === 'fulfilled') {
      try {
        const parsed = JSON.parse(lsblkRes.value.stdout) as {
          blockdevices?: unknown[];
        };
        blockdevices = parsed.blockdevices ?? [];
      } catch {
        blockdevices = [];
      }
    } else {
      // Fallback with minimal columns for older/restricted lsblk
      try {
        const fallback = await execFileAsync(
          'lsblk',
          ['-e', '7', '-J', '-b', '-o', 'NAME,SIZE,TYPE,MOUNTPOINT,FSTYPE,MODEL'],
          { timeout: 5000 }
        );
        const parsed = JSON.parse(fallback.stdout) as {
          blockdevices?: unknown[];
        };
        blockdevices = parsed.blockdevices ?? [];
      } catch {
        blockdevices = [];
      }
    }

    const mounts: Array<{
      filesystem: string;
      fsType: string;
      sizeBytes: number;
      usedBytes: number;
      availableBytes: number;
      usedPercent: number;
      mountpoint: string;
    }> = [];

    if (dfRes.status === 'fulfilled') {
      const excluded = new Set([
        'tmpfs',
        'devtmpfs',
        'squashfs',
        'overlay',
        'efivarfs',
        'proc',
        'sysfs',
      ]);
      for (const line of dfRes.value.stdout.trim().split('\n').slice(1)) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 7) continue;
        const [filesystem, fsType, sizeStr, usedStr, availStr, pctStr, ...mp] = parts;
        if (excluded.has(fsType)) continue;
        mounts.push({
          filesystem,
          fsType,
          sizeBytes: Number(sizeStr) || 0,
          usedBytes: Number(usedStr) || 0,
          availableBytes: Number(availStr) || 0,
          usedPercent: Number(pctStr.replace('%', '')) || 0,
          mountpoint: mp.join(' '),
        });
      }
    }

    res.json({ blockdevices, mounts });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to list disks';
    res.status(500).json({ error: message });
  }
});

router.get('/smart', requireAdmin, async (req: Request, res: Response) => {
  const device = String(req.query.device ?? '').trim();
  if (!SAFE_DEV_REGEX.test(device)) {
    res.status(400).json({ error: 'Invalid device path (expected e.g. /dev/sda)' });
    return;
  }

  try {
    const { stdout } = await execFileAsync('smartctl', ['-H', '-A', '-i', '-j', device], {
      timeout: 8000,
    });
    res.json(JSON.parse(stdout));
  } catch (err: unknown) {
    // smartctl returns non-zero bitmask even when JSON is valid
    const execErr = err as { stdout?: string; message?: string };
    if (execErr.stdout) {
      try {
        res.json(JSON.parse(execErr.stdout));
        return;
      } catch {
        // fall through
      }
    }
    res.status(500).json({
      error: execErr.message ?? 'smartctl failed (requires root privileges and SMART support)',
    });
  }
});

router.post('/mount', requireAdmin, async (req: Request, res: Response) => {
  const { device, label, persistFstab } = req.body as {
    device?: string;
    label?: string;
    persistFstab?: boolean;
  };

  if (!device || !SAFE_DEV_REGEX.test(device)) {
    res.status(400).json({ error: 'Invalid device path' });
    return;
  }
  const cleanLabel = (label || path.basename(device)).trim();
  if (!SAFE_LABEL_REGEX.test(cleanLabel)) {
    res.status(400).json({ error: 'Invalid mount label (use alphanumeric, _, -)' });
    return;
  }

  const mountpoint = path.join(DATA_DIR, 'Disks', cleanLabel);
  try {
    await fs.mkdir(mountpoint, { recursive: true });
    await execFileAsync('mount', [device, mountpoint], { timeout: 10000 });

    if (persistFstab) {
      const { stdout: uuidOut } = await execFileAsync(
        'blkid',
        ['-s', 'UUID', '-o', 'value', device],
        { timeout: 5000 }
      );
      const uuid = uuidOut.trim();
      if (uuid) {
        const fstab = await fs.readFile('/etc/fstab', 'utf-8');
        if (!fstab.includes(uuid)) {
          await fs.appendFile(
            '/etc/fstab',
            `\nUUID=${uuid} ${mountpoint} auto defaults,nofail 0 2\n`,
            'utf-8'
          );
        }
      }
    }

    res.json({ success: true, device, mountpoint });
    systemEvents.notify('success', 'Disco montato', `${device} montato in ${mountpoint}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Mount failed';
    res.status(500).json({ error: message });
  }
});

router.post('/unmount', requireAdmin, async (req: Request, res: Response) => {
  const { mountpoint, removeFstab } = req.body as {
    mountpoint?: string;
    removeFstab?: boolean;
  };
  if (!mountpoint || !mountpoint.startsWith(path.join(DATA_DIR, 'Disks'))) {
    res.status(400).json({
      error: `Only mounts under ${path.join(DATA_DIR, 'Disks')} can be unmounted here`,
    });
    return;
  }

  try {
    await execFileAsync('umount', [mountpoint], { timeout: 10000 });
    if (removeFstab) {
      const fstab = await fs.readFile('/etc/fstab', 'utf-8').catch(() => '');
      if (fstab) {
        const filtered = fstab
          .split('\n')
          .filter((line) => !line.includes(` ${mountpoint} `))
          .join('\n');
        await fs.writeFile('/etc/fstab', filtered, 'utf-8');
      }
    }
    res.json({ success: true, mountpoint });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unmount failed';
    res.status(500).json({ error: message });
  }
});

router.post('/format', requireAdmin, async (req: Request, res: Response) => {
  const { device, fsType, label, confirm, wholeDisk } = req.body as {
    device?: string;
    fsType?: string;
    label?: string;
    confirm?: boolean;
    wholeDisk?: boolean;
  };

  if (!confirm) {
    res.status(400).json({ error: 'Format requires explicit confirmation' });
    return;
  }
  if (!device || !SAFE_DEV_REGEX.test(device)) {
    res.status(400).json({ error: 'Invalid device path' });
    return;
  }

  const allowedFs = new Set(['ext4', 'xfs', 'btrfs']);
  if (!fsType || !allowedFs.has(fsType)) {
    res.status(400).json({ error: 'Supported filesystems: ext4, xfs, btrfs' });
    return;
  }

  try {
    let targetDev = device;

    if (wholeDisk) {
      // Safety check: refuse to wipe any disk containing OS / system mounts
      const { stdout: lsblkRaw } = await execFileAsync(
        'lsblk',
        ['-J', '-o', 'NAME,TYPE,MOUNTPOINT', device],
        { timeout: 5000 }
      );
      const parsed = JSON.parse(lsblkRaw) as {
        blockdevices?: Array<{
          name: string;
          type: string;
          mountpoint?: string | null;
          children?: Array<{ name: string; mountpoint?: string | null }>;
        }>;
      };
      const diskInfo = parsed.blockdevices?.[0];
      if (!diskInfo || diskInfo.type !== 'disk') {
        res.status(400).json({ error: `${device} non è un disco fisico intero` });
        return;
      }

      const protectedMounts = new Set(['/', '/boot', '/boot/efi', '[SWAP]']);
      const allMounts: Array<{ dev: string; mp: string }> = [];
      if (diskInfo.mountpoint) {
        allMounts.push({ dev: `/dev/${diskInfo.name}`, mp: diskInfo.mountpoint });
      }
      for (const ch of diskInfo.children ?? []) {
        if (ch.mountpoint) {
          allMounts.push({ dev: `/dev/${ch.name}`, mp: ch.mountpoint });
        }
      }

      for (const m of allMounts) {
        if (protectedMounts.has(m.mp) || m.mp.startsWith('/boot')) {
          res.status(403).json({
            error: `Impossibile formattare il disco di sistema (${m.mp})`,
          });
          return;
        }
      }

      // Unmount any non-system mounted partitions on this disk first
      for (const m of allMounts) {
        await execFileAsync('umount', [m.mp], { timeout: 10000 });
      }

      // Wipe partition table and create a single GPT partition spanning 100% of disk
      await execFileAsync('wipefs', ['-a', device], { timeout: 15000 }).catch(() => {});
      await execFileAsync('parted', ['-s', device, 'mklabel', 'gpt'], { timeout: 15000 });
      await execFileAsync(
        'parted',
        ['-s', '-a', 'optimal', device, 'mkpart', 'primary', '0%', '100%'],
        { timeout: 15000 }
      );
      await execFileAsync('partprobe', [device], { timeout: 10000 }).catch(() => {});
      await execFileAsync('udevadm', ['settle', '--timeout=5'], { timeout: 8000 }).catch(() => {});

      // Resolve partition device name (/dev/sdX1 or /dev/nvme0n1p1)
      const partSuffix = /\d$/.test(device) ? 'p1' : '1';
      targetDev = `${device}${partSuffix}`;
    }

    const args = ['-F'];
    if (fsType === 'xfs') args[0] = '-f';
    if (fsType === 'btrfs') args[0] = '-f';
    if (label && SAFE_LABEL_REGEX.test(label)) {
      args.push('-L', label);
    }
    args.push(targetDev);

    const { stdout, stderr } = await execFileAsync(`mkfs.${fsType}`, args, {
      timeout: 120000,
    });
    res.json({ success: true, device: targetDev, wholeDisk: Boolean(wholeDisk), fsType, stdout, stderr });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Format failed';
    res.status(500).json({ error: message });
  }
});

router.get('/browse', requireAdmin, async (req: Request, res: Response) => {
  const requested = String(req.query.path ?? DATA_DIR).trim() || DATA_DIR;
  const resolved = path.resolve(requested);

  try {
    const entries = await fs.readdir(resolved, { withFileTypes: true });
    const directories = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => ({
        name: e.name,
        path: path.join(resolved, e.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const parentPath = resolved === '/' ? null : path.dirname(resolved);
    res.json({
      currentPath: resolved,
      parentPath,
      directories,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Cannot read directory';
    res.status(400).json({ error: message });
  }
});

router.post('/mkdir', requireAdmin, async (req: Request, res: Response) => {
  const { parentPath, folderName } = req.body as {
    parentPath?: string;
    folderName?: string;
  };
  const cleanName = String(folderName ?? '').trim();
  if (!cleanName || cleanName.includes('/') || cleanName === '.' || cleanName === '..') {
    res.status(400).json({ error: 'Invalid folder name' });
    return;
  }

  const target = path.join(path.resolve(parentPath || DATA_DIR), cleanName);
  try {
    await fs.mkdir(target, { recursive: true });
    res.json({ success: true, path: target });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create folder';
    res.status(500).json({ error: message });
  }
});

router.get('/raid', async (_req: Request, res: Response) => {
  try {
    const [mdstat, mdScan, zpoolImport, zpoolList] = await Promise.allSettled([
      fs.readFile('/proc/mdstat', 'utf-8'),
      execFileAsync('mdadm', ['--examine', '--scan'], { timeout: 5000 }),
      execFileAsync('zpool', ['import'], { timeout: 5000 }),
      execFileAsync('zpool', ['list', '-H'], { timeout: 5000 }),
    ]);

    const zfsImportable: string[] = [];
    if (zpoolImport.status === 'fulfilled') {
      for (const line of zpoolImport.value.stdout.split('\n')) {
        const m = line.match(/^\s*pool:\s+(.+)$/);
        if (m?.[1]) zfsImportable.push(m[1].trim());
      }
    }

    const zfsActive: string[] = [];
    if (zpoolList.status === 'fulfilled') {
      for (const line of zpoolList.value.stdout.split('\n')) {
        const name = line.trim().split(/\s+/)[0];
        if (name) zfsActive.push(name);
      }
    }

    res.json({
      mdstat: mdstat.status === 'fulfilled' ? mdstat.value : '',
      mdadmScan: mdScan.status === 'fulfilled' ? mdScan.value.stdout.trim() : '',
      zfsImportable,
      zfsActive,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to scan RAID/ZFS';
    res.status(500).json({ error: message });
  }
});

router.post('/raid/import', requireAdmin, async (req: Request, res: Response) => {
  const { type, poolName } = req.body as {
    type?: 'mdadm' | 'zfs';
    poolName?: string;
  };

  try {
    if (type === 'zfs') {
      if (!poolName || !/^[a-zA-Z0-9_-]+$/.test(poolName)) {
        res.status(400).json({ error: 'Invalid ZFS pool name' });
        return;
      }
      const { stdout, stderr } = await execFileAsync('zpool', ['import', '-f', poolName], {
        timeout: 15000,
      });
      systemEvents.notify('success', 'Pool ZFS importato', `Pool "${poolName}" importato.`);
      res.json({ success: true, stdout, stderr });
      return;
    }

    // mdadm assemble
    const { stdout, stderr } = await execFileAsync('mdadm', ['--assemble', '--scan'], {
      timeout: 15000,
    });
    systemEvents.notify('success', 'RAID assemblato', 'Array RAID mdadm importato.');
    res.json({ success: true, stdout, stderr });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'RAID import failed';
    res.status(500).json({ error: message });
  }
});

router.get('/usb-automount', async (_req: Request, res: Response) => {
  try {
    await fs.access(USB_AUTOMOUNT_FLAG);
    res.json({ enabled: true });
  } catch {
    res.json({ enabled: false });
  }
});

router.post('/usb-automount', requireAdmin, async (req: Request, res: Response) => {
  const enabled = Boolean((req.body as { enabled?: boolean }).enabled);
  try {
    await fs.mkdir(path.dirname(USB_AUTOMOUNT_FLAG), { recursive: true });
    if (enabled) {
      await fs.writeFile(USB_AUTOMOUNT_FLAG, '1', 'utf-8');
    } else {
      await fs.rm(USB_AUTOMOUNT_FLAG, { force: true });
    }
    res.json({ success: true, enabled });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update USB automount';
    res.status(500).json({ error: message });
  }
});

// ---------------------------------------------------------------------------
// Network Drives (SMB/CIFS & NFS Mounts under /DATA/Network/<name>)
// ---------------------------------------------------------------------------

export interface NetworkMountEntry {
  name: string;
  protocol: 'smb' | 'nfs';
  host: string;
  sharePath: string;
  mountpoint: string;
  username?: string;
  persistFstab: boolean;
  mounted?: boolean;
}

const NETWORK_MOUNTS_FILE = path.join(DATA_DIR, '.nas-os', 'network-mounts.json');
const NETWORK_MOUNTS_DIR = path.join(DATA_DIR, 'Network');

async function readNetworkMounts(): Promise<NetworkMountEntry[]> {
  try {
    const raw = await fs.readFile(NETWORK_MOUNTS_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as NetworkMountEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveNetworkMounts(list: NetworkMountEntry[]): Promise<void> {
  await fs.mkdir(path.dirname(NETWORK_MOUNTS_FILE), { recursive: true });
  await fs.writeFile(NETWORK_MOUNTS_FILE, JSON.stringify(list, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  });
}

async function getActiveMountpoints(): Promise<Set<string>> {
  try {
    const procMounts = await fs.readFile('/proc/mounts', 'utf-8');
    const set = new Set<string>();
    for (const line of procMounts.split('\n')) {
      const parts = line.split(' ');
      if (parts[1]) set.add(parts[1].replace(/\\040/g, ' '));
    }
    return set;
  } catch {
    return new Set<string>();
  }
}

router.get('/network-mounts', async (_req: Request, res: Response) => {
  try {
    const [mounts, active] = await Promise.all([readNetworkMounts(), getActiveMountpoints()]);
    res.json({
      mounts: mounts.map((m) => ({
        ...m,
        mounted: active.has(m.mountpoint),
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Errore lettura dischi di rete';
    res.status(500).json({ error: message });
  }
});

router.post('/network-mounts', requireAdmin, async (req: Request, res: Response) => {
  const { name, protocol, host, sharePath, username, password, persistFstab } = req.body as {
    name?: string;
    protocol?: 'smb' | 'nfs';
    host?: string;
    sharePath?: string;
    username?: string;
    password?: string;
    persistFstab?: boolean;
  };

  const cleanName = String(name ?? '').trim();
  const cleanProto = protocol === 'nfs' ? 'nfs' : 'smb';
  const cleanHost = String(host ?? '').trim();
  const cleanShare = String(sharePath ?? '').trim();
  const cleanUser = String(username ?? '').trim();
  const cleanPass = String(password ?? '');

  if (!SAFE_LABEL_REGEX.test(cleanName)) {
    res.status(400).json({
      error: 'Nome non valido (usa 1-32 caratteri alfanumerici, - o _)',
    });
    return;
  }
  if (!/^[a-zA-Z0-9._:-]{1,128}$/.test(cleanHost)) {
    res.status(400).json({ error: 'Host o indirizzo IP non valido' });
    return;
  }
  if (!cleanShare) {
    res.status(400).json({ error: 'Percorso condivisione obbligatorio' });
    return;
  }

  const mountpoint = path.join(NETWORK_MOUNTS_DIR, cleanName);

  try {
    await fs.mkdir(mountpoint, { recursive: true });
    let fstabLine = '';

    if (cleanProto === 'smb') {
      const shareClean = cleanShare.replace(/^\/+/, '');
      const source = `//${cleanHost}/${shareClean}`;
      const credsFile = path.join(DATA_DIR, '.nas-os', `netcred-${cleanName}`);
      let opts = 'iocharset=utf8,file_mode=0775,dir_mode=0775';

      if (cleanUser) {
        await fs.mkdir(path.dirname(credsFile), { recursive: true });
        await fs.writeFile(
          credsFile,
          `username=${cleanUser}\npassword=${cleanPass}\n`,
          { encoding: 'utf-8', mode: 0o600 }
        );
        opts = `credentials=${credsFile},${opts}`;
      } else {
        opts = `guest,${opts}`;
      }

      try {
        await execFileAsync('mount', ['-t', 'cifs', source, mountpoint, '-o', `${opts},vers=3.0`], {
          timeout: 15000,
        });
      } catch {
        // Fallback without forcing SMB 3.0 for older NAS/routers
        await execFileAsync('mount', ['-t', 'cifs', source, mountpoint, '-o', opts], {
          timeout: 15000,
        });
      }
      fstabLine = `${source} ${mountpoint} cifs ${opts},_netdev,nofail 0 0`;
    } else {
      const exportPath = cleanShare.startsWith('/') ? cleanShare : `/${cleanShare}`;
      const source = `${cleanHost}:${exportPath}`;
      await execFileAsync('mount', ['-t', 'nfs', source, mountpoint], { timeout: 15000 });
      fstabLine = `${source} ${mountpoint} nfs defaults,_netdev,nofail 0 0`;
    }

    if (persistFstab) {
      try {
        const fstab = await fs.readFile('/etc/fstab', 'utf-8');
        const filtered = fstab
          .split('\n')
          .filter((l) => !l.includes(` ${mountpoint} `))
          .join('\n');
        await fs.writeFile('/etc/fstab', `${filtered.trimEnd()}\n${fstabLine}\n`, 'utf-8');
      } catch {
        // ignore in dev environment
      }
    }

    const entry: NetworkMountEntry = {
      name: cleanName,
      protocol: cleanProto,
      host: cleanHost,
      sharePath: cleanShare,
      mountpoint,
      username: cleanUser || undefined,
      persistFstab: Boolean(persistFstab),
      mounted: true,
    };

    const existing = (await readNetworkMounts()).filter((m) => m.name !== cleanName);
    existing.push(entry);
    await saveNetworkMounts(existing);

    systemEvents.notify(
      'success',
      'Disco di rete montato',
      `${cleanName} (${cleanProto.toUpperCase()}) montato su ${mountpoint}`
    );

    res.json({ success: true, mount: entry });
  } catch (err) {
    const errMsg =
      err instanceof Error
        ? (err as Error & { stderr?: string }).stderr?.trim() || err.message
        : 'Mount disco di rete fallito';
    res.status(500).json({ error: errMsg });
  }
});

router.delete('/network-mounts/:name', requireAdmin, async (req: Request, res: Response) => {
  const cleanName = String(req.params.name ?? '').trim();
  if (!SAFE_LABEL_REGEX.test(cleanName)) {
    res.status(400).json({ error: 'Nome non valido' });
    return;
  }

  const mountpoint = path.join(NETWORK_MOUNTS_DIR, cleanName);
  const credsFile = path.join(DATA_DIR, '.nas-os', `netcred-${cleanName}`);

  try {
    await execFileAsync('umount', [mountpoint], { timeout: 10000 }).catch(() =>
      execFileAsync('umount', ['-l', mountpoint], { timeout: 10000 }).catch(() => {})
    );
    await fs.rm(credsFile, { force: true }).catch(() => {});

    try {
      const fstab = await fs.readFile('/etc/fstab', 'utf-8');
      const filtered = fstab
        .split('\n')
        .filter((l) => !l.includes(` ${mountpoint} `))
        .join('\n');
      await fs.writeFile('/etc/fstab', `${filtered.trimEnd()}\n`, 'utf-8');
    } catch {
      // ignore
    }

    const remaining = (await readNetworkMounts()).filter((m) => m.name !== cleanName);
    await saveNetworkMounts(remaining);
    res.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Errore smontaggio disco di rete';
    res.status(500).json({ error: message });
  }
});

export default router;
