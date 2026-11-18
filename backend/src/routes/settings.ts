import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { Router, Request, Response } from 'express';
import { DATA_DIR } from '../services/docker.js';

const execFileAsync = promisify(execFile);
const router = Router();

const SETTINGS_FILE = path.join(DATA_DIR, '.nas-os', 'settings.json');

export interface AiProviderSettings {
  enabled: boolean;
  providerType: 'ollama' | 'lmstudio' | 'openai' | 'gemini' | 'custom';
  baseUrl: string;
  model: string;
  apiKey: string;
}

export interface NasUiSettings {
  nasName: string;
  wallpaper: 'aurora' | 'midnight' | 'ocean' | 'carbon';
  repoUrl: string;
  ai: AiProviderSettings;
}

const DEFAULT_SETTINGS: NasUiSettings = {
  nasName: 'NAS-OS',
  wallpaper: 'aurora',
  repoUrl: 'https://github.com/fedecino/custom-nas-os.git',
  ai: {
    enabled: false,
    providerType: 'ollama',
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3.2',
    apiKey: '',
  },
};

export async function readFullSettings(): Promise<NasUiSettings> {
  try {
    const raw = await fs.readFile(SETTINGS_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<NasUiSettings>;
    return {
      nasName: parsed.nasName ?? DEFAULT_SETTINGS.nasName,
      wallpaper: parsed.wallpaper ?? DEFAULT_SETTINGS.wallpaper,
      repoUrl: parsed.repoUrl ?? DEFAULT_SETTINGS.repoUrl,
      ai: {
        ...DEFAULT_SETTINGS.ai,
        ...(parsed.ai ?? {}),
      },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function sanitizeSettingsForClient(settings: NasUiSettings) {
  const key = settings.ai.apiKey || '';
  const maskedKey =
    key.length > 8
      ? `${key.slice(0, 4)}...${key.slice(-4)}`
      : key.length > 0
        ? '****'
        : '';

  return {
    nasName: settings.nasName,
    wallpaper: settings.wallpaper,
    repoUrl: settings.repoUrl,
    ai: {
      enabled: settings.ai.enabled,
      providerType: settings.ai.providerType,
      baseUrl: settings.ai.baseUrl,
      model: settings.ai.model,
      hasApiKey: key.length > 0,
      apiKeyPreview: maskedKey,
    },
  };
}

async function getInstalledVersion(): Promise<string> {
  const candidates = [
    '/opt/nas-os/VERSION',
    '/opt/nas-os/src/VERSION',
    path.resolve(process.cwd(), '../VERSION'),
  ];
  for (const file of candidates) {
    try {
      const content = (await fs.readFile(file, 'utf-8')).trim().replace(/^v/, '');
      if (content) return content;
    } catch {
      // try next
    }
  }
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', '/opt/nas-os/src', 'describe', '--tags', '--abbrev=0'],
      { timeout: 3000 }
    );
    const tag = stdout.trim().replace(/^v/, '');
    if (tag) return tag;
  } catch {
    // ignore
  }
  return '1.0.0';
}

function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('-')[0].split('.').map((n) => Number(n) || 0);
  const pb = b.replace(/^v/, '').split('-')[0].split('.').map((n) => Number(n) || 0);
  for (let i = 0; i < 3; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da < db) return -1;
    if (da > db) return 1;
  }
  return 0;
}

