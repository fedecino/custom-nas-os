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

// ---------------------------------------------------------------------------
// Physical Network Interfaces & IPv4 Configuration (NetworkManager / nmcli)
// ---------------------------------------------------------------------------

export interface NetworkInterfaceConfig {
  name: string;
  type: 'ethernet' | 'wifi';
  state: string;
  mac: string;
  speedMbps: number | null;
  carrier: boolean;
  connectionName: string | null;
  connectionUuid: string | null;
  method: 'auto' | 'manual';
  ip: string;
  prefix: number;
  gateway: string;
  dns: string[];
  activeIp: string;
  activePrefix: number;
  activeGateway: string;
  activeDns: string[];
  addresses: Array<{ family: string; address: string; mac: string }>;
}

const VIRTUAL_IFACE_RE = /^(lo|docker\d*|br-|veth|virbr|tun|tap|wg)/;

function splitNmcliTerseLine(line: string): string[] {
  const parts: string[] = [];
  let current = '';
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\' && i + 1 < line.length && (line[i + 1] === ':' || line[i + 1] === '\\')) {
      current += line[i + 1];
      i++;
    } else if (line[i] === ':') {
      parts.push(current);
      current = '';
    } else {
      current += line[i];
    }
  }
  parts.push(current);
  return parts;
}

function isValidIpv4(ip: string): boolean {
  const parts = ip.trim().split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255);
}

function netmaskToPrefix(maskOrPrefix: string | number | undefined): number | null {
  if (typeof maskOrPrefix === 'number') {
    return Number.isInteger(maskOrPrefix) && maskOrPrefix >= 1 && maskOrPrefix <= 32
      ? maskOrPrefix
      : null;
  }
  const raw = String(maskOrPrefix ?? '').trim();
  if (!raw) return null;
  if (/^\d{1,2}$/.test(raw)) {
    const n = Number(raw);
    return n >= 1 && n <= 32 ? n : null;
  }
  if (!isValidIpv4(raw)) return null;
  const bin = raw
    .split('.')
    .map((o) => Number(o).toString(2).padStart(8, '0'))
    .join('');
  if (!/^1*0*$/.test(bin)) return null;
  const ones = bin.indexOf('0');
  const prefix = ones === -1 ? 32 : ones;
  return prefix >= 1 && prefix <= 32 ? prefix : null;
}

async function readSysfsString(filePath: string): Promise<string | null> {
  try {
    return (await fs.readFile(filePath, 'utf-8')).trim();
  } catch {
    return null;
  }
}

