import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import YAML from 'yaml';
import { DATA_DIR, validateComposeYaml } from './docker.js';

export type AppStoreCategory =
  | 'Media'
  | 'Cloud & Documenti'
  | 'Rete & Sicurezza'
  | 'Domotica & AI'
  | 'Download & Utility';

export interface StoreAppTemplate {
  id: string;
  name: string;
  category: AppStoreCategory;
  description: string;
  image: string;
  multiService?: boolean;
  defaultPort?: number;
  composeTemplate: string;
}

const APPSTORE_CACHE_FILE = path.join(DATA_DIR, '.nas-os', 'appstore-cache.json');
const DEFAULT_APPSTORE_REPO =
  'https://raw.githubusercontent.com/fedecino/siloos-appstore/main/apps.json';

const BUILTIN_APPS: StoreAppTemplate[] = [
  {
    id: 'jellyfin',
    name: 'Jellyfin',
    category: 'Media',
    description: 'Media server open source per film, serie TV e musica con transcodifica.',
    image: 'lscr.io/linuxserver/jellyfin',
    defaultPort: 8096,
    composeTemplate: `services:
  jellyfin:
    image: lscr.io/linuxserver/jellyfin:latest
    container_name: jellyfin
    environment:
      - PUID=\${PUID}
      - PGID=\${PGID}
      - TZ=\${TZ}
    volumes:
      - \${APP_DATA}/config:/config
      - \${MEDIA_DIR}:/data/media
    ports:
      - "\${PORT_8096}:8096"
    restart: unless-stopped
`,
  },
  {
    id: 'immich',
    name: 'Immich',
    category: 'Cloud & Documenti',
    description: 'Backup foto e video self-hosted stile Google Foto con ricerca AI (PostgreSQL + Redis + ML).',
    image: 'ghcr.io/immich-app/immich-server',
    multiService: true,
    defaultPort: 2283,
    composeTemplate: `services:
  immich-server:
    container_name: immich_server
    image: ghcr.io/immich-app/immich-server:release
    volumes:
      - \${APP_DATA}/upload:/usr/src/app/upload
      - /etc/localtime:/etc/localtime:ro
    environment:
      - DB_HOSTNAME=immich_postgres
      - DB_USERNAME=postgres
      - DB_PASSWORD=\${RANDOM_PASSWORD}
      - DB_DATABASE_NAME=immich
      - REDIS_HOSTNAME=immich_redis
    ports:
      - "\${PORT_2283}:2283"
    depends_on:
      - redis
      - database
    restart: unless-stopped

  immich-machine-learning:
    container_name: immich_machine_learning
    image: ghcr.io/immich-app/immich-machine-learning:release
    volumes:
      - \${APP_DATA}/model-cache:/cache
    restart: unless-stopped

  redis:
    container_name: immich_redis
    image: docker.io/redis:7-alpine
    restart: unless-stopped

  database:
    container_name: immich_postgres
    image: docker.io/tensorchord/pgvecto-rs:pg14-v0.2.0
    environment:
      - POSTGRES_PASSWORD=\${RANDOM_PASSWORD}
      - POSTGRES_USER=postgres
      - POSTGRES_DB=immich
      - POSTGRES_INITDB_ARGS=--data-checksums
    volumes:
      - \${APP_DATA}/postgres:/var/lib/postgresql/data
    restart: unless-stopped
`,
  },
  {
    id: 'paperless-ngx',
    name: 'Paperless-ngx',
    category: 'Cloud & Documenti',
    description: 'Archivio digitale intelligente con OCR automatico per documenti PDF e fatture.',
    image: 'ghcr.io/paperless-ngx/paperless-ngx',
    multiService: true,
    defaultPort: 8000,
    composeTemplate: `services:
  broker:
    image: docker.io/library/redis:7
    restart: unless-stopped
    volumes:
      - \${APP_DATA}/redis:/data

  db:
    image: docker.io/library/postgres:16-alpine
    restart: unless-stopped
    volumes:
      - \${APP_DATA}/pgdata:/var/lib/postgresql/data
    environment:
      - POSTGRES_DB=paperless
      - POSTGRES_USER=paperless
      - POSTGRES_PASSWORD=\${RANDOM_PASSWORD}

  webserver:
    image: ghcr.io/paperless-ngx/paperless-ngx:latest
    restart: unless-stopped
    depends_on:
      - db
      - broker
    ports:
      - "\${PORT_8000}:8000"
    volumes:
      - \${APP_DATA}/data:/usr/src/paperless/data
      - \${APP_DATA}/media:/usr/src/paperless/media
      - \${APP_DATA}/export:/usr/src/paperless/export
      - \${APP_DATA}/consume:/usr/src/paperless/consume
    environment:
      - PAPERLESS_REDIS=redis://broker:6379
      - PAPERLESS_DBHOST=db
      - PAPERLESS_DBPASS=\${RANDOM_PASSWORD}
      - PAPERLESS_SECRET_KEY=\${RANDOM_SECRET}
      - PAPERLESS_OCR_LANGUAGE=ita+eng
`,
  },
  {
    id: 'nextcloud',
    name: 'Nextcloud',
    category: 'Cloud & Documenti',
    description: 'Cloud personale completo per file, calendario, contatti e sincronizzazione dispositivi.',
    image: 'nextcloud',
    multiService: true,
    defaultPort: 8080,
    composeTemplate: `services:
  db:
    image: mariadb:11
    restart: unless-stopped
    command: --transaction-isolation=READ-COMMITTED --log-bin=binlog --binlog-format=ROW
    volumes:
      - \${APP_DATA}/db:/var/lib/mysql
    environment:
      - MYSQL_ROOT_PASSWORD=\${RANDOM_SECRET}
      - MYSQL_PASSWORD=\${RANDOM_PASSWORD}
      - MYSQL_DATABASE=nextcloud
      - MYSQL_USER=nextcloud

  redis:
    image: redis:alpine
    restart: unless-stopped

  app:
    image: nextcloud:latest
    restart: unless-stopped
    ports:
      - "\${PORT_8080}:80"
    depends_on:
      - db
      - redis
    volumes:
      - \${APP_DATA}/html:/var/www/html
    environment:
      - MYSQL_PASSWORD=\${RANDOM_PASSWORD}
      - MYSQL_DATABASE=nextcloud
      - MYSQL_USER=nextcloud
      - MYSQL_HOST=db
      - REDIS_HOST=redis
`,
  },
  {
    id: 'vaultwarden',
    name: 'Vaultwarden',
    category: 'Rete & Sicurezza',
    description: 'Password manager self-hosted leggero compatibile con tutti i client Bitwarden.',
    image: 'vaultwarden/server',
    defaultPort: 8222,
    composeTemplate: `services:
  vaultwarden:
    image: vaultwarden/server:latest
    container_name: vaultwarden
    restart: unless-stopped
    environment:
      - ADMIN_TOKEN=\${RANDOM_SECRET}
      - SIGNUPS_ALLOWED=true
    volumes:
      - \${APP_DATA}/data:/data
    ports:
      - "\${PORT_8222}:80"
`,
  },
  {
    id: 'adguard-home',
    name: 'AdGuard Home',
    category: 'Rete & Sicurezza',
    description: 'Server DNS per la rete locale con blocco pubblicità, tracker e controllo parentale.',
    image: 'adguard/adguardhome',
    defaultPort: 3005,
    composeTemplate: `services:
  adguardhome:
    image: adguard/adguardhome:latest
    container_name: adguardhome
    restart: unless-stopped
    ports:
      - "53:53/tcp"
      - "53:53/udp"
      - "\${PORT_3005}:3000/tcp"
    volumes:
      - \${APP_DATA}/work:/opt/adguardhome/work
      - \${APP_DATA}/conf:/opt/adguardhome/conf
`,
  },
  {
    id: 'pihole',
    name: 'Pi-hole',
    category: 'Rete & Sicurezza',
    description: 'Blocco pubblicità e statistiche DNS a livello di intera rete locale.',
    image: 'pihole/pihole',
    defaultPort: 8081,
    composeTemplate: `services:
  pihole:
    container_name: pihole
    image: pihole/pihole:latest
    ports:
      - "53:53/tcp"
      - "53:53/udp"
      - "\${PORT_8081}:80/tcp"
    environment:
      - TZ=\${TZ}
      - WEBPASSWORD=\${RANDOM_PASSWORD}
    volumes:
      - \${APP_DATA}/etc-pihole:/etc/pihole
      - \${APP_DATA}/etc-dnsmasq.d:/etc/dnsmasq.d
    restart: unless-stopped
`,
  },
  {
    id: 'home-assistant',
    name: 'Home Assistant',
    category: 'Domotica & AI',
    description: 'Piattaforma open source per domotica, sensori smart home e automazioni locali.',
    image: 'ghcr.io/home-assistant/home-assistant',
    defaultPort: 8123,
    composeTemplate: `services:
  homeassistant:
    container_name: homeassistant
    image: ghcr.io/home-assistant/home-assistant:stable
    volumes:
      - \${APP_DATA}/config:/config
      - /etc/localtime:/etc/localtime:ro
    environment:
      - TZ=\${TZ}
    network_mode: host
    restart: unless-stopped
`,
  },
  {
    id: 'ollama',
    name: 'Ollama',
    category: 'Domotica & AI',
    description: 'Motore AI locale per eseguire Llama, Qwen, Mistral e collegarlo all’Assistente SiloOs.',
    image: 'ollama/ollama',
    defaultPort: 11434,
    composeTemplate: `services:
  ollama:
    image: ollama/ollama:latest
    container_name: ollama
    ports:
      - "\${PORT_11434}:11434"
    volumes:
      - \${APP_DATA}/models:/root/.ollama
    restart: unless-stopped
`,
  },
  {
    id: 'open-webui',
    name: 'Open WebUI',
    category: 'Domotica & AI',
    description: 'Interfaccia chat Web stile ChatGPT per Ollama e modelli AI locali.',
    image: 'ghcr.io/open-webui/open-webui',
    defaultPort: 3080,
    composeTemplate: `services:
  open-webui:
    image: ghcr.io/open-webui/open-webui:main
    container_name: open-webui
    ports:
      - "\${PORT_3080}:8080"
    volumes:
      - \${APP_DATA}/data:/app/backend/data
    restart: unless-stopped
`,
  },
  {
    id: 'plex',
    name: 'Plex Media Server',
    category: 'Media',
    description: 'Media server per organizzare e trasmettere film, serie TV e foto su ogni dispositivo.',
    image: 'lscr.io/linuxserver/plex',
    defaultPort: 32400,
    composeTemplate: `services:
  plex:
    image: lscr.io/linuxserver/plex:latest
    container_name: plex
    network_mode: host
    environment:
      - PUID=\${PUID}
      - PGID=\${PGID}
      - TZ=\${TZ}
      - VERSION=docker
    volumes:
      - \${APP_DATA}/config:/config
      - \${MEDIA_DIR}:/media
    restart: unless-stopped
`,
  },
  {
    id: 'navidrome',
    name: 'Navidrome',
    category: 'Media',
    description: 'Server musicale personale veloce compatibile con app Subsonic/Airsonic.',
    image: 'deluan/navidrome',
    defaultPort: 4533,
    composeTemplate: `services:
  navidrome:
    image: deluan/navidrome:latest
    container_name: navidrome
    ports:
      - "\${PORT_4533}:4533"
    environment:
      - ND_SCANSCHEDULE=1h
    volumes:
      - \${APP_DATA}/data:/data
      - \${MEDIA_DIR}:/music:ro
    restart: unless-stopped
`,
  },
  {
    id: 'qbittorrent',
    name: 'qBittorrent',
    category: 'Download & Utility',
    description: 'Client BitTorrent completo con interfaccia Web moderna.',
    image: 'lscr.io/linuxserver/qbittorrent',
    defaultPort: 8085,
    composeTemplate: `services:
  qbittorrent:
    image: lscr.io/linuxserver/qbittorrent:latest
    container_name: qbittorrent
    environment:
      - PUID=\${PUID}
      - PGID=\${PGID}
      - TZ=\${TZ}
      - WEBUI_PORT=8085
    volumes:
      - \${APP_DATA}/config:/config
      - \${NAS_STORAGE}/Shares/Downloads:/downloads
    ports:
      - "\${PORT_8085}:8085"
      - "6881:6881"
      - "6881:6881/udp"
    restart: unless-stopped
`,
  },
  {
    id: 'syncthing',
    name: 'Syncthing',
    category: 'Download & Utility',
    description: 'Sincronizzazione continua e cifrata di cartelle tra PC, smartphone e NAS.',
    image: 'lscr.io/linuxserver/syncthing',
    defaultPort: 8384,
    composeTemplate: `services:
  syncthing:
    image: lscr.io/linuxserver/syncthing:latest
    container_name: syncthing
    environment:
      - PUID=\${PUID}
      - PGID=\${PGID}
      - TZ=\${TZ}
    volumes:
      - \${APP_DATA}/config:/config
      - \${NAS_STORAGE}/Shares:/data1
    ports:
      - "\${PORT_8384}:8384"
      - "22000:22000/tcp"
      - "22000:22000/udp"
      - "21027:21027/udp"
    restart: unless-stopped
`,
  },
  {
    id: 'uptime-kuma',
    name: 'Uptime Kuma',
    category: 'Rete & Sicurezza',
    description: 'Dashboard elegante per monitorare la disponibilità di servizi, porte e siti Web.',
    image: 'louislam/uptime-kuma',
    defaultPort: 3001,
    composeTemplate: `services:
  uptime-kuma:
    image: louislam/uptime-kuma:1
    container_name: uptime-kuma
    volumes:
      - \${APP_DATA}/data:/app/data
    ports:
      - "\${PORT_3001}:3001"
    restart: unless-stopped
`,
  },
  {
    id: 'portainer',
    name: 'Portainer CE',
    category: 'Download & Utility',
    description: 'Interfaccia grafica avanzata per ispezionare container, volumi e reti Docker.',
    image: 'portainer/portainer-ce',
    defaultPort: 9000,
    composeTemplate: `services:
  portainer:
    image: portainer/portainer-ce:latest
    container_name: portainer
    restart: unless-stopped
    ports:
      - "\${PORT_9000}:9000"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - \${APP_DATA}/data:/data
`,
  },
  {
    id: 'filebrowser',
    name: 'File Browser',
    category: 'Cloud & Documenti',
    description: 'Esplora file Web leggero con condivisione link pubblici temporanei.',
    image: 'filebrowser/filebrowser',
    defaultPort: 8088,
    composeTemplate: `services:
  filebrowser:
    image: filebrowser/filebrowser:latest
    container_name: filebrowser
    ports:
      - "\${PORT_8088}:80"
    volumes:
      - \${NAS_STORAGE}/Shares:/srv
      - \${APP_DATA}/filebrowser.db:/database/filebrowser.db
    restart: unless-stopped
`,
  },
  {
    id: 'nginx-proxy-manager',
    name: 'Nginx Proxy Manager',
    category: 'Rete & Sicurezza',
    description: "Reverse proxy visuale per gestire domini e certificati SSL Let's Encrypt.",
    image: 'jc21/nginx-proxy-manager',
    defaultPort: 81,
    composeTemplate: `services:
  npm:
    image: jc21/nginx-proxy-manager:latest
    container_name: nginx-proxy-manager
    restart: unless-stopped
    ports:
      - "8082:80"
      - "\${PORT_81}:81"
      - "8443:443"
    volumes:
      - \${APP_DATA}/data:/data
      - \${APP_DATA}/letsencrypt:/etc/letsencrypt
`,
  },
];

