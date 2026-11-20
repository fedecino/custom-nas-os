import { Router, Request, Response } from 'express';
import { getTags, inspectImage, searchRepositories } from '../services/registry.js';
import {
  fetchComposeFromUrl,
  getAppStoreCatalog,
  renderStoreAppCompose,
  syncAppStoreFromRepo,
} from '../services/appstore.js';
import { requireAdmin } from './auth.js';

const router = Router();

router.get('/search', async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q ?? '').trim();
    if (!q) {
      res.json({ results: [] });
      return;
    }
    const pageSize = Math.min(Number(req.query.page_size ?? 20) || 20, 50);
    const results = await searchRepositories(q, pageSize);
    res.json({ results });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Docker Hub search failed';
    res.status(502).json({ error: message });
  }
});

router.get('/tags', async (req: Request, res: Response) => {
  try {
    const image = String(req.query.image ?? '').trim();
    if (!image) {
      res.status(400).json({ error: 'Missing "image" query parameter' });
      return;
    }
    const pageSize = Math.min(Number(req.query.page_size ?? 20) || 20, 50);
    const tags = await getTags(image, pageSize);
    res.json({ image, tags });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch tags';
    res.status(502).json({ error: message });
  }
});

router.get('/inspect', async (req: Request, res: Response) => {
  try {
    const image = String(req.query.image ?? '').trim();
    const tag = String(req.query.tag ?? 'latest').trim() || 'latest';
    if (!image) {
      res.status(400).json({ error: 'Missing "image" query parameter' });
      return;
    }
    const result = await inspectImage(image, tag);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Image inspection failed';
    res.status(502).json({ error: message });
  }
});

// Curated App Store endpoints
router.get('/store', async (_req: Request, res: Response) => {
  try {
    const catalog = await getAppStoreCatalog();
    res.json(catalog);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'App Store load failed';
    res.status(500).json({ error: message });
  }
});

router.post('/store/sync', requireAdmin, async (req: Request, res: Response) => {
  const { repoUrl } = req.body as { repoUrl?: string };
  try {
    const syncInfo = await syncAppStoreFromRepo(repoUrl);
    const catalog = await getAppStoreCatalog();
    res.json({ success: true, ...syncInfo, ...catalog });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Catalog sync failed';
    res.status(502).json({ error: message });
  }
});

router.post('/store/:id/render', async (req: Request, res: Response) => {
  const appId = String(req.params.id ?? '').trim();
  try {
    const rendered = await renderStoreAppCompose(appId);
    res.json(rendered);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Template render failed';
    res.status(404).json({ error: message });
  }
});

router.post('/import-url', requireAdmin, async (req: Request, res: Response) => {
  const { url } = req.body as { url?: string };
  try {
    const composeYaml = await fetchComposeFromUrl(String(url ?? ''));
    res.json({ composeYaml });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Import URL failed';
    res.status(400).json({ error: message });
  }
});

export default router;