async function listPhysicalNetworkInterfaces(): Promise<NetworkInterfaceConfig[]> {
  const osIfaces = os.networkInterfaces();
  const result: NetworkInterfaceConfig[] = [];

  let nmDevices: Array<{ device: string; type: string; state: string; connection: string }> = [];
  let nmConnections: Array<{ uuid: string; name: string; device: string; type: string }> = [];

  try {
    const [devOut, conOut] = await Promise.all([
      execFileAsync('nmcli', ['-t', '-f', 'DEVICE,TYPE,STATE,CONNECTION', 'device', 'status'], {
        timeout: 4000,
      }),
      execFileAsync('nmcli', ['-t', '-f', 'UUID,NAME,DEVICE,TYPE', 'connection', 'show'], {
        timeout: 4000,
      }),
    ]);

    nmDevices = devOut.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map(splitNmcliTerseLine)
      .map(([device, type, state, connection]) => ({
        device: device ?? '',
        type: type ?? '',
        state: state ?? '',
        connection: connection === '--' ? '' : (connection ?? ''),
      }));

    nmConnections = conOut.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map(splitNmcliTerseLine)
      .map(([uuid, name, device, type]) => ({
        uuid: uuid ?? '',
        name: name ?? '',
        device: device === '--' ? '' : (device ?? ''),
        type: type ?? '',
      }));
  } catch {
    // nmcli unavailable (e.g. non-NM dev environment): fallback below
  }

  if (nmDevices.length > 0) {
    const physicalDevs = nmDevices.filter(
      (d) =>
        (d.type === 'ethernet' || d.type === 'wifi') &&
        d.device &&
        !VIRTUAL_IFACE_RE.test(d.device)
    );

    for (const dev of physicalDevs) {
      const osAddrs = (osIfaces[dev.device] ?? [])
        .filter((a) => !a.internal)
        .map((a) => ({ family: a.family, address: a.address, mac: a.mac }));

      const macFromSys = await readSysfsString(`/sys/class/net/${dev.device}/address`);
      const speedRaw = await readSysfsString(`/sys/class/net/${dev.device}/speed`);
      const carrierRaw = await readSysfsString(`/sys/class/net/${dev.device}/carrier`);
      const speedNum = speedRaw && /^\d+$/.test(speedRaw) ? Number(speedRaw) : null;

      const matchedCon =
        nmConnections.find((c) => c.device === dev.device) ??
        nmConnections.find((c) => dev.connection && c.name === dev.connection) ??
        null;

      let method: 'auto' | 'manual' = 'auto';
      let ip = '';
      let prefix = 24;
      let gateway = '';
      let dns: string[] = [];
      let activeIp = '';
      let activePrefix = 24;
      let activeGateway = '';
      let activeDns: string[] = [];

      const conKey = matchedCon?.uuid || dev.connection;
      if (conKey) {
        try {
          const { stdout } = await execFileAsync(
            'nmcli',
            [
              '-t',
              '-f',
              'ipv4.method,ipv4.addresses,ipv4.gateway,ipv4.dns,IP4.ADDRESS,IP4.GATEWAY,IP4.DNS',
              'connection',
              'show',
              conKey,
            ],
            { timeout: 4000 }
          );

          for (const line of stdout.split('\n')) {
            const idx = line.indexOf(':');
            if (idx <= 0) continue;
            const key = line.slice(0, idx).trim();
            const val = line.slice(idx + 1).trim();

            if (key === 'ipv4.method') {
              method = val === 'manual' ? 'manual' : 'auto';
            } else if (key === 'ipv4.addresses' && val && val !== '--') {
              const first = val.split(',')[0].trim();
              const [addr, pfx] = first.split('/');
              if (addr && isValidIpv4(addr)) {
                ip = addr;
                if (pfx && /^\d+$/.test(pfx)) prefix = Number(pfx);
              }
            } else if (key === 'ipv4.gateway' && val && val !== '--') {
              gateway = val;
            } else if (key === 'ipv4.dns' && val && val !== '--') {
              dns = val
                .split(/[,;\s]+/)
                .map((s) => s.trim())
                .filter((s) => isValidIpv4(s));
            } else if (key.startsWith('IP4.ADDRESS') && val && !activeIp) {
              const [addr, pfx] = val.split('/');
              if (addr && isValidIpv4(addr)) {
                activeIp = addr;
                if (pfx && /^\d+$/.test(pfx)) activePrefix = Number(pfx);
              }
            } else if (key === 'IP4.GATEWAY' && val && val !== '--') {
              activeGateway = val;
            } else if (key.startsWith('IP4.DNS') && val && isValidIpv4(val)) {
              activeDns.push(val);
            }
          }
        } catch {
          // ignore per-connection read failure
        }
      }

      if (!activeIp) {
        const v4 = osAddrs.find((a) => a.family === 'IPv4');
        if (v4) activeIp = v4.address;
      }

      result.push({
        name: dev.device,
        type: dev.type === 'wifi' ? 'wifi' : 'ethernet',
        state: dev.state,
        mac: macFromSys || osAddrs[0]?.mac || '',
        speedMbps: speedNum && speedNum > 0 ? speedNum : null,
        carrier: carrierRaw === '1',
        connectionName: matchedCon?.name || dev.connection || null,
        connectionUuid: matchedCon?.uuid || null,
        method,
        ip: ip || activeIp,
        prefix: ip ? prefix : activePrefix,
        gateway: gateway || activeGateway,
        dns: dns.length > 0 ? dns : activeDns,
        activeIp,
        activePrefix,
        activeGateway,
        activeDns,
        addresses: osAddrs,
      });
    }
    return result;
  }

  // Fallback when nmcli is not present
  for (const [name, addrs] of Object.entries(osIfaces)) {
    if (VIRTUAL_IFACE_RE.test(name)) continue;
    const nonInternal = (addrs ?? [])
      .filter((a) => !a.internal)
      .map((a) => ({ family: a.family, address: a.address, mac: a.mac }));
    const v4 = nonInternal.find((a) => a.family === 'IPv4');
    result.push({
      name,
      type: name.startsWith('wl') ? 'wifi' : 'ethernet',
      state: nonInternal.length > 0 ? 'connected' : 'disconnected',
      mac: nonInternal[0]?.mac || '',
      speedMbps: null,
      carrier: nonInternal.length > 0,
      connectionName: null,
      connectionUuid: null,
      method: 'auto',
      ip: v4?.address || '',
      prefix: 24,
      gateway: '',
      dns: [],
      activeIp: v4?.address || '',
      activePrefix: 24,
      activeGateway: '',
      activeDns: [],
      addresses: nonInternal,
    });
  }

  return result;
}

