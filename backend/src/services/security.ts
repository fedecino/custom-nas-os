import dns from 'node:dns/promises';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { Request } from 'express';
import { DATA_DIR } from './docker.js';

const AUDIT_LOG_FILE = path.join(DATA_DIR, '.nas-os', 'audit.log');

export function getClientIp(req: Request): string {
  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim()) return realIp.trim();
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) return fwd.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

export async function auditLog(
  event: string,
  details: Record<string, unknown> = {}
): Promise<void> {
  const entry = JSON.stringify({
    ts: new Date().toISOString(),
    event,
    ...details,
  });
  console.log(`[AUDIT] ${entry}`);
  try {
    await fs.mkdir(path.dirname(AUDIT_LOG_FILE), { recursive: true, mode: 0o700 });
    await fs.appendFile(AUDIT_LOG_FILE, entry + '\n', { encoding: 'utf-8', mode: 0o600 });
  } catch {
    // non-fatal
  }
}

/**
 * Resolves symlinks along a path safely. If the final leaf doesn't exist yet (e.g. mkdir/touch/upload),
 * resolves the nearest existing ancestor via fs.realpath() and rejoins the remaining segments.
 */
export async function resolveRealPathSafe(targetPath: string): Promise<string> {
  const resolved = path.resolve(targetPath);
  try {
    return await fs.realpath(resolved);
  } catch {
    // Walk up until an existing parent is found
    const missingParts: string[] = [];
    let current = resolved;
    while (true) {
      const parent = path.dirname(current);
      if (parent === current) {
        return resolved;
      }
      missingParts.unshift(path.basename(current));
      current = parent;
      try {
        const realParent = await fs.realpath(current);
        return path.join(realParent, ...missingParts);
      } catch {
        // continue walking up
      }
    }
  }
}

function isPrivateOrReservedIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast/reserved
  return false;
}

function isPrivateOrReservedIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // ULA
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) {
    return true; // link-local
  }
  if (lower.startsWith('::ffff:')) {
    const mapped = lower.slice(7);
    if (net.isIPv4(mapped)) return isPrivateOrReservedIpv4(mapped);
  }
  return false;
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateOrReservedIpv4(ip);
  if (net.isIPv6(ip)) return isPrivateOrReservedIpv6(ip);
  return true;
}

/**
 * Validates that an external URL is http/https and does not resolve to loopback/link-local/private IPs (SSRF protection).
 */
export async function assertSafeExternalUrl(
  rawUrl: string,
  options: { allowPrivate?: boolean } = {}
): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error('URL non valido');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Sono consentiti solo URL http:// o https://');
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) {
    throw new Error('Hostname mancante nell\'URL');
  }

  if (!options.allowPrivate) {
    if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
      throw new Error('Accesso a indirizzi locali non consentito per motivi di sicurezza');
    }

    if (net.isIP(host)) {
      if (isPrivateIp(host)) {
        throw new Error('Accesso a indirizzi IP privati o di loopback non consentito');
      }
      return parsed;
    }

    try {
      const records = await dns.lookup(host, { all: true });
      if (records.length === 0) {
        throw new Error('Impossibile risolvere l\'hostname');
      }
      for (const rec of records) {
        if (isPrivateIp(rec.address)) {
          throw new Error('L\'URL punta a un indirizzo IP privato o di loopback non consentito');
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('non consentito')) throw err;
      throw new Error(`Impossibile verificare l'host "${host}"`);
    }
  }

  return parsed;
}
