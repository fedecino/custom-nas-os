import YAML from 'yaml';

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

const IGNORED_ENV_KEYS = new Set([
  'PATH',
  'HOME',
  'TERM',
  'HOSTNAME',
  'LANG',
  'LC_ALL',
  'LANGUAGE',
  'DEBIAN_FRONTEND',
  'GOSU_VERSION',
  'GPG_KEY',
]);

function normalizeRepoName(image: string): {
  fullRepo: string;
  namespace: string;
  repo: string;
  appName: string;
} {
  const cleaned = image.trim().replace(/^docker\.io\//, '');
  const parts = cleaned.split('/');
  if (parts.length === 1) {
    return {
      fullRepo: `library/${parts[0]}`,
      namespace: 'library',
      repo: parts[0],
      appName: sanitizeAppName(parts[0]),
    };
  }
  const namespace = parts[0];
  const repo = parts.slice(1).join('/');
  return {
    fullRepo: `${namespace}/${repo}`,
    namespace,
    repo,
    appName: sanitizeAppName(parts[parts.length - 1]),
  };
}

function sanitizeAppName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'app'
  );
}

function sanitizeVolumeSubdir(containerPath: string): string {
  const cleaned = containerPath
    .replace(/^\/+/, '')
    .replace(/[^a-zA-Z0-9_.-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return cleaned || 'data';
}

export async function searchRepositories(
  query: string,
  pageSize = 20
): Promise<HubSearchResult[]> {
  const url = `https://hub.docker.com/v2/search/repositories/?query=${encodeURIComponent(
    query
  )}&page_size=${pageSize}`;

  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
  });

  if (!res.ok) {
    throw new Error(`Docker Hub search failed (${res.status} ${res.statusText})`);
  }

  const data = (await res.json()) as {
    results?: Array<{
      repo_name?: string;
      short_description?: string;
      star_count?: number;
      pull_count?: number;
      is_official?: boolean;
      is_automated?: boolean;
      logo_url?: { large?: string; small?: string };
    }>;
  };

  return (data.results ?? []).map((item) => ({
    name: item.repo_name ?? '',
    description: item.short_description ?? '',
    starCount: item.star_count ?? 0,
    pullCount: item.pull_count ?? 0,
    isOfficial: Boolean(item.is_official),
    isAutomated: Boolean(item.is_automated),
    iconUrl: item.logo_url?.large || item.logo_url?.small || undefined,
  }));
}

export async function getTags(
  imageName: string,
  pageSize = 20
): Promise<HubTagResult[]> {
  const { namespace, repo } = normalizeRepoName(imageName);
  const url = `https://hub.docker.com/v2/repositories/${encodeURIComponent(
    namespace
  )}/${encodeURIComponent(repo)}/tags/?page_size=${pageSize}`;

  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
  });

  if (!res.ok) {
    throw new Error(`Docker Hub tags fetch failed (${res.status} ${res.statusText})`);
  }

  const data = (await res.json()) as {
    results?: Array<{
      name: string;
      last_updated?: string;
      full_size?: number;
      images?: Array<{ architecture?: string; os?: string }>;
    }>;
  };

  return (data.results ?? []).map((tag) => ({
    name: tag.name,
    lastUpdated: tag.last_updated ?? null,
    fullSize: tag.full_size ?? null,
    architectures: Array.from(
      new Set(
        (tag.images ?? [])
          .map((img) =>
            img.os && img.architecture ? `${img.os}/${img.architecture}` : img.architecture
          )
          .filter((v): v is string => Boolean(v))
      )
    ),
  }));
}

async function fetchRegistryToken(fullRepo: string): Promise<string> {
  const tokenUrl = `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${encodeURIComponent(
    fullRepo
  )}:pull`;

  const res = await fetch(tokenUrl, {
    headers: { Accept: 'application/json' },
  });

  if (!res.ok) {
    throw new Error(`Registry auth failed (${res.status} ${res.statusText})`);
  }

  const data = (await res.json()) as { token?: string; access_token?: string };
  const token = data.token ?? data.access_token;
  if (!token) {
    throw new Error('Registry auth response did not include a token');
  }
  return token;
}

interface ManifestListEntry {
  digest: string;
  mediaType?: string;
  platform?: {
    architecture?: string;
    os?: string;
    variant?: string;
  };
}

interface RegistryManifest {
  mediaType?: string;
  schemaVersion?: number;
  config?: {
    digest: string;
    mediaType?: string;
  };
  manifests?: ManifestListEntry[];
}

interface ImageConfigBlob {
  architecture?: string;
  os?: string;
  config?: {
    ExposedPorts?: Record<string, Record<string, unknown>>;
    Volumes?: Record<string, Record<string, unknown>>;
    Env?: string[];
  };
}

