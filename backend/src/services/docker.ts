import { execFile, spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import YAML from 'yaml';

const execFileAsync = promisify(execFile);

export const DATA_DIR = process.env.NAS_DATA_DIR || '/DATA';
export const STACKS_DIR = path.join(DATA_DIR, 'Stacks');
export const APPDATA_DIR = path.join(DATA_DIR, 'AppData');

const STACK_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

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

export function validateStackName(name: string): string {
  const trimmed = name.trim();
  if (!STACK_NAME_REGEX.test(trimmed)) {
    throw new Error(
      'Invalid stack name. Use 1-64 alphanumeric characters, hyphens, or underscores (must start with alphanumeric).'
    );
  }
  return trimmed;
}

export function validateComposeYaml(yamlContent: string): Record<string, unknown> {
  if (!yamlContent || !yamlContent.trim()) {
    throw new Error('YAML content cannot be empty');
  }
  const parsed = YAML.parse(yamlContent);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid docker-compose.yml: root must be a YAML mapping');
  }
  const obj = parsed as Record<string, unknown>;
  if (
    !obj.services ||
    typeof obj.services !== 'object' ||
    Array.isArray(obj.services) ||
    Object.keys(obj.services as object).length === 0
  ) {
    throw new Error('Invalid docker-compose.yml: must define at least one service under "services"');
  }
  return obj;
}

export async function ensureBaseDirectories(): Promise<void> {
  await fs.mkdir(STACKS_DIR, { recursive: true });
  await fs.mkdir(APPDATA_DIR, { recursive: true });
}

