import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface MountedDisk {
  filesystem: string;
  fsType: string;
  sizeBytes: number;
  usedBytes: number;
  availableBytes: number;
  usedPercent: number;
  mountpoint: string;
}

export interface SystemInfo {
  hostname: string;
  osName: string;
  arch: string;
  kernel: string;
  uptimeSeconds: number;
  cpu: {
    model: string;
    cores: number;
    usagePercent: number;
    loadAverage: number[];
  };
  memory: {
    totalBytes: number;
    usedBytes: number;
    availableBytes: number;
    usedPercent: number;
  };
  disks: MountedDisk[];
  network?: {
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
  };
}

export interface HubSearchResult {
  name: string;
  description: string;
  starCount: number;
  pullCount: number;
  isOfficial: boolean;
  isAutomated: boolean;
  iconUrl?: string;
}

export interface HubTagResult {
  name: string;
  lastUpdated: string | null;
  fullSize: number | null;
  architectures: string[];
}

export interface InspectedImage {
  image: string;
  tag: string;
  appName: string;
  exposedPorts: string[];
  volumes: string[];
  env: Record<string, string>;
  composeYaml: string;
  architecture: string;
  os: string;
}

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: string;
  stack: string | null;
  createdAt: string;
}

export interface StackInfo {
  name: string;
  composePath: string;
  hasComposeFile: boolean;
  containers: ContainerInfo[];
  status: 'running' | 'partial' | 'stopped';
}

export interface StacksResponse {
  stacks: StackInfo[];
  standaloneContainers: ContainerInfo[];
}

export interface DeploySseEvent {
  type: 'log' | 'done' | 'error';
  message?: string;
  stream?: 'stdout' | 'stderr' | 'info';
  timestamp?: string;
  exitCode?: number;
  success?: boolean;
}

export interface BlockDevice {
  name: string;
  kname: string;
  size: number;
  type: string;
  mountpoint: string | null;
  fstype: string | null;
  model: string | null;
  serial: string | null;
  tran: string | null;
  label: string | null;
  children?: BlockDevice[];
}

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
  nfsClients: string;
}

export interface ServiceStatus {
  name: string;
  active: boolean;
  state: string;
}

export interface SharesResponse {
  shares: NasShare[];
  services: {
    smb: ServiceStatus;
    nfs: ServiceStatus;
    ftp: ServiceStatus;
    ssh: ServiceStatus;
    sftp: ServiceStatus;
  };
}

export interface NasUser {
  username: string;
  uid: number;
  gid: number;
  home: string;
  shell: string;
  groups: string[];
  sambaEnabled: boolean;
}

export interface AiSettingsView {
  enabled: boolean;
  providerType: 'ollama' | 'lmstudio' | 'openai' | 'gemini' | 'custom';
  baseUrl: string;
  model: string;
  hasApiKey?: boolean;
  apiKeyPreview?: string;
}

export type WallpaperType =
  | 'silo-landscape'
  | 'aurora'
  | 'midnight'
  | 'ocean'
  | 'carbon'
  | 'custom';

export interface LoginScreenSettings {
  title: string;
  subtitle: string;
  showClock: boolean;
  showLogo: boolean;
  blurBackground: boolean;
  useCustomWallpaper: boolean;
}

export interface NasSettingsResponse {
  hostname: string;
  version?: string;
  settings: {
    nasName: string;
    wallpaper: WallpaperType;
    repoUrl?: string;
    loginScreen?: LoginScreenSettings;
    ai: AiSettingsView;
  };
  network: Array<{
    name: string;
    addresses: Array<{ family: string; address: string; mac: string }>;
  }>;
}

export interface SystemUpdateStatus {
  installedVersion: string;
  latestReleaseVersion: string | null;
  latestReleaseDate: string | null;
  latestReleaseNotes: string | null;
  updateAvailable: boolean;
}

export interface ProxyRoute {
  slug: string;
  path: string;
  target: string;
  stripPrefix: boolean;
}

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

