import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { Router, Request, Response } from 'express';
import { DATA_DIR } from '../services/docker.js';

const execFileAsync = promisify(execFile);
const router = Router();

const CONFIG_DIR = path.join(DATA_DIR, '.nas-os');
const SHARES_FILE = path.join(CONFIG_DIR, 'shares.json');
const SAMBA_CONF_DIR = '/etc/samba/smb.d';
const SAMBA_NAS_CONF = path.join(SAMBA_CONF_DIR, 'nas-os.conf');
const NFS_EXPORTS_DIR = '/etc/exports.d';
const NFS_NAS_EXPORTS = path.join(NFS_EXPORTS_DIR, 'nas-os.exports');

export type ShareUserPermission = 'none' | 'ro' | 'rw';

export interface NasShare {
  name: string;
  path: string;
  comment: string;
  smb: boolean;
  nfs: boolean;
  ftp: boolean;
  readOnly: boolean;
  guestOk: boolean;
  validUsers: string[];
  userPermissions?: Record<string, ShareUserPermission>;
  nfsClients: string;
}

const SAFE_SHARE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,31}$/;
const ALLOWED_SERVICES = new Set(['smbd', 'nfs-kernel-server', 'vsftpd', 'ssh']);

async function readShares(): Promise<NasShare[]> {
  try {
    const raw = await fs.readFile(SHARES_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as NasShare[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveShares(shares: NasShare[]): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(SHARES_FILE, JSON.stringify(shares, null, 2), 'utf-8');
}

async function applySystemShareConfigs(shares: NasShare[]): Promise<{
  sambaApplied: boolean;
  nfsApplied: boolean;
  warnings: string[];
}> {
  const warnings: string[] = [];
  let sambaApplied = false;
  let nfsApplied = false;

  // 1. Apply Samba configuration
  const smbBlocks = shares
    .filter((s) => s.smb)
    .map((s) => {
      const permEntries = Object.entries(s.userPermissions ?? {}).filter(
        ([u]) => /^[a-z_][a-z0-9_-]{0,30}$/.test(u)
      );
      const hasPerUserPerms = !s.guestOk && permEntries.length > 0;
      const roUsers = permEntries.filter(([, p]) => p === 'ro').map(([u]) => u);
      const rwUsers = permEntries.filter(([, p]) => p === 'rw').map(([u]) => u);
      const allowedUsers = [...roUsers, ...rwUsers];

      const lines = [
        `[${s.name}]`,
        `   comment = ${s.comment || s.name}`,
        `   path = ${s.path}`,
        `   browseable = ${hasPerUserPerms && allowedUsers.length === 0 ? 'no' : 'yes'}`,
        `   access based share enum = yes`,
        `   guest ok = ${s.guestOk ? 'yes' : 'no'}`,
        `   create mask = 0664`,
        `   directory mask = 0775`,
      ];

      if (!s.guestOk) {
        lines.push(`   force user = root`);
      }

      if (hasPerUserPerms) {
        if (allowedUsers.length > 0) {
          lines.push(`   valid users = ${allowedUsers.join(' ')}`);
          if (s.readOnly) {
            lines.push(`   read only = yes`);
          } else {
            lines.push(`   read only = yes`);
            if (rwUsers.length > 0) lines.push(`   write list = ${rwUsers.join(' ')}`);
            if (roUsers.length > 0) lines.push(`   read list = ${roUsers.join(' ')}`);
          }
        } else {
          lines.push(`   valid users = __no_access__`);
          lines.push(`   read only = yes`);
        }
      } else {
        lines.push(`   read only = ${s.readOnly ? 'yes' : 'no'}`);
        if (!s.guestOk && s.validUsers.length > 0) {
          lines.push(`   valid users = ${s.validUsers.join(' ')}`);
        }
      }

      return lines.join('\n');
    })
    .join('\n\n');

  try {
    await fs.mkdir(SAMBA_CONF_DIR, { recursive: true });
    await fs.writeFile(
      SAMBA_NAS_CONF,
      `# Managed by NAS-OS\n${smbBlocks}\n`,
      'utf-8'
    );
    await execFileAsync('systemctl', ['reload-or-restart', 'smbd'], {
      timeout: 5000,
    });
    sambaApplied = true;
  } catch (err) {
    warnings.push(
      `Samba config saved to ${SHARES_FILE}, system reload skipped: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  // 2. Apply NFS exports
  const nfsLines = shares
    .filter((s) => s.nfs)
    .map((s) => {
      const clients = s.nfsClients?.trim() || '*';
      const mode = s.readOnly ? 'ro' : 'rw';
      return `${s.path} ${clients}(${mode},sync,no_subtree_check,no_root_squash)`;
    })
    .join('\n');

  try {
    await fs.mkdir(NFS_EXPORTS_DIR, { recursive: true });
    await fs.writeFile(
      NFS_NAS_EXPORTS,
      `# Managed by NAS-OS\n${nfsLines}\n`,
      'utf-8'
    );
    await execFileAsync('exportfs', ['-ra'], { timeout: 5000 });
    nfsApplied = true;
  } catch (err) {
    warnings.push(
      `NFS config saved to ${SHARES_FILE}, exportfs skipped: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  return { sambaApplied, nfsApplied, warnings };
}

async function getServiceStatus(
  service: string
): Promise<{ name: string; active: boolean; state: string }> {
  try {
    const { stdout } = await execFileAsync('systemctl', ['is-active', service], {
      timeout: 3000,
    });
    const state = stdout.trim();
    return { name: service, active: state === 'active', state };
  } catch {
    return { name: service, active: false, state: 'inactive' };
  }
}

router.get('/', async (_req: Request, res: Response) => {
  try {
    const [shares, smbd, nfs, vsftpd, ssh] = await Promise.all([
      readShares(),
      getServiceStatus('smbd'),
      getServiceStatus('nfs-kernel-server'),
      getServiceStatus('vsftpd'),
      getServiceStatus('ssh'),
    ]);

    res.json({
      shares,
      services: {
        smb: smbd,
        nfs,
        ftp: vsftpd,
        ssh,
        sftp: ssh, // SFTP runs over OpenSSH
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to list shares';
    res.status(500).json({ error: message });
  }
});

router.post('/', async (req: Request, res: Response) => {
  const body = req.body as Partial<NasShare>;
  const name = String(body.name ?? '').trim();
  if (!SAFE_SHARE_NAME.test(name)) {
    res.status(400).json({
      error: 'Invalid share name (1-32 alphanumeric, hyphen, underscore)',
    });
    return;
  }

  const sharePath = body.path?.trim() || path.join(DATA_DIR, 'Shares', name);
  if (!sharePath.startsWith('/')) {
    res.status(400).json({ error: 'Share path must be absolute' });
    return;
  }

  try {
    await fs.mkdir(sharePath, { recursive: true });
    await fs.chmod(sharePath, 0o775).catch(() => {});

    const shares = await readShares();
    const newShare: NasShare = {
      name,
      path: sharePath,
      comment: String(body.comment ?? name),
      smb: Boolean(body.smb ?? true),
      nfs: Boolean(body.nfs ?? false),
      ftp: Boolean(body.ftp ?? false),
      readOnly: Boolean(body.readOnly ?? false),
      guestOk: Boolean(body.guestOk ?? false),
      validUsers: Array.isArray(body.validUsers) ? body.validUsers : [],
      userPermissions:
        body.userPermissions && typeof body.userPermissions === 'object'
          ? body.userPermissions
          : undefined,
      nfsClients: String(body.nfsClients ?? '*'),
    };

    const idx = shares.findIndex((s) => s.name === name);
    if (idx >= 0) {
      shares[idx] = newShare;
    } else {
      shares.push(newShare);
    }

    await saveShares(shares);
    const applyResult = await applySystemShareConfigs(shares);
    res.json({ success: true, share: newShare, ...applyResult });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create share';
    res.status(500).json({ error: message });
  }
});

router.put('/:name/permissions', async (req: Request, res: Response) => {
  const name = String(req.params.name ?? '').trim();
  const body = req.body as {
    userPermissions?: Record<string, ShareUserPermission>;
    readOnly?: boolean;
    guestOk?: boolean;
  };

  try {
    const shares = await readShares();
    const target = shares.find((s) => s.name === name);
    if (!target) {
      res.status(404).json({ error: `Condivisione "${name}" non trovata` });
      return;
    }

    if (typeof body.readOnly === 'boolean') target.readOnly = body.readOnly;
    if (typeof body.guestOk === 'boolean') target.guestOk = body.guestOk;
    if (body.userPermissions && typeof body.userPermissions === 'object') {
      const sanitized: Record<string, ShareUserPermission> = {};
      for (const [user, perm] of Object.entries(body.userPermissions)) {
        if (
          /^[a-z_][a-z0-9_-]{0,30}$/.test(user) &&
          (perm === 'none' || perm === 'ro' || perm === 'rw')
        ) {
          sanitized[user] = perm;
        }
      }
      target.userPermissions = sanitized;
      target.validUsers = Object.entries(sanitized)
        .filter(([, p]) => p === 'ro' || p === 'rw')
        .map(([u]) => u);
    }

    await saveShares(shares);
    const applyResult = await applySystemShareConfigs(shares);
    res.json({ success: true, share: target, ...applyResult });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Aggiornamento permessi fallito';
    res.status(500).json({ error: message });
  }
});

router.delete('/:name', async (req: Request, res: Response) => {
  const name = String(req.params.name ?? '').trim();
  try {
    const shares = await readShares();
    const filtered = shares.filter((s) => s.name !== name);
    await saveShares(filtered);
    const applyResult = await applySystemShareConfigs(filtered);
    res.json({ success: true, ...applyResult });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete share';
    res.status(500).json({ error: message });
  }
});

router.post('/services/:service/:action', async (req: Request, res: Response) => {
  const service = String(req.params.service ?? '');
  const action = String(req.params.action ?? '');

  if (!ALLOWED_SERVICES.has(service)) {
    res.status(400).json({ error: `Unsupported service: ${service}` });
    return;
  }
  if (!['start', 'stop', 'restart', 'enable', 'disable'].includes(action)) {
    res.status(400).json({ error: `Unsupported action: ${action}` });
    return;
  }

  try {
    await execFileAsync('systemctl', [action, service], { timeout: 10000 });
    const status = await getServiceStatus(service);
    res.json({ success: true, service: status });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Service action failed';
    res.status(500).json({ error: message });
  }
});

export default router;