async function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => {
      srv.close(() => resolve(true));
    });
    srv.listen(port, '0.0.0.0');
  });
}

async function findFreePort(preferred: number): Promise<number> {
  let candidate = preferred;
  for (let i = 0; i < 40; i++) {
    if (await isPortFree(candidate)) return candidate;
    candidate++;
  }
  return preferred;
}

export async function getAppStoreCatalog(): Promise<{
  apps: StoreAppTemplate[];
  categories: string[];
  lastSynced: string | null;
}> {
  let cachedApps: StoreAppTemplate[] = [];
  let lastSynced: string | null = null;

  try {
    const raw = await fs.readFile(APPSTORE_CACHE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as {
      apps?: StoreAppTemplate[];
      lastSynced?: string;
    };
    if (Array.isArray(parsed.apps)) {
      cachedApps = parsed.apps;
      lastSynced = parsed.lastSynced ?? null;
    }
  } catch {
    // use built-in catalog
  }

  const mergedMap = new Map<string, StoreAppTemplate>();
  for (const app of BUILTIN_APPS) mergedMap.set(app.id, app);
  for (const app of cachedApps) {
    if (app?.id && app?.composeTemplate) {
      mergedMap.set(app.id, app);
    }
  }

  const apps = Array.from(mergedMap.values());
  const categories = Array.from(new Set(apps.map((a) => a.category)));
  return { apps, categories, lastSynced };
}

export async function syncAppStoreFromRepo(repoUrl?: string): Promise<{
  syncedCount: number;
  lastSynced: string;
}> {
  const targetUrl = (repoUrl?.trim() || DEFAULT_APPSTORE_REPO).trim();
  const res = await fetch(targetUrl, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    throw new Error(`Impossibile scaricare il catalogo (${res.status})`);
  }
  const data = (await res.json()) as { apps?: StoreAppTemplate[] } | StoreAppTemplate[];
  const list = Array.isArray(data) ? data : (data.apps ?? []);
  const valid = list.filter(
    (a) => a && typeof a.id === 'string' && typeof a.composeTemplate === 'string'
  );

  const lastSynced = new Date().toISOString();
  await fs.mkdir(path.dirname(APPSTORE_CACHE_FILE), { recursive: true });
  await fs.writeFile(
    APPSTORE_CACHE_FILE,
    JSON.stringify({ lastSynced, apps: valid }, null, 2),
    'utf-8'
  );
  return { syncedCount: valid.length, lastSynced };
}

export async function renderStoreAppCompose(appId: string): Promise<{
  app: StoreAppTemplate;
  composeYaml: string;
  resolvedPort: number | null;
}> {
  const { apps } = await getAppStoreCatalog();
  const app = apps.find((a) => a.id === appId);
  if (!app) {
    throw new Error(`App "${appId}" non trovata nello Store`);
  }

  // Generate consistent random secrets per render call (same password reused within the same compose)
  const randomPassword = crypto.randomBytes(16).toString('base64url');
  const randomSecret = crypto.randomBytes(24).toString('hex');
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Rome';

  let yamlText = app.composeTemplate
    .replace(/\$\{NAS_STORAGE\}/g, DATA_DIR)
    .replace(/\$\{APP_DATA\}/g, path.join(DATA_DIR, 'AppData', app.id))
    .replace(/\$\{MEDIA_DIR\}/g, path.join(DATA_DIR, 'Media'))
    .replace(/\$\{RANDOM_PASSWORD\}/g, randomPassword)
    .replace(/\$\{RANDOM_SECRET\}/g, randomSecret)
    .replace(/\$\{PUID\}/g, '1000')
    .replace(/\$\{PGID\}/g, '1000')
    .replace(/\$\{TZ\}/g, tz);

  let resolvedPort: number | null = app.defaultPort ?? null;
  const portMatches = [...yamlText.matchAll(/\$\{PORT_(\d+)\}/g)];
  for (const m of portMatches) {
    const preferred = Number(m[1]);
    const free = await findFreePort(preferred);
    if (resolvedPort === preferred || resolvedPort === null) {
      resolvedPort = free;
    }
    yamlText = yamlText.replace(new RegExp(`\\$\\{PORT_${m[1]}\\}`, 'g'), String(free));
  }

  // Validate YAML syntax before returning
  YAML.parse(yamlText);
  return { app, composeYaml: yamlText, resolvedPort };
}

export async function fetchComposeFromUrl(rawUrl: string): Promise<string> {
  const trimmed = rawUrl.trim();
  if (!/^https?:\/\/.+/.test(trimmed)) {
    throw new Error('Inserisci un URL http:// o https:// valido');
  }
  const res = await fetch(trimmed, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) {
    throw new Error(`Download YAML fallito (HTTP ${res.status})`);
  }
  const content = await res.text();
  validateComposeYaml(content);
  return content;
}