export async function listContainers(): Promise<ContainerInfo[]> {
  try {
    const { stdout } = await execFileAsync(
      'docker',
      ['ps', '-a', '--no-trunc', '--format', '{{json .}}'],
      { timeout: 10000 }
    );

    const lines = stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    return lines.map((line) => {
      const raw = JSON.parse(line) as {
        ID?: string;
        Names?: string;
        Image?: string;
        State?: string;
        Status?: string;
        Ports?: string;
        Labels?: string;
        CreatedAt?: string;
      };

      let stack: string | null = null;
      if (raw.Labels) {
        for (const pair of raw.Labels.split(',')) {
          const [k, v] = pair.split('=');
          if (k === 'com.docker.compose.project' && v) {
            stack = v;
            break;
          }
        }
      }

      return {
        id: raw.ID ?? '',
        name: raw.Names ?? '',
        image: raw.Image ?? '',
        state: (raw.State ?? 'unknown').toLowerCase(),
        status: raw.Status ?? '',
        ports: raw.Ports ?? '',
        stack,
        createdAt: raw.CreatedAt ?? '',
      };
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('ENOENT') || msg.includes('Cannot connect to the Docker daemon')) {
      return [];
    }
    throw err;
  }
}

export async function listStacks(): Promise<{
  stacks: StackInfo[];
  standaloneContainers: ContainerInfo[];
}> {
  const containers = await listContainers();
  const stackMap = new Map<string, StackInfo>();

  try {
    const entries = await fs.readdir(STACKS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const composePath = path.join(STACKS_DIR, entry.name, 'docker-compose.yml');
      let hasComposeFile = false;
      try {
        await fs.access(composePath);
        hasComposeFile = true;
      } catch {
        hasComposeFile = false;
      }
      stackMap.set(entry.name, {
        name: entry.name,
        composePath,
        hasComposeFile,
        containers: [],
        status: 'stopped',
      });
    }
  } catch {
    // STACKS_DIR might not exist yet
  }

  const standaloneContainers: ContainerInfo[] = [];

  for (const container of containers) {
    if (container.stack) {
      let stack = stackMap.get(container.stack);
      if (!stack) {
        stack = {
          name: container.stack,
          composePath: path.join(STACKS_DIR, container.stack, 'docker-compose.yml'),
          hasComposeFile: false,
          containers: [],
          status: 'stopped',
        };
        stackMap.set(container.stack, stack);
      }
      stack.containers.push(container);
    } else {
      standaloneContainers.push(container);
    }
  }

  for (const stack of stackMap.values()) {
    const total = stack.containers.length;
    const running = stack.containers.filter((c) => c.state === 'running').length;
    if (total === 0 || running === 0) {
      stack.status = 'stopped';
    } else if (running === total) {
      stack.status = 'running';
    } else {
      stack.status = 'partial';
    }
  }

  return {
    stacks: Array.from(stackMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
    standaloneContainers,
  };
}

export async function getStackCompose(stackName: string): Promise<string> {
  const validName = validateStackName(stackName);
  const composePath = path.join(STACKS_DIR, validName, 'docker-compose.yml');
  return fs.readFile(composePath, 'utf-8');
}

export async function getStackEnv(stackName: string): Promise<string> {
  const validName = validateStackName(stackName);
  const envPath = path.join(STACKS_DIR, validName, '.env');
  try {
    return await fs.readFile(envPath, 'utf-8');
  } catch {
    return '';
  }
}

export async function deployStack(
  stackName: string,
  yamlContent: string,
  onLog: (message: string, stream: 'stdout' | 'stderr' | 'info') => void,
  envContent?: string
): Promise<number> {
  const validName = validateStackName(stackName);
  validateComposeYaml(yamlContent);

  const stackDir = path.join(STACKS_DIR, validName);
  const composePath = path.join(stackDir, 'docker-compose.yml');
  const envPath = path.join(stackDir, '.env');

  await fs.mkdir(stackDir, { recursive: true });
  await fs.writeFile(composePath, yamlContent, 'utf-8');
  onLog(`Saved docker-compose.yml to ${composePath}`, 'info');

  if (typeof envContent === 'string') {
    if (envContent.trim().length > 0) {
      await fs.writeFile(envPath, envContent.trimEnd() + '\n', {
        encoding: 'utf-8',
        mode: 0o600,
      });
      onLog(`Saved .env to ${envPath}`, 'info');
    } else {
      await fs.rm(envPath, { force: true }).catch(() => { });
    }
  }

  onLog(`Running: docker compose -p ${validName} up -d`, 'info');

  return new Promise((resolve, reject) => {
    const child = spawn(
      'docker',
      ['compose', '-f', composePath, '-p', validName, 'up', '-d', '--remove-orphans'],
      {
        cwd: stackDir,
        env: { ...process.env, FORCE_COLOR: '0' },
      }
    );

    child.stdout.on('data', (chunk: Buffer) => {
      onLog(chunk.toString('utf-8'), 'stdout');
    });

    child.stderr.on('data', (chunk: Buffer) => {
      onLog(chunk.toString('utf-8'), 'stderr');
    });

    child.on('error', (err) => {
      reject(err);
    });

    child.on('close', (code) => {
      resolve(code ?? 1);
    });
  });
}

export async function runStackAction(
  stackName: string,
  action: 'start' | 'stop' | 'restart' | 'remove'
): Promise<{ stdout: string; stderr: string }> {
  const validName = validateStackName(stackName);
  const stackDir = path.join(STACKS_DIR, validName);
  const composePath = path.join(stackDir, 'docker-compose.yml');

  let hasFile = false;
  try {
    await fs.access(composePath);
    hasFile = true;
  } catch {
    hasFile = false;
  }

  if (!hasFile) {
    throw new Error(`Compose file not found for stack "${validName}"`);
  }

  const argsMap: Record<typeof action, string[]> = {
    start: ['compose', '-f', composePath, '-p', validName, 'start'],
    stop: ['compose', '-f', composePath, '-p', validName, 'stop'],
    restart: ['compose', '-f', composePath, '-p', validName, 'restart'],
    remove: ['compose', '-f', composePath, '-p', validName, 'down'],
  };

  const result = await execFileAsync('docker', argsMap[action], {
    cwd: stackDir,
    timeout: 60000,
  });

  if (action === 'remove') {
    await fs.rm(stackDir, { recursive: true, force: true });
  }

  return {
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

export function streamStackLogs(
  stackName: string,
  onLog: (line: string, stream: 'stdout' | 'stderr') => void,
  onClose: (code: number) => void
): ChildProcess {
  const validName = validateStackName(stackName);
  const stackDir = path.join(STACKS_DIR, validName);
  const composePath = path.join(stackDir, 'docker-compose.yml');

  const child = spawn(
    'docker',
    ['compose', '-f', composePath, '-p', validName, 'logs', '-f', '--tail=100', '--no-color'],
    { cwd: stackDir }
  );

  child.stdout.on('data', (chunk: Buffer) => {
    onLog(chunk.toString('utf-8'), 'stdout');
  });

  child.stderr.on('data', (chunk: Buffer) => {
    onLog(chunk.toString('utf-8'), 'stderr');
  });

  child.on('close', (code) => {
    onClose(code ?? 0);
  });

  return child;
}
