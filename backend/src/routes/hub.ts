import { Router, Request, Response } from 'express';
import { getTags, inspectImage, searchRepositories } from '../services/registry.js';

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

export default router;
