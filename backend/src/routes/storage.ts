import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { Router, Request, Response } from 'express';
import { DATA_DIR } from '../services/docker.js';
import { systemEvents } from '../services/events.js';

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

router.get('/smart', async (req: Request, res: Response) => {
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

router.post('/mount', async (req: Request, res: Response) => {
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

router.post('/unmount', async (req: Request, res: Response) => {
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

router.post('/format', async (req: Request, res: Response) => {
  const { device, fsType, label, confirm } = req.body as {
    device?: string;
    fsType?: string;
    label?: string;
    confirm?: boolean;
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
    const args = ['-F'];
    if (fsType === 'xfs') args[0] = '-f';
    if (fsType === 'btrfs') args[0] = '-f';
    if (label && SAFE_LABEL_REGEX.test(label)) {
      args.push('-L', label);
    }
    args.push(device);

    const { stdout, stderr } = await execFileAsync(`mkfs.${fsType}`, args, {
      timeout: 60000,
    });
    res.json({ success: true, device, fsType, stdout, stderr });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Format failed';
    res.status(500).json({ error: message });
  }
});

router.get('/browse', async (req: Request, res: Response) => {
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

router.post('/mkdir', async (req: Request, res: Response) => {
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

router.post('/raid/import', async (req: Request, res: Response) => {
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

router.post('/usb-automount', async (req: Request, res: Response) => {
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

export default router;