export interface AiChatMessage {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: Array<{ name: string; ok: boolean }>;
}

export interface StoredAiChat {
  id: string;
  title: string;
  updatedAt: string;
  messages: AiChatMessage[];
}

export interface DirectoryBrowseResponse {
  currentPath: string;
  parentPath: string | null;
  directories: Array<{ name: string; path: string }>;
}

export interface ListeningPort {
  protocol: string;
  address: string;
  port: number;
  processName: string;
  pid: string | null;
  containerName: string | null;
  description: string;
}

export interface FirewallRule {
  index: number;
  to: string;
  action: string;
  from: string;
}

export interface FirewallStatusResponse {
  installed: boolean;
  enabled: boolean;
  rules: FirewallRule[];
}

export interface ProcessMemoryInfo {
  pid: number;
  user: string;
  command: string;
  memPercent: number;
  rssBytes: number;
  cpuPercent: number;
  args: string;
}

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: string | null;
}

export interface ManagedSystemService {
  id: string;
  label: string;
  description: string;
  active: boolean;
  state: string;
}

export interface RaidStatusResponse {
  mdstat: string;
  mdadmScan: string;
  zfsImportable: string[];
  zfsActive: string[];
}

export interface SystemNotification {
  id: string;
  level: 'info' | 'success' | 'warning';
  title: string;
  message: string;
  timestamp: string;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  getSystemInfo(): Observable<SystemInfo> {
    return this.http.get<SystemInfo>('/api/system/info');
  }

  searchHub(query: string): Observable<{ results: HubSearchResult[] }> {
    return this.http.get<{ results: HubSearchResult[] }>('/api/hub/search', {
      params: { q: query },
    });
  }

  getHubTags(image: string): Observable<{ image: string; tags: HubTagResult[] }> {
    return this.http.get<{ image: string; tags: HubTagResult[] }>('/api/hub/tags', {
      params: { image },
    });
  }

  inspectHubImage(image: string, tag: string): Observable<InspectedImage> {
    return this.http.get<InspectedImage>('/api/hub/inspect', {
      params: { image, tag },
    });
  }

  getStacks(): Observable<StacksResponse> {
    return this.http.get<StacksResponse>('/api/stacks');
  }

  getStackCompose(name: string): Observable<{ stackName: string; yamlContent: string }> {
    return this.http.get<{ stackName: string; yamlContent: string }>(
      `/api/stacks/${encodeURIComponent(name)}/compose`
    );
  }

  validateCompose(yamlContent: string): Observable<{ valid: boolean; error?: string }> {
    return this.http.post<{ valid: boolean; error?: string }>('/api/stacks/validate', {
      yamlContent,
    });
  }

  stackAction(
    name: string,
    action: 'start' | 'stop' | 'restart' | 'remove'
  ): Observable<{ success: boolean }> {
    return this.http.post<{ success: boolean }>(
      `/api/stacks/${encodeURIComponent(name)}/${action}`,
      {}
    );
  }

  async deployStackSse(
    stackName: string,
    yamlContent: string,
    onEvent: (event: DeploySseEvent) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const response = await fetch('/api/stacks/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stackName, yamlContent }),
      signal,
    });

    if (!response.ok) {
      let errorMsg = `HTTP ${response.status}`;
      try {
        const body = (await response.json()) as { error?: string };
        if (body.error) errorMsg = body.error;
      } catch {
        // ignore
      }
      throw new Error(errorMsg);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('ReadableStream not supported in this browser');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() ?? '';

      for (const block of blocks) {
        if (!block.trim()) continue;
        let eventType: DeploySseEvent['type'] = 'log';
        let dataStr = '';

        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) {
            const val = line.slice(6).trim();
            if (val === 'log' || val === 'done' || val === 'error') {
              eventType = val;
            }
          } else if (line.startsWith('data:')) {
            dataStr += line.slice(5).trim();
          }
        }

