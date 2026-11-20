import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { Router, Request, Response } from 'express';
import { DATA_DIR } from '../services/docker.js';
import { requireAdmin } from './auth.js';

const execFileAsync = promisify(execFile);
const router = Router();

const HWMON_ROOT = '/sys/class/hwmon';
const FAN_CONFIG_FILE = path.join(DATA_DIR, '.nas-os', 'fans.json');

export type FanMode = 'bios' | 'curve' | 'manual';
export type FanProfile = 'silent' | 'balanced' | 'performance';

export interface FanControlConfig {
  mode: FanMode;
  profile: FanProfile;
  manualPercent: number;
}

export interface TempSensorReading {
  id: string;
  chip: string;
  label: string;
  tempC: number;
}

export interface FanRpmReading {
  id: string;
  chip: string;
  label: string;
  rpm: number;
}

export interface PwmChannelReading {
  id: string;
  chip: string;
  path: string;
  enablePath: string;
  percent: number;
  enableMode: number; // 0=full, 1=manual, 2=auto/BIOS
}

const DEFAULT_FAN_CONFIG: FanControlConfig = {
  mode: 'bios',
  profile: 'balanced',
  manualPercent: 50,
};

async function readTextSafe(filePath: string): Promise<string | null> {
  try {
    return (await fs.readFile(filePath, 'utf-8')).trim();
  } catch {
    return null;
  }
}

