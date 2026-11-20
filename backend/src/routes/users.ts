import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { Router, Request, Response } from 'express';
import { DATA_DIR } from '../services/docker.js';
import { auditLog } from '../services/security.js';
import { requireAdmin, revokeUserSessions } from './auth.js';

const execFileAsync = promisify(execFile);
const router = Router();

const SAFE_USERNAME = /^[a-z_][a-z0-9_-]{1,30}$/;

export interface NasUser {
  username: string;
  uid: number;
  gid: number;
  home: string;
  shell: string;
  groups: string[];
  sambaEnabled: boolean;
}

async function setLinuxPassword(username: string, password: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('chpasswd', []);
    child.stdin.write(`${username}:${password}\n`);
    child.stdin.end();
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`chpasswd exited with code ${code}`));
    });
  });
}

export async function setSambaPassword(username: string, password: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('smbpasswd', ['-a', '-s', username]);
    child.stdin.write(`${password}\n${password}\n`);
    child.stdin.end();
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`smbpasswd exited with code ${code}`));
    });
  });
  await execFileAsync('smbpasswd', ['-e', username], { timeout: 5000 }).catch(() => {});
}

async function getSambaUsers(): Promise<Set<string>> {
  try {
    const { stdout } = await execFileAsync('pdbedit', ['-L'], { timeout: 5000 });
    const set = new Set<string>();
    for (const line of stdout.split('\n')) {
      const user = line.split(':')[0]?.trim();
      if (user) set.add(user);
    }
    return set;
  } catch {
    return new Set<string>();
  }
}

router.get('/', async (_req: Request, res: Response) => {
  try {
    const [passwdRaw, groupRaw, sambaUsers] = await Promise.all([
      fs.readFile('/etc/passwd', 'utf-8'),
      fs.readFile('/etc/group', 'utf-8'),
      getSambaUsers(),
    ]);

    const userGroups = new Map<string, string[]>();
    for (const line of groupRaw.split('\n')) {
      const parts = line.split(':');
      if (parts.length < 4) continue;
      const groupName = parts[0];
      const members = parts[3]
        .split(',')
        .map((m) => m.trim())
        .filter(Boolean);
      for (const m of members) {
        const list = userGroups.get(m) ?? [];
        list.push(groupName);
        userGroups.set(m, list);
      }
    }

    const users: NasUser[] = [];
    for (const line of passwdRaw.split('\n')) {
      const parts = line.split(':');
      if (parts.length < 7) continue;
      const [username, , uidStr, gidStr, , home, shell] = parts;
      const uid = Number(uidStr);
      const gid = Number(gidStr);
      if (uid < 1000 || uid === 65534) continue;

      users.push({
        username,
        uid,
        gid,
        home,
        shell,
        groups: userGroups.get(username) ?? [],
        sambaEnabled: sambaUsers.has(username),
      });
    }

    res.json({ users });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to list users';
    res.status(500).json({ error: message });
  }
});

router.post('/', requireAdmin, async (req: Request, res: Response) => {
  const { username, password, sshAccess, sudoAccess, sambaAccess } = req.body as {
    username?: string;
    password?: string;
    sshAccess?: boolean;
    sudoAccess?: boolean;
    sambaAccess?: boolean;
  };

  const cleanUser = String(username ?? '').trim();
  if (!SAFE_USERNAME.test(cleanUser)) {
    res.status(400).json({
      error: 'Invalid username (lowercase letters, digits, _ or -, 2-31 chars)',
    });
    return;
  }
  if (!password || password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters' });
    return;
  }

  try {
    const shell = sshAccess ? '/bin/bash' : '/usr/sbin/nologin';
    const extraGroups: string[] = [];
    if (sudoAccess) extraGroups.push('sudo');

    const args = ['-m', '-s', shell];
    if (extraGroups.length > 0) {
      args.push('-G', extraGroups.join(','));
    }
    args.push(cleanUser);

    await execFileAsync('useradd', args, { timeout: 10000 });
    await setLinuxPassword(cleanUser, password);
    await fs.mkdir(path.join(DATA_DIR, 'Homes', cleanUser), { recursive: true }).catch(() => {});

    const warnings: string[] = [];
    if (sambaAccess !== false) {
      try {
        await setSambaPassword(cleanUser, password);
      } catch (err) {
        warnings.push(
          `Linux user created, Samba password setup skipped: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }

    res.json({ success: true, username: cleanUser, warnings });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create user';
    res.status(500).json({ error: message });
  }
});

router.put('/:username/password', requireAdmin, async (req: Request, res: Response) => {
  const username = String(req.params.username ?? '').trim();
  const { password, updateSamba } = req.body as {
    password?: string;
    updateSamba?: boolean;
  };

  if (!SAFE_USERNAME.test(username)) {
    res.status(400).json({ error: 'Invalid username' });
    return;
  }
  if (!password || password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters' });
    return;
  }

  try {
    await setLinuxPassword(username, password);
    if (updateSamba !== false) {
      await setSambaPassword(username, password).catch(() => {});
    }
    revokeUserSessions(username);
    await auditLog('users.password.change', { username, by: (req as Request & { user?: string }).user });
    res.json({ success: true, username });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Password update failed';
    res.status(500).json({ error: message });
  }
});

router.delete('/:username', requireAdmin, async (req: Request, res: Response) => {
  const username = String(req.params.username ?? '').trim();
  if (!SAFE_USERNAME.test(username)) {
    res.status(400).json({ error: 'Invalid username' });
    return;
  }

  try {
    await execFileAsync('smbpasswd', ['-x', username]).catch(() => {});
    await execFileAsync('userdel', ['-r', username], { timeout: 10000 });
    revokeUserSessions(username);
    await auditLog('users.delete', { username, by: (req as Request & { user?: string }).user });
    res.json({ success: true, username });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete user';
    res.status(500).json({ error: message });
  }
});

export default router;