export async function inspectImage(
  imageName: string,
  tag = 'latest'
): Promise<InspectedImage> {
  const { fullRepo, appName } = normalizeRepoName(imageName);
  const displayImage = fullRepo.startsWith('library/')
    ? fullRepo.slice('library/'.length)
    : fullRepo;

  const token = await fetchRegistryToken(fullRepo);

  const acceptHeader = [
    'application/vnd.docker.distribution.manifest.v2+json',
    'application/vnd.oci.image.manifest.v1+json',
    'application/vnd.oci.image.index.v1+json',
    'application/vnd.docker.distribution.manifest.list.v2+json',
  ].join(', ');

  const manifestUrl = `https://registry-1.docker.io/v2/${fullRepo}/manifests/${encodeURIComponent(
    tag
  )}`;

  const manifestRes = await fetch(manifestUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: acceptHeader,
    },
  });

  if (!manifestRes.ok) {
    throw new Error(
      `Failed to fetch manifest for ${displayImage}:${tag} (${manifestRes.status} ${manifestRes.statusText})`
    );
  }

  let manifest = (await manifestRes.json()) as RegistryManifest;

  // Resolve multi-arch manifest list / OCI index for linux/amd64
  if (Array.isArray(manifest.manifests) && manifest.manifests.length > 0) {
    const candidates = manifest.manifests.filter(
      (m) =>
        m.platform?.os !== 'unknown' &&
        m.platform?.architecture !== 'unknown'
    );
    const amd64 =
      candidates.find(
        (m) => m.platform?.os === 'linux' && m.platform?.architecture === 'amd64'
      ) ??
      candidates.find((m) => m.platform?.architecture === 'amd64') ??
      candidates[0] ??
      manifest.manifests[0];

    if (!amd64?.digest) {
      throw new Error(`No suitable manifest digest found in multi-arch index for ${displayImage}:${tag}`);
    }

    const archManifestRes = await fetch(
      `https://registry-1.docker.io/v2/${fullRepo}/manifests/${amd64.digest}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: [
            'application/vnd.docker.distribution.manifest.v2+json',
            'application/vnd.oci.image.manifest.v1+json',
          ].join(', '),
        },
      }
    );

    if (!archManifestRes.ok) {
      throw new Error(
        `Failed to fetch amd64 manifest (${archManifestRes.status} ${archManifestRes.statusText})`
      );
    }

    manifest = (await archManifestRes.json()) as RegistryManifest;
  }

  const configDigest = manifest.config?.digest;
  if (!configDigest) {
    throw new Error(`Image manifest for ${displayImage}:${tag} has no config digest`);
  }

  const blobRes = await fetch(
    `https://registry-1.docker.io/v2/${fullRepo}/blobs/${configDigest}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (!blobRes.ok) {
    throw new Error(
      `Failed to fetch config blob ${configDigest} (${blobRes.status} ${blobRes.statusText})`
    );
  }

  const blob = (await blobRes.json()) as ImageConfigBlob;
  const imgConfig = blob.config ?? {};

  const exposedPorts = Object.keys(imgConfig.ExposedPorts ?? {});
  const volumes = Object.keys(imgConfig.Volumes ?? {});
  const env: Record<string, string> = {};

  for (const entry of imgConfig.Env ?? []) {
    const eqIndex = entry.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = entry.slice(0, eqIndex).trim();
    const value = entry.slice(eqIndex + 1);
    if (!key || IGNORED_ENV_KEYS.has(key)) continue;
    env[key] = value;
  }

  const composeYaml = buildComposeYaml({
    appName,
    image: `${displayImage}:${tag}`,
    exposedPorts,
    volumes,
    env,
  });

  return {
    image: displayImage,
    tag,
    appName,
    exposedPorts,
    volumes,
    env,
    composeYaml,
    architecture: blob.architecture ?? 'amd64',
    os: blob.os ?? 'linux',
  };
}

function buildComposeYaml(params: {
  appName: string;
  image: string;
  exposedPorts: string[];
  volumes: string[];
  env: Record<string, string>;
}): string {
  const { appName, image, exposedPorts, volumes, env } = params;

  const service: Record<string, unknown> = {
    image,
    container_name: appName,
    restart: 'unless-stopped',
  };

  if (exposedPorts.length > 0) {
    service.ports = exposedPorts.map((portSpec) => {
      const [port, proto] = portSpec.split('/');
      if (proto && proto.toLowerCase() === 'udp') {
        return `${port}:${port}/udp`;
      }
      return `${port}:${port}`;
    });
  }

  if (volumes.length > 0) {
    service.volumes = volumes.map((containerPath) => {
      const subdir = sanitizeVolumeSubdir(containerPath);
      return `/DATA/AppData/${appName}/${subdir}:${containerPath}`;
    });
  }

  if (Object.keys(env).length > 0) {
    service.environment = env;
  }

  const composeObj = {
    services: {
      [appName]: service,
    },
  };

  return YAML.stringify(composeObj, {
    indent: 2,
    lineWidth: 0,
  });
}