async function readFanConfig(): Promise<FanControlConfig> {
  try {
    const raw = await fs.readFile(FAN_CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<FanControlConfig>;
    const mode: FanMode =
      parsed.mode === 'curve' || parsed.mode === 'manual' ? parsed.mode : 'bios';
    const profile: FanProfile =
      parsed.profile === 'silent' || parsed.profile === 'performance'
        ? parsed.profile
        : 'balanced';
    const manualPercent = Math.max(25, Math.min(100, Math.round(Number(parsed.manualPercent ?? 50))));
    return { mode, profile, manualPercent };
  } catch {
    return { ...DEFAULT_FAN_CONFIG };
  }
}

async function saveFanConfig(cfg: FanControlConfig): Promise<void> {
  await fs.mkdir(path.dirname(FAN_CONFIG_FILE), { recursive: true });
  await fs.writeFile(FAN_CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8');
}

async function isSensorsInstalled(): Promise<boolean> {
  try {
    await execFileAsync('sensors', ['-v'], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

async function scanHwmon(): Promise<{
  temps: TempSensorReading[];
  fans: FanRpmReading[];
  pwms: PwmChannelReading[];
  maxTempC: number | null;
}> {
  const temps: TempSensorReading[] = [];
  const fans: FanRpmReading[] = [];
  const pwms: PwmChannelReading[] = [];

  let entries: string[] = [];
  try {
    entries = await fs.readdir(HWMON_ROOT);
  } catch {
    return { temps, fans, pwms, maxTempC: null };
  }

  for (const hw of entries.sort()) {
    const dir = path.join(HWMON_ROOT, hw);
    const chip = (await readTextSafe(path.join(dir, 'name'))) || hw;

    let files: string[] = [];
    try {
      files = await fs.readdir(dir);
    } catch {
      continue;
    }

    // Temperatures
    for (const f of files.filter((x) => /^temp\d+_input$/.test(x)).sort()) {
      const idx = f.match(/^temp(\d+)_input$/)?.[1] ?? '1';
      const raw = await readTextSafe(path.join(dir, f));
      if (!raw || !/^-?\d+$/.test(raw)) continue;
      const tempC = Math.round((Number(raw) / 1000) * 10) / 10;
      if (tempC < -20 || tempC > 140) continue;
      const label = (await readTextSafe(path.join(dir, `temp${idx}_label`))) || `${chip} #${idx}`;
      temps.push({ id: `${hw}:temp${idx}`, chip, label, tempC });
    }

    // Fan RPMs
    for (const f of files.filter((x) => /^fan\d+_input$/.test(x)).sort()) {
      const idx = f.match(/^fan(\d+)_input$/)?.[1] ?? '1';
      const raw = await readTextSafe(path.join(dir, f));
      if (!raw || !/^\d+$/.test(raw)) continue;
      const label = (await readTextSafe(path.join(dir, `fan${idx}_label`))) || `${chip} Fan #${idx}`;
      fans.push({ id: `${hw}:fan${idx}`, chip, label, rpm: Number(raw) });
    }

    // PWM controllers
    for (const f of files.filter((x) => /^pwm\d+$/.test(x)).sort()) {
      const pwmPath = path.join(dir, f);
      const enablePath = path.join(dir, `${f}_enable`);
      const rawVal = await readTextSafe(pwmPath);
      if (!rawVal || !/^\d+$/.test(rawVal)) continue;
      const rawEnable = await readTextSafe(enablePath);
      const pwmVal = Math.max(0, Math.min(255, Number(rawVal)));
      pwms.push({
        id: `${hw}:${f}`,
        chip,
        path: pwmPath,
        enablePath,
        percent: Math.round((pwmVal / 255) * 100),
        enableMode: rawEnable && /^\d+$/.test(rawEnable) ? Number(rawEnable) : 2,
      });
    }
  }

  const maxTempC =
    temps.length > 0 ? Math.max(...temps.map((t) => t.tempC)) : null;

  return { temps, fans, pwms, maxTempC };
}

function computeCurvePercent(maxTempC: number | null, profile: FanProfile): number {
  if (maxTempC === null) return 50;
  // Hard thermal failsafe
  if (maxTempC >= 75) return 100;

  if (profile === 'silent') {
    if (maxTempC <= 45) return 30;
    if (maxTempC <= 55) return 45;
    if (maxTempC <= 65) return 70;
    return 95;
  }
  if (profile === 'performance') {
    if (maxTempC <= 35) return 60;
    if (maxTempC <= 45) return 75;
    if (maxTempC <= 55) return 90;
    return 100;
  }
  // balanced
  if (maxTempC <= 40) return 40;
  if (maxTempC <= 50) return 60;
  if (maxTempC <= 60) return 80;
  return 100;
}

async function applyFanConfigToHardware(cfg: FanControlConfig): Promise<{
  appliedCount: number;
  targetPercent: number | null;
  warnings: string[];
}> {
  const { pwms, maxTempC } = await scanHwmon();
  const warnings: string[] = [];
  let appliedCount = 0;

  if (pwms.length === 0) {
    return {
      appliedCount: 0,
      targetPercent: null,
      warnings: [
        'Nessun controller PWM rilevato in /sys/class/hwmon (le ventole sono gestite dal BIOS o serve il modulo Super I/O come it87/nct6775).',
      ],
    };
  }

  let targetPercent: number | null = null;
  if (cfg.mode === 'manual') {
    targetPercent =
      maxTempC !== null && maxTempC >= 78
        ? 100
        : Math.max(25, Math.min(100, cfg.manualPercent));
  } else if (cfg.mode === 'curve') {
    targetPercent = computeCurvePercent(maxTempC, cfg.profile);
  }

  for (const pwm of pwms) {
    try {
      if (cfg.mode === 'bios') {
        await fs.writeFile(pwm.enablePath, '2', 'utf-8').catch(() => {});
        appliedCount++;
      } else if (targetPercent !== null) {
        const pwmByte = Math.max(64, Math.min(255, Math.round((targetPercent / 100) * 255)));
        await fs.writeFile(pwm.enablePath, '1', 'utf-8').catch(() => {});
        await fs.writeFile(pwm.path, String(pwmByte), 'utf-8');
        appliedCount++;
      }
    } catch (err) {
      warnings.push(
        `Impossibile scrivere ${pwm.id}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return { appliedCount, targetPercent, warnings };
}

export function startFanControllerLoop(): void {
  const tick = async () => {
    try {
      const cfg = await readFanConfig();
      if (cfg.mode === 'curve' || cfg.mode === 'manual') {
        await applyFanConfigToHardware(cfg);
      }
    } catch {
      // ignore transient errors
    }
  };

  setTimeout(() => {
    tick().catch(() => {});
  }, 5000);
  setInterval(() => {
    tick().catch(() => {});
  }, 10_000);
}

router.get('/status', async (_req: Request, res: Response) => {
  try {
    const [sensorsInstalled, hw, config] = await Promise.all([
      isSensorsInstalled(),
      scanHwmon(),
      readFanConfig(),
    ]);
    const targetPercent =
      config.mode === 'curve'
        ? computeCurvePercent(hw.maxTempC, config.profile)
        : config.mode === 'manual'
        ? config.manualPercent
        : null;

    res.json({
      sensorsInstalled,
      ...hw,
      config,
      targetPercent,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Errore lettura sensori ventole';
    res.status(500).json({ error: message });
  }
});

router.put('/config', requireAdmin, async (req: Request, res: Response) => {
  const body = req.body as Partial<FanControlConfig>;
  const mode: FanMode =
    body.mode === 'curve' || body.mode === 'manual' ? body.mode : 'bios';
  const profile: FanProfile =
    body.profile === 'silent' || body.profile === 'performance'
      ? body.profile
      : 'balanced';
  const manualPercent = Math.max(
    25,
    Math.min(100, Math.round(Number(body.manualPercent ?? 50)))
  );

  const nextCfg: FanControlConfig = { mode, profile, manualPercent };

  try {
    await saveFanConfig(nextCfg);
    const applyRes = await applyFanConfigToHardware(nextCfg);
    res.json({ success: true, config: nextCfg, ...applyRes });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Errore applicazione controllo ventole';
    res.status(500).json({ error: message });
  }
});

router.post('/install-sensors', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const installed = await isSensorsInstalled();
    if (!installed) {
      await execFileAsync('apt-get', ['update'], {
        timeout: 120_000,
        env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive' },
      });
      await execFileAsync('apt-get', ['install', '-y', 'lm-sensors'], {
        timeout: 180_000,
        env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive' },
      });
    }

    // Attempt to load common CPU & Super I/O fan modules (TerraMaster IT87, Nuvoton, Intel/AMD)
    for (const mod of ['coretemp', 'k10temp', 'nct6775', 'it87']) {
      await execFileAsync('modprobe', [mod], { timeout: 5000 }).catch(() => {});
    }

    const hw = await scanHwmon();
    res.json({
      success: true,
      sensorsInstalled: await isSensorsInstalled(),
      ...hw,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Errore installazione/rilevamento sensori';
    res.status(500).json({ error: message });
  }
});

export default router;