router.get('/', async (_req: Request, res: Response) => {
  try {
    const [settings, version] = await Promise.all([
      readFullSettings(),
      getInstalledVersion(),
    ]);
    const interfaces = os.networkInterfaces();
    const netSummary = Object.entries(interfaces)
      .filter(([name]) => name !== 'lo')
      .map(([name, addrs]) => ({
        name,
        addresses: (addrs ?? [])
          .filter((a) => !a.internal)
          .map((a) => ({ family: a.family, address: a.address, mac: a.mac })),
      }));

    res.json({
      hostname: os.hostname(),
      version,
      settings: sanitizeSettingsForClient(settings),
      network: netSummary,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to read settings';
    res.status(500).json({ error: message });
  }
});

router.put('/', async (req: Request, res: Response) => {
  const { hostname, nasName, wallpaper, repoUrl, ai } = req.body as {
    hostname?: string;
    nasName?: string;
    wallpaper?: NasUiSettings['wallpaper'];
    repoUrl?: string;
    ai?: Partial<AiProviderSettings> & { clearApiKey?: boolean };
  };

  try {
    const current = await readFullSettings();

    let nextApiKey = current.ai.apiKey;
    if (ai?.clearApiKey) {
      nextApiKey = '';
    } else if (typeof ai?.apiKey === 'string' && ai.apiKey.trim().length > 0) {
      nextApiKey = ai.apiKey.trim();
    }

    const updated: NasUiSettings = {
      nasName: nasName?.trim() || current.nasName,
      wallpaper: wallpaper || current.wallpaper,
      repoUrl: repoUrl?.trim() || current.repoUrl,
      ai: {
        enabled: ai?.enabled ?? current.ai.enabled,
        providerType: ai?.providerType ?? current.ai.providerType,
        baseUrl: ai?.baseUrl?.trim() || current.ai.baseUrl,
        model: ai?.model?.trim() || current.ai.model,
        apiKey: nextApiKey,
      },
    };

    await fs.mkdir(path.dirname(SETTINGS_FILE), { recursive: true });
    await fs.writeFile(SETTINGS_FILE, JSON.stringify(updated, null, 2), 'utf-8');

    const warnings: string[] = [];
    if (hostname && /^[a-zA-Z0-9-]{1,63}$/.test(hostname.trim())) {
      try {
        await execFileAsync('hostnamectl', ['set-hostname', hostname.trim()], {
          timeout: 5000,
        });
      } catch (err) {
        warnings.push(
          `Hostname change skipped: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    res.json({
      success: true,
      settings: sanitizeSettingsForClient(updated),
      warnings,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to save settings';
    res.status(500).json({ error: message });
  }
});

const SRC_DIR = '/opt/nas-os/src';

async function verifySudoUserPassword(
  username: string,
  password: string
): Promise<boolean> {
  if (!/^[a-z_][a-z0-9_-]{0,30}$/.test(username) || !password) {
    return false;
  }

  try {
    const [groupRaw, shadowRaw] = await Promise.all([
      fs.readFile('/etc/group', 'utf-8'),
      fs.readFile('/etc/shadow', 'utf-8'),
    ]);

    // Check user is in sudo group (or is root)
    if (username !== 'root') {
      const sudoLine = groupRaw.split('\n').find((l) => l.startsWith('sudo:'));
      const members = sudoLine?.split(':')[3]?.split(',') ?? [];
      if (!members.includes(username)) {
        return false;
      }
    }

    const shadowLine = shadowRaw
      .split('\n')
      .find((l) => l.startsWith(`${username}:`));
    const hash = shadowLine?.split(':')[1];
    if (!hash || hash.startsWith('!') || hash.startsWith('*')) {
      return false;
    }

    await execFileAsync(
      'perl',
      ['-e', 'exit(crypt($ARGV[0], $ARGV[1]) eq $ARGV[1] ? 0 : 1)', password, hash],
      { timeout: 3000 }
    );
    return true;
  } catch {
    return false;
  }
}

router.get('/updates', async (_req: Request, res: Response) => {
  const [settings, installedVersion] = await Promise.all([
    readFullSettings(),
    getInstalledVersion(),
  ]);

  let latestReleaseVersion: string | null = null;
  let latestReleaseDate: string | null = null;
  let latestReleaseNotes: string | null = null;

  try {
    const match = settings.repoUrl.match(/github\.com\/([^/]+\/[^/.]+)/);
    if (match?.[1]) {
      const ghRes = await fetch(
        `https://api.github.com/repos/${match[1]}/releases/latest`,
        {
          headers: { Accept: 'application/vnd.github+json' },
          signal: AbortSignal.timeout(5000),
        }
      );
      if (ghRes.ok) {
        const gh = (await ghRes.json()) as {
          tag_name?: string;
          published_at?: string;
          body?: string;
          name?: string;
        };
        latestReleaseVersion = (gh.tag_name ?? gh.name ?? '').replace(/^v/, '') || null;
        latestReleaseDate = gh.published_at ?? null;
        latestReleaseNotes = gh.body?.trim() || gh.name || null;
      }
    }
  } catch {
    // GitHub API unavailable
  }

  const updateAvailable =
    latestReleaseVersion !== null &&
    compareSemver(installedVersion, latestReleaseVersion) < 0;

  res.json({
    installedVersion,
    latestReleaseVersion,
    latestReleaseDate,
    latestReleaseNotes,
    updateAvailable,
  });
});

async function verifyAnySudoPassword(
  password: string,
  preferredUsername?: string
): Promise<boolean> {
  if (!password) return false;

  if (preferredUsername) {
    return verifySudoUserPassword(preferredUsername, password);
  }

  try {
    const groupRaw = await fs.readFile('/etc/group', 'utf-8');
    const sudoLine = groupRaw.split('\n').find((l) => l.startsWith('sudo:'));
    const members = (sudoLine?.split(':')[3]?.split(',') ?? [])
      .map((m) => m.trim())
      .filter(Boolean);

    const candidates = Array.from(new Set([...members, 'root']));
    for (const user of candidates) {
      if (await verifySudoUserPassword(user, password)) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

router.post('/updates/apply', async (req: Request, res: Response) => {
  const { username, password, repoUrl } = req.body as {
    username?: string;
    password?: string;
    repoUrl?: string;
  };

  const valid = await verifyAnySudoPassword(
    String(password ?? ''),
    username ? String(username).trim() : undefined
  );

  if (!valid) {
    res.status(401).json({
      error: 'Password amministratore non valida',
    });
    return;
  }

  const settings = await readFullSettings();
  const targetRepo = (repoUrl?.trim() || settings.repoUrl).trim();

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

  sendEvent('log', { message: 'Autenticazione confermata. Avvio nas-os-update...' });

  const child = spawn('/usr/local/sbin/nas-os-update', [targetRepo], {
    env: { ...process.env, FORCE_COLOR: '0' },
  });

  child.stdout.on('data', (chunk: Buffer) => {
    sendEvent('log', { message: chunk.toString('utf-8') });
  });

  child.stderr.on('data', (chunk: Buffer) => {
    sendEvent('log', { message: chunk.toString('utf-8') });
  });

  child.on('error', (err) => {
    sendEvent('error', { message: err.message });
    if (!res.writableEnded) res.end();
  });

  child.on('close', (code) => {
    sendEvent('done', { exitCode: code ?? 0, success: code === 0 });
    if (!res.writableEnded) res.end();
  });
});

export default router;