        if (dataStr) {
          try {
            const parsed = JSON.parse(dataStr) as Omit<DeploySseEvent, 'type'>;
            onEvent({ type: eventType, ...parsed });
          } catch {
            onEvent({ type: eventType, message: dataStr });
          }
        }
      }
    }
  }

  streamStackLogs(
    stackName: string,
    onLog: (message: string, stream: string) => void,
    onDone: () => void,
    onError: () => void
  ): EventSource {
    const es = new EventSource(`/api/stacks/${encodeURIComponent(stackName)}/logs`);
    es.addEventListener('log', (evt) => {
      try {
        const payload = JSON.parse((evt as MessageEvent).data) as {
          message: string;
          stream: string;
        };
        onLog(payload.message, payload.stream);
      } catch {
        onLog((evt as MessageEvent).data, 'stdout');
      }
    });
    es.addEventListener('done', () => {
      es.close();
      onDone();
    });
    es.onerror = () => {
      es.close();
      onError();
    };
    return es;
  }

  // Storage & Disks
  getStorageDisks(): Observable<{ blockdevices: BlockDevice[]; mounts: MountedDisk[] }> {
    return this.http.get<{ blockdevices: BlockDevice[]; mounts: MountedDisk[] }>(
      '/api/storage/disks'
    );
  }

  getDiskSmart(device: string): Observable<Record<string, unknown>> {
    return this.http.get<Record<string, unknown>>('/api/storage/smart', {
      params: { device },
    });
  }

  mountDisk(
    device: string,
    label: string,
    persistFstab: boolean
  ): Observable<{ success: boolean; mountpoint: string }> {
    return this.http.post<{ success: boolean; mountpoint: string }>(
      '/api/storage/mount',
      { device, label, persistFstab }
    );
  }

  unmountDisk(mountpoint: string): Observable<{ success: boolean }> {
    return this.http.post<{ success: boolean }>('/api/storage/unmount', { mountpoint });
  }

  formatDisk(
    device: string,
    fsType: string,
    label: string
  ): Observable<{ success: boolean }> {
    return this.http.post<{ success: boolean }>('/api/storage/format', {
      device,
      fsType,
      label,
      confirm: true,
    });
  }

  // Shares & Services (SMB, NFS, FTP, SFTP, SSH)
  getShares(): Observable<SharesResponse> {
    return this.http.get<SharesResponse>('/api/shares');
  }

  saveShare(share: Partial<NasShare>): Observable<{ success: boolean; warnings?: string[] }> {
    return this.http.post<{ success: boolean; warnings?: string[] }>('/api/shares', share);
  }

  deleteShare(name: string): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(
      `/api/shares/${encodeURIComponent(name)}`
    );
  }

  controlService(
    service: string,
    action: 'start' | 'stop' | 'restart'
  ): Observable<{ success: boolean; service: ServiceStatus }> {
    return this.http.post<{ success: boolean; service: ServiceStatus }>(
      `/api/shares/services/${encodeURIComponent(service)}/${action}`,
      {}
    );
  }

  // Users
  getUsers(): Observable<{ users: NasUser[] }> {
    return this.http.get<{ users: NasUser[] }>('/api/users');
  }

  createUser(payload: {
    username: string;
    password: string;
    sshAccess: boolean;
    sudoAccess: boolean;
    sambaAccess: boolean;
  }): Observable<{ success: boolean; warnings?: string[] }> {
    return this.http.post<{ success: boolean; warnings?: string[] }>('/api/users', payload);
  }

  updateUserPassword(username: string, password: string): Observable<{ success: boolean }> {
    return this.http.put<{ success: boolean }>(
      `/api/users/${encodeURIComponent(username)}/password`,
      { password, updateSamba: true }
    );
  }

  deleteUser(username: string): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(
      `/api/users/${encodeURIComponent(username)}`
    );
  }

  // System Settings & Customization
  getSettings(): Observable<NasSettingsResponse> {
    return this.http.get<NasSettingsResponse>('/api/settings');
  }

  saveSettings(payload: {
    hostname?: string;
    nasName?: string;
    wallpaper?: WallpaperType;
    repoUrl?: string;
    loginScreen?: Partial<LoginScreenSettings>;
    ai?: {
      enabled?: boolean;
      providerType?: 'ollama' | 'lmstudio' | 'openai' | 'gemini' | 'custom';
      baseUrl?: string;
      model?: string;
      apiKey?: string;
      clearApiKey?: boolean;
    };
  }): Observable<{ success: boolean; settings: NasSettingsResponse['settings'] }> {
    return this.http.put<{ success: boolean; settings: NasSettingsResponse['settings'] }>(
      '/api/settings',
      payload
    );
  }

  getNetworkInterfaces(): Observable<{ interfaces: NetworkInterfaceConfig[] }> {
    return this.http.get<{ interfaces: NetworkInterfaceConfig[] }>('/api/settings/network');
  }

  saveNetworkInterface(
    iface: string,
    payload: {
      method: 'auto' | 'manual';
      ip?: string;
      prefix?: number;
      netmask?: string;
      gateway?: string;
      dns?: string[];
    }
  ): Observable<{
    success: boolean;
    iface: string;
    method: 'auto' | 'manual';
    ip: string | null;
    prefix: number;
    gateway: string;
    dns: string[];
  }> {
    return this.http.put<{
      success: boolean;
      iface: string;
      method: 'auto' | 'manual';
      ip: string | null;
      prefix: number;
      gateway: string;
      dns: string[];
    }>(`/api/settings/network/${encodeURIComponent(iface)}`, payload);
  }

  testAiConnection(payload: {
    baseUrl: string;
    model: string;
    apiKey?: string;
  }): Observable<{ success: boolean; reply: string }> {
    return this.http.post<{ success: boolean; reply: string }>('/api/ai/test', payload);
  }

  sendAiChat(
    messages: Array<{ role: 'user' | 'assistant'; content: string }>
  ): Observable<{ reply: string; toolCalls: Array<{ name: string; ok: boolean }> }> {
    return this.http.post<{
      reply: string;
      toolCalls: Array<{ name: string; ok: boolean }>;
    }>('/api/ai/chat', { messages });
  }

  getAiHistory(): Observable<{ chats: StoredAiChat[] }> {
    return this.http.get<{ chats: StoredAiChat[] }>('/api/ai/history');
  }

  deleteAiChat(id: string): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(
      `/api/ai/history/${encodeURIComponent(id)}`
    );
  }

  async sendAiChatWithAbort(
    chatId: string | null,
    messages: AiChatMessage[],
    signal: AbortSignal
  ): Promise<{
    chatId: string;
    reply: string;
    toolCalls: Array<{ name: string; ok: boolean }>;
  }> {
    const res = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: chatId ?? undefined, messages }),
      signal,
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body.error) msg = body.error;
      } catch {
        // ignore
      }
      throw new Error(msg);
    }
    return res.json();
  }

  browseDirectory(dirPath: string): Observable<DirectoryBrowseResponse> {
    return this.http.get<DirectoryBrowseResponse>('/api/storage/browse', {
      params: { path: dirPath },
    });
  }

  createDirectory(
    parentPath: string,
    folderName: string
  ): Observable<{ success: boolean; path: string }> {
    return this.http.post<{ success: boolean; path: string }>('/api/storage/mkdir', {
      parentPath,
      folderName,
    });
  }

  getSystemPortsAndServices(): Observable<{
    ports: ListeningPort[];
    services: ManagedSystemService[];
  }> {
    return this.http.get<{
      ports: ListeningPort[];
      services: ManagedSystemService[];
    }>('/api/system/ports');
  }

  controlSystemService(
    name: string,
    action: 'start' | 'stop' | 'restart'
  ): Observable<{ success: boolean }> {
    return this.http.post<{ success: boolean }>(
      `/api/system/services/${encodeURIComponent(name)}/${action}`,
      {}
    );
  }

  getRaidStatus(): Observable<RaidStatusResponse> {
    return this.http.get<RaidStatusResponse>('/api/storage/raid');
  }

  importRaid(type: 'mdadm' | 'zfs', poolName?: string): Observable<{ success: boolean }> {
    return this.http.post<{ success: boolean }>('/api/storage/raid/import', {
      type,
      poolName,
    });
  }

  getUsbAutomount(): Observable<{ enabled: boolean }> {
    return this.http.get<{ enabled: boolean }>('/api/storage/usb-automount');
  }

  setUsbAutomount(enabled: boolean): Observable<{ success: boolean; enabled: boolean }> {
    return this.http.post<{ success: boolean; enabled: boolean }>(
      '/api/storage/usb-automount',
      { enabled }
    );
  }

  getSystemLogs(
    unit: string,
    lines = 150
  ): Observable<{ unit: string; lines: string[] }> {
    return this.http.get<{ unit: string; lines: string[] }>('/api/system/logs', {
      params: { unit, lines },
    });
  }

  streamSystemEvents(
    onNotification: (evt: SystemNotification) => void,
    onHistory: (history: SystemNotification[]) => void
  ): EventSource {
    const es = new EventSource('/api/system/events');
    es.addEventListener('history', (e) => {
      try {
        const parsed = JSON.parse((e as MessageEvent).data) as {
          notifications: SystemNotification[];
        };
        onHistory(parsed.notifications ?? []);
      } catch {
        // ignore
      }
    });
    es.addEventListener('notification', (e) => {
      try {
        const parsed = JSON.parse((e as MessageEvent).data) as SystemNotification;
        onNotification(parsed);
      } catch {
        // ignore
      }
    });
    return es;
  }

  getFirewallStatus(): Observable<FirewallStatusResponse> {
    return this.http.get<FirewallStatusResponse>('/api/system/firewall');
  }

  toggleFirewall(enabled: boolean): Observable<FirewallStatusResponse> {
    return this.http.post<FirewallStatusResponse>('/api/system/firewall/toggle', {
      enabled,
    });
  }

  addFirewallRule(
    port: string | number,
    protocol: 'tcp' | 'udp' | 'any',
    action: 'allow' | 'deny'
  ): Observable<FirewallStatusResponse> {
    return this.http.post<FirewallStatusResponse>('/api/system/firewall/rules', {
      port,
      protocol,
      action,
    });
  }

  deleteFirewallRule(index: number): Observable<FirewallStatusResponse> {
    return this.http.delete<FirewallStatusResponse>(
      `/api/system/firewall/rules/${index}`
    );
  }

  getTopMemoryProcesses(): Observable<{
    memory: SystemInfo['memory'];
    processes: ProcessMemoryInfo[];
  }> {
    return this.http.get<{
      memory: SystemInfo['memory'];
      processes: ProcessMemoryInfo[];
    }>('/api/system/processes');
  }

  listFiles(dirPath: string): Observable<{
    currentPath: string;
    parentPath: string | null;
    items: FileEntry[];
  }> {
    return this.http.get<{
      currentPath: string;
      parentPath: string | null;
      items: FileEntry[];
    }>('/api/files/list', { params: { path: dirPath } });
  }

  createFileFolder(
    parentPath: string,
    name: string
  ): Observable<{ success: boolean; path: string }> {
    return this.http.post<{ success: boolean; path: string }>('/api/files/mkdir', {
      parentPath,
      name,
    });
  }

  createEmptyFile(
    parentPath: string,
    name: string
  ): Observable<{ success: boolean; path: string }> {
    return this.http.post<{ success: boolean; path: string }>('/api/files/touch', {
      parentPath,
      name,
    });
  }

  renameFileOrFolder(
    oldPath: string,
    newName: string
  ): Observable<{ success: boolean; newPath: string }> {
    return this.http.post<{ success: boolean; newPath: string }>('/api/files/rename', {
      oldPath,
      newName,
    });
  }

  deleteFileOrFolder(targetPath: string): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>('/api/files/delete', {
      params: { path: targetPath },
    });
  }

  uploadFileWithProgress(
    dirPath: string,
    file: File,
    onProgress: (percent: number) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const url = `/api/files/upload?dir=${encodeURIComponent(
        dirPath
      )}&filename=${encodeURIComponent(file.name)}`;
      xhr.open('POST', url, true);

      xhr.upload.onprogress = (evt) => {
        if (evt.lengthComputable) {
          onProgress(Math.round((evt.loaded / evt.total) * 100));
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress(100);
          resolve();
        } else {
          try {
            const parsed = JSON.parse(xhr.responseText) as { error?: string };
            reject(new Error(parsed.error || `HTTP ${xhr.status}`));
          } catch {
            reject(new Error(`HTTP ${xhr.status}`));
          }
        }
      };

      xhr.onerror = () => reject(new Error('Errore di rete durante upload'));
      xhr.send(file);
    });
  }

  checkSystemUpdates(): Observable<SystemUpdateStatus> {
    return this.http.get<SystemUpdateStatus>('/api/settings/updates');
  }

  startSystemUpdate(password: string): Observable<{ started: boolean }> {
    return this.http.post<{ started: boolean }>('/api/settings/updates/apply', {
      password,
    });
  }

  getSystemUpdateProgress(): Observable<{ state: string; message: string }> {
    return this.http.get<{ state: string; message: string }>(
      '/api/settings/updates/progress'
    );
  }

  checkHealth(): Observable<{ status: string }> {
    return this.http.get<{ status: string }>('/api/health');
  }

  getAuthStatus(): Observable<{ authenticated: boolean; username: string | null }> {
    return this.http.get<{ authenticated: boolean; username: string | null }>(
      '/api/auth/status'
    );
  }

  login(
    username: string,
    password: string
  ): Observable<{ authenticated: boolean; username: string }> {
    return this.http.post<{ authenticated: boolean; username: string }>(
      '/api/auth/login',
      { username, password }
    );
  }

  logout(): Observable<{ success: boolean }> {
    return this.http.post<{ success: boolean }>('/api/auth/logout', {});
  }

  async uploadWallpaper(
    file: File
  ): Promise<{ success: boolean; settings: NasSettingsResponse['settings'] }> {
    const res = await fetch('/api/settings/wallpaper', {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    });
    if (!res.ok) {
      throw new Error(`Upload sfondo fallito (HTTP ${res.status})`);
    }
    return res.json();
  }

  getLoginConfig(): Observable<{
    nasName: string;
    wallpaper: WallpaperType;
    loginScreen: LoginScreenSettings;
  }> {
    return this.http.get<{
      nasName: string;
      wallpaper: WallpaperType;
      loginScreen: LoginScreenSettings;
    }>('/api/settings/login-config');
  }

  async uploadLoginWallpaper(
    file: File
  ): Promise<{ success: boolean; settings: NasSettingsResponse['settings'] }> {
    const res = await fetch('/api/settings/login-wallpaper', {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    });
    if (!res.ok) {
      throw new Error(`Upload sfondo login fallito (HTTP ${res.status})`);
    }
    return res.json();
  }

  getProxyRoutes(): Observable<{ routes: ProxyRoute[] }> {
    return this.http.get<{ routes: ProxyRoute[] }>('/api/settings/proxy-routes');
  }

  saveProxyRoute(payload: {
    path: string;
    target: string;
    stripPrefix: boolean;
  }): Observable<{ success: boolean; routes: ProxyRoute[]; warnings?: string[] }> {
    return this.http.post<{
      success: boolean;
      routes: ProxyRoute[];
      warnings?: string[];
    }>('/api/settings/proxy-routes', payload);
  }

  deleteProxyRoute(slug: string): Observable<{ success: boolean; routes: ProxyRoute[] }> {
    return this.http.delete<{ success: boolean; routes: ProxyRoute[] }>(
      `/api/settings/proxy-routes/${encodeURIComponent(slug)}`
    );
  }
}
