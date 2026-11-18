import { execFile } from 'node:child_process';
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
  ai: AiProviderSettings;
}

const DEFAULT_SETTINGS: NasUiSettings = {
  nasName: 'NAS-OS',
  wallpaper: 'aurora',
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

router.get('/', async (_req: Request, res: Response) => {
  try {
    const settings = await readFullSettings();
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
      settings: sanitizeSettingsForClient(settings),
      network: netSummary,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to read settings';
    res.status(500).json({ error: message });
  }
});

router.put('/', async (req: Request, res: Response) => {
  const { hostname, nasName, wallpaper, ai } = req.body as {
    hostname?: string;
    nasName?: string;
    wallpaper?: NasUiSettings['wallpaper'];
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

export default router;
