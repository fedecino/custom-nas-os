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

export interface NasSettingsResponse {
  hostname: string;
  settings: {
    nasName: string;
    wallpaper: 'aurora' | 'midnight' | 'ocean' | 'carbon';
    ai: AiSettingsView;
  };
  network: Array<{
    name: string;
    addresses: Array<{ family: string; address: string; mac: string }>;
  }>;
}

export interface AiChatMessage {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: Array<{ name: string; ok: boolean }>;
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
    wallpaper?: 'aurora' | 'midnight' | 'ocean' | 'carbon';
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
}
