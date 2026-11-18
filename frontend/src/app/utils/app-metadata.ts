const ICON_ALIASES: Record<string, string> = {
  adguardhome: 'adguard-home',
  'adguard-home': 'adguard-home',
  'portainer-ce': 'portainer',
  'portainer-ee': 'portainer',
  'home-assistant': 'home-assistant',
  homeassistant: 'home-assistant',
  'pms-docker': 'plex',
  postgres: 'postgresql',
  postgresql: 'postgresql',
  'nginx-proxy-manager': 'nginx-proxy-manager',
  npm: 'nginx-proxy-manager',
  'uptime-kuma': 'uptime-kuma',
  'open-webui': 'open-webui',
  'actual-server': 'actual-budget',
  'calibre-web': 'calibre-web',
  'paperless-ngx': 'paperless-ngx',
  'wg-easy': 'wireguard',
  'immich-server': 'immich',
  'gitea-rootless': 'gitea',
  'jellyfin-server': 'jellyfin',
  'ollama-server': 'ollama',
  'qbittorrent-nox': 'qbittorrent',
};

const APP_DESCRIPTIONS: Record<string, string> = {
  jellyfin: 'Media server per film, serie TV e musica',
  plex: 'Media server per streaming multimediale',
  emby: 'Media server personale per video e musica',
  'paperless-ngx': 'Archivio digitale e OCR per documenti',
  nextcloud: 'Cloud personale per file, foto e calendari',
  owncloud: 'Piattaforma cloud privata per file e sync',
  vaultwarden: 'Password manager compatibile Bitwarden',
  pihole: 'Blocco pubblicità e tracker DNS in LAN',
  'adguard-home': 'DNS server con blocco pubblicità e privacy',
  'home-assistant': 'Domotica e automazione smart home',
  homebridge: 'Integrazione dispositivi smart con Apple HomeKit',
  immich: 'Backup e galleria foto/video self-hosted',
  photoprism: 'Galleria foto AI con ricerca intelligente',
  portainer: 'Gestione visuale di container e stack Docker',
  nginx: 'Web server e reverse proxy HTTP ad alte prestazioni',
  'nginx-proxy-manager': "Reverse proxy grafico con SSL Let's Encrypt",
  traefik: 'Reverse proxy dinamico per microservizi Docker',
  caddy: 'Web server moderno con HTTPS automatico',
  qbittorrent: 'Client BitTorrent con interfaccia Web',
  transmission: 'Client BitTorrent leggero con Web UI',
  deluge: 'Client BitTorrent modulare',
  sonarr: 'Gestione e download automatico serie TV',
  radarr: 'Gestione e download automatico film',
  lidarr: 'Gestione automatica libreria musicale',
  prowlarr: 'Gestione indexer per Sonarr e Radarr',
  bazarr: 'Gestione automatica sottotitoli per film e serie',
  syncthing: 'Sincronizzazione file continua peer-to-peer',
  'uptime-kuma': 'Monitoraggio stato servizi, porte e siti Web',
  grafana: 'Dashboard di monitoraggio, metriche e grafici',
  prometheus: 'Raccolta metriche e telemetria di sistema',
  ollama: 'Esecuzione locale di modelli AI (LLM)',
  'open-webui': 'Interfaccia chat Web per Ollama e modelli AI',
  gitea: 'Server Git self-hosted leggero e veloce',
  gitlab: 'Piattaforma DevOps e repository Git completa',
  navidrome: 'Server musicale personale per streaming audio',
  audiobookshelf: 'Server per audiolibri e podcast',
  'calibre-web': 'Libreria e-book accessibile da browser',
  filebrowser: 'File manager Web leggero per cartelle',
  wireguard: 'VPN veloce, leggera e sicura',
  tailscale: 'Rete mesh VPN privata zero-config',
  duplicati: 'Backup cifrato su cloud e storage remoto',
  kopia: 'Backup veloce, deduplicato e cifrato',
  frigate: 'Videosorveglianza NVR con rilevamento AI',
  mosquitto: 'Broker MQTT per sensori e dispositivi IoT',
  zigbee2mqtt: 'Bridge Zigbee per integrazione domotica',
  n8n: 'Automazione flussi di lavoro e integrazioni API',
  memos: 'App leggera per note rapide e appunti',
  trilium: 'Knowledge base gerarchica e note personali',
  bookstack: 'Wiki e documentazione organizzata a libri',
  mealie: 'Ricettario digitale e pianificazione pasti',
  'actual-budget': 'Gestione budget e finanze personali',
  mariadb: 'Database relazionale SQL compatibile MySQL',
  mysql: 'Database relazionale SQL',
  postgresql: 'Database relazionale PostgreSQL avanzato',
  redis: 'Database in-memory ad alte prestazioni e cache',
  mongodb: 'Database NoSQL orientato ai documenti',
  minecraft: 'Server dedicato per Minecraft',
};

export function extractAppSlug(rawName: string, rawImage?: string): string {
  const candidates = [rawImage, rawName].filter((v): v is string => Boolean(v && v.trim()));
  for (const cand of candidates) {
    const withoutTag = cand.split(':')[0].trim().toLowerCase();
    const parts = withoutTag.split('/').filter(Boolean);
    let leaf = parts[parts.length - 1] ?? withoutTag;
    if ((leaf === 'server' || leaf === 'docker' || leaf === 'app') && parts.length >= 2) {
      leaf = parts[parts.length - 2];
    }
    const clean = leaf.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    if (clean) {
      return ICON_ALIASES[clean] ?? clean;
    }
  }
  return 'docker';
}

export function describeDockerApp(
  name: string,
  image?: string,
  fallbackImageLabel = true
): string {
  const slug = extractAppSlug(name, image);
  if (APP_DESCRIPTIONS[slug]) {
    return APP_DESCRIPTIONS[slug];
  }
  if (fallbackImageLabel && image?.trim()) {
    return `Container · ${image.split(':')[0]}`;
  }
  return 'Applicazione container Docker';
}