router.get('/network', async (_req: Request, res: Response) => {
  try {
    const interfaces = await listPhysicalNetworkInterfaces();
    res.json({ interfaces });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Impossibile leggere le interfacce di rete';
    res.status(500).json({ error: message });
  }
});

router.put('/network/:iface', async (req: Request, res: Response) => {
  const iface = String(req.params.iface ?? '').trim();
  if (!/^[a-zA-Z0-9._-]{1,32}$/.test(iface) || VIRTUAL_IFACE_RE.test(iface)) {
    res.status(400).json({ error: 'Nome interfaccia di rete non valido' });
    return;
  }

  const { method, ip, prefix, netmask, gateway, dns } = req.body as {
    method?: 'auto' | 'manual';
    ip?: string;
    prefix?: number | string;
    netmask?: string;
    gateway?: string;
    dns?: string[] | string;
  };

  if (method !== 'auto' && method !== 'manual') {
    res.status(400).json({ error: 'Modalità non valida: scegli DHCP (auto) o Manuale (manual)' });
    return;
  }

  const cleanIp = String(ip ?? '').trim();
  const cleanGateway = String(gateway ?? '').trim();
  const resolvedPrefix = netmaskToPrefix(netmask ?? prefix ?? 24);
  const dnsList = (
    Array.isArray(dns) ? dns : String(dns ?? '').split(/[,;\s]+/)
  )
    .map((d) => d.trim())
    .filter(Boolean);

  if (method === 'manual') {
    if (!isValidIpv4(cleanIp)) {
      res.status(400).json({ error: 'Indirizzo IPv4 non valido (es. 192.168.1.50)' });
      return;
    }
    if (!resolvedPrefix) {
      res.status(400).json({ error: 'Subnet mask o prefisso CIDR non valido (es. 255.255.255.0 o 24)' });
      return;
    }
    if (cleanGateway && !isValidIpv4(cleanGateway)) {
      res.status(400).json({ error: 'Gateway predefinito non valido (es. 192.168.1.1)' });
      return;
    }
    for (const d of dnsList) {
      if (!isValidIpv4(d)) {
        res.status(400).json({ error: `Server DNS non valido: ${d}` });
        return;
      }
    }
  }

  try {
    const interfaces = await listPhysicalNetworkInterfaces();
    const target = interfaces.find((i) => i.name === iface);
    if (!target) {
      res.status(404).json({ error: `Interfaccia fisica "${iface}" non trovata` });
      return;
    }

    let conUuid = target.connectionUuid;
    if (!conUuid) {
      if (target.type === 'wifi') {
        res.status(400).json({
          error: 'Connetti prima l\'interfaccia Wi-Fi a una rete prima di modificarne l\'IP',
        });
        return;
      }
      const conName = `SiloOs-${iface}`;
      await execFileAsync(
        'nmcli',
        ['connection', 'add', 'type', 'ethernet', 'ifname', iface, 'con-name', conName],
        { timeout: 5000 }
      );
      const { stdout } = await execFileAsync(
        'nmcli',
        ['-t', '-f', 'UUID', 'connection', 'show', conName],
        { timeout: 4000 }
      );
      conUuid = stdout.trim().split('\n')[0]?.trim() || conName;
    }

    const modifyArgs =
      method === 'auto'
        ? [
            'connection',
            'modify',
            conUuid,
            'ipv4.method',
            'auto',
            'ipv4.addresses',
            '',
            'ipv4.gateway',
            '',
            'ipv4.dns',
            '',
            'ipv4.ignore-auto-dns',
            'no',
          ]
        : [
            'connection',
            'modify',
            conUuid,
            'ipv4.method',
            'manual',
            'ipv4.addresses',
            `${cleanIp}/${resolvedPrefix}`,
            'ipv4.gateway',
            cleanGateway,
            'ipv4.dns',
            dnsList.join(','),
            'ipv4.ignore-auto-dns',
            dnsList.length > 0 ? 'yes' : 'no',
          ];

    await execFileAsync('nmcli', modifyArgs, { timeout: 5000 });

    res.json({
      success: true,
      iface,
      method,
      ip: method === 'manual' ? cleanIp : null,
      prefix: resolvedPrefix ?? 24,
      gateway: cleanGateway,
      dns: dnsList,
    });

    // Apply asynchronously after response is flushed so IP changes don't cut off the HTTP ACK
    setTimeout(() => {
      execFileAsync('nmcli', ['connection', 'up', conUuid!], { timeout: 10000 }).catch((err) => {
        console.error(`[Network] nmcli connection up failed for ${iface}:`, err);
      });
    }, 350);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Errore durante la configurazione di rete';
    res.status(500).json({ error: message });
  }
});

export default router;
