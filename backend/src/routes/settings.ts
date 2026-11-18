import { execFile, spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
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

export interface LoginScreenSettings {
  title: string;
  subtitle: string;
  showClock: boolean;
  showLogo: boolean;
  blurBackground: boolean;
  useCustomWallpaper: boolean;
}

export interface NasUiSettings {
  nasName: string;
  wallpaper: 'silo-landscape' | 'aurora' | 'midnight' | 'ocean' | 'carbon' | 'custom';
  repoUrl: string;
  ai: AiProviderSettings;
  loginScreen: LoginScreenSettings;
}

const DEFAULT_SETTINGS: NasUiSettings = {
  nasName: 'SiloOS',
  wallpaper: 'silo-landscape',
  repoUrl: 'https://github.com/fedecino/custom-nas-os.git',
  ai: {
    enabled: false,
    providerType: 'ollama',
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3.2',
    apiKey: '',
  },
  loginScreen: {
    title: 'SiloOS',
    subtitle: 'Accedi con le credenziali amministratore del NAS',
    showClock: true,
    showLogo: true,
    blurBackground: true,
    useCustomWallpaper: false,
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
      loginScreen: {
        ...DEFAULT_SETTINGS.loginScreen,
        ...(parsed.loginScreen ?? {}),
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
    loginScreen: settings.loginScreen,
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
      const content = (await fs.readFile(file, 'utf-8')).trim().replace(/^v+/i, '');
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
  const { hostname, nasName, wallpaper, repoUrl, ai, loginScreen } = req.body as {
    hostname?: string;
    nasName?: string;
    wallpaper?: NasUiSettings['wallpaper'];
    repoUrl?: string;
    ai?: Partial<AiProviderSettings> & { clearApiKey?: boolean };
    loginScreen?: Partial<LoginScreenSettings>;
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
      loginScreen: {
        ...current.loginScreen,
        ...(loginScreen ?? {}),
        title: loginScreen?.title?.trim() || current.loginScreen.title,
        subtitle: loginScreen?.subtitle?.trim() || current.loginScreen.subtitle,
      },
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

export async function verifySudoUserPassword(
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

function cleanReleaseNotes(raw: string): string {
  return raw
    .split('\n')
    .filter((line) => !/^##\s+\[?\d+\.\d+\.\d+/.test(line.trim()))
    .map((line) =>
      line
        .replace(/\(\[?[a-f0-9]{7,40}\]?\(https?:\/\/[^)]+\)\)/gi, '')
        .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/gi, '$1')
        .replace(/https?:\/\/\S+/gi, '')
        .replace(/^###\s+/, '')
        .replace(/^\*\s+/, '• ')
        .trimEnd()
    )
    .filter((line, idx, arr) => !(line === '' && (idx === 0 || arr[idx - 1] === '')))
    .join('\n')
    .trim();
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
        const rawNotes = gh.body?.trim() || gh.name || '';
        latestReleaseNotes = rawNotes ? cleanReleaseNotes(rawNotes) : null;
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

const UPDATE_STATUS_FILE = '/run/nas-os-update.status';

router.get('/updates/progress', async (_req: Request, res: Response) => {
  try {
    const raw = (await fs.readFile(UPDATE_STATUS_FILE, 'utf-8')).trim();
    const colonIdx = raw.indexOf(':');
    const state = colonIdx > 0 ? raw.slice(0, colonIdx) : raw;
    const message = colonIdx > 0 ? raw.slice(colonIdx + 1) : '';
    res.json({ state, message });
  } catch {
    res.json({ state: 'idle', message: '' });
  }
});

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

  await fs.writeFile(
    UPDATE_STATUS_FILE,
    'running:Avvio aggiornamento di sistema...',
    'utf-8'
  ).catch(() => {});

  // Run in an isolated transient systemd unit so `systemctl restart nas-os` doesn't kill the updater mid-way
  const unitName = `siloos-updater-${Date.now()}`;
  const child = spawn(
    'systemd-run',
    ['--unit', unitName, '--collect', '/usr/local/sbin/nas-os-update', targetRepo],
    {
      detached: true,
      stdio: 'ignore',
    }
  );
  child.on('error', () => {
    const fallback = spawn('/usr/local/sbin/nas-os-update', [targetRepo], {
      detached: true,
      stdio: 'ignore',
    });
    fallback.unref();
  });
  child.unref();

  res.status(202).json({ started: true });
});

const WALLPAPER_PATH = path.join(DATA_DIR, '.nas-os', 'custom-wallpaper');

router.post('/wallpaper', async (req: Request, res: Response) => {
  try {
    await fs.mkdir(path.dirname(WALLPAPER_PATH), { recursive: true });
    const writeStream = createWriteStream(WALLPAPER_PATH);
    req.pipe(writeStream);

    writeStream.on('finish', async () => {
      const current = await readFullSettings();
      current.wallpaper = 'custom';
      await fs.writeFile(SETTINGS_FILE, JSON.stringify(current, null, 2), 'utf-8');
      if (!res.headersSent) {
        res.json({ success: true, settings: sanitizeSettingsForClient(current) });
      }
    });

    writeStream.on('error', (err) => {
      if (!res.headersSent) res.status(500).json({ error: err.message });
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Wallpaper upload failed';
    res.status(500).json({ error: message });
  }
});

router.get('/wallpaper/image', async (_req: Request, res: Response) => {
  try {
    await fs.access(WALLPAPER_PATH);
    res.sendFile(path.resolve(WALLPAPER_PATH));
  } catch {
    res.status(404).end();
  }
});

const LOGIN_WALLPAPER_PATH = path.join(DATA_DIR, '.nas-os', 'login-wallpaper');

router.get('/login-config', async (_req: Request, res: Response) => {
  try {
    const settings = await readFullSettings();
    res.json({
      nasName: settings.nasName,
      wallpaper: settings.wallpaper,
      loginScreen: settings.loginScreen,
    });
  } catch {
    res.json({
      nasName: DEFAULT_SETTINGS.nasName,
      wallpaper: DEFAULT_SETTINGS.wallpaper,
      loginScreen: DEFAULT_SETTINGS.loginScreen,
    });
  }
});

router.post('/login-wallpaper', async (req: Request, res: Response) => {
  try {
    await fs.mkdir(path.dirname(LOGIN_WALLPAPER_PATH), { recursive: true });
    const writeStream = createWriteStream(LOGIN_WALLPAPER_PATH);
    req.pipe(writeStream);

    writeStream.on('finish', async () => {
      const current = await readFullSettings();
      current.loginScreen.useCustomWallpaper = true;
      await fs.writeFile(SETTINGS_FILE, JSON.stringify(current, null, 2), 'utf-8');
      if (!res.headersSent) {
        res.json({ success: true, settings: sanitizeSettingsForClient(current) });
      }
    });

    writeStream.on('error', (err) => {
      if (!res.headersSent) res.status(500).json({ error: err.message });
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Login wallpaper upload failed';
    res.status(500).json({ error: message });
  }
});

router.get('/login-wallpaper/image', async (_req: Request, res: Response) => {
  try {
    await fs.access(LOGIN_WALLPAPER_PATH);
    res.sendFile(path.resolve(LOGIN_WALLPAPER_PATH));
  } catch {
    res.status(404).end();
  }
});

export interface ProxyRoute {
  slug: string;
  path: string;
  target: string;
  stripPrefix: boolean;
}

const PROXY_ROUTES_FILE = path.join(DATA_DIR, '.nas-os', 'proxy-routes.json');
const NGINX_ROUTES_DIR = '/etc/nginx/conf.d/siloos-routes';
const NGINX_ROUTES_CONF = path.join(NGINX_ROUTES_DIR, 'routes.conf');
const NGINX_SITE_CONF = '/etc/nginx/sites-available/nas-os.conf';

async function readProxyRoutes(): Promise<ProxyRoute[]> {
  try {
    const raw = await fs.readFile(PROXY_ROUTES_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as ProxyRoute[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function applyNginxProxyRoutes(routes: ProxyRoute[]): Promise<string[]> {
  const warnings: string[] = [];
  const blocks = routes
    .map((r) => {
      const slug = r.slug;
      const target = r.target.replace(/\/+$/, '');
      const rewriteLine = r.stripPrefix
        ? `        rewrite ^/${slug}(/.*)$ $1 break;\n`
        : '';
      return [
        `location = /${slug} { return 301 /${slug}/; }`,
        `location /${slug}/ {`,
        rewriteLine + `        proxy_pass ${target}${r.stripPrefix ? '' : '/' + slug + '/'};`,
        `        proxy_http_version 1.1;`,
        `        proxy_set_header Host $host;`,
        `        proxy_set_header X-Real-IP $remote_addr;`,
        `        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`,
        `        proxy_set_header X-Forwarded-Proto $scheme;`,
        `        proxy_set_header Upgrade $http_upgrade;`,
        `        proxy_set_header Connection "upgrade";`,
        `}`,
      ].join('\n');
    })
    .join('\n\n');

  try {
    await fs.mkdir(NGINX_ROUTES_DIR, { recursive: true });
    await fs.writeFile(NGINX_ROUTES_CONF, `# Managed by SiloOs\n${blocks}\n`, 'utf-8');

    // Ensure main site config includes siloos-routes
    const siteConf = await fs.readFile(NGINX_SITE_CONF, 'utf-8').catch(() => '');
    if (siteConf && !siteConf.includes('siloos-routes')) {
      const updated = siteConf.replace(
        'location / {',
        'include /etc/nginx/conf.d/siloos-routes/*.conf;\n\n    location / {'
      );
      await fs.writeFile(NGINX_SITE_CONF, updated, 'utf-8');
    }

    await execFileAsync('nginx', ['-t'], { timeout: 5000 });
    await execFileAsync('systemctl', ['reload', 'nginx'], { timeout: 5000 });
  } catch (err) {
    warnings.push(
      `Configurazione salvata in ${PROXY_ROUTES_FILE}, reload Nginx non eseguito: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
  return warnings;
}

router.get('/proxy-routes', async (_req: Request, res: Response) => {
  const routes = await readProxyRoutes();
  res.json({ routes });
});

router.post('/proxy-routes', async (req: Request, res: Response) => {
  const { path: rawPath, target, stripPrefix } = req.body as {
    path?: string;
    target?: string;
    stripPrefix?: boolean;
  };

  const slug = String(rawPath ?? '')
    .trim()
    .replace(/^\/+|\/+$/g, '');
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(slug) || slug === 'api') {
    res.status(400).json({
      error: 'Percorso non valido (usa es. /jellyfin; /api è riservato)',
    });
    return;
  }

  const cleanTarget = String(target ?? '').trim();
  if (!/^https?:\/\/[a-zA-Z0-9.:_-]+$/.test(cleanTarget)) {
    res.status(400).json({
      error: 'Target URL non valido (es. http://127.0.0.1:8096)',
    });
    return;
  }

  const routes = await readProxyRoutes();
  const nextRoute: ProxyRoute = {
    slug,
    path: `/${slug}`,
    target: cleanTarget,
    stripPrefix: Boolean(stripPrefix),
  };

  const idx = routes.findIndex((r) => r.slug === slug);
  if (idx >= 0) routes[idx] = nextRoute;
  else routes.push(nextRoute);

  await fs.mkdir(path.dirname(PROXY_ROUTES_FILE), { recursive: true });
  await fs.writeFile(PROXY_ROUTES_FILE, JSON.stringify(routes, null, 2), 'utf-8');

  const warnings = await applyNginxProxyRoutes(routes);
  res.json({ success: true, routes, warnings });
});

router.delete('/proxy-routes/:slug', async (req: Request, res: Response) => {
  const slug = String(req.params.slug ?? '').trim();
  const routes = (await readProxyRoutes()).filter((r) => r.slug !== slug);
  await fs.mkdir(path.dirname(PROXY_ROUTES_FILE), { recursive: true });
  await fs.writeFile(PROXY_ROUTES_FILE, JSON.stringify(routes, null, 2), 'utf-8');

  const warnings = await applyNginxProxyRoutes(routes);
  res.json({ success: true, routes, warnings });
});

export default router;
