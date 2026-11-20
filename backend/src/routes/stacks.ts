import { Router, Request, Response } from 'express';
import {
  deployStack,
  getStackCompose,
  getStackEnv,
  listStacks,
  runStackAction,
  streamStackLogs,
  validateComposeYaml,
  validateStackName,
} from '../services/docker.js';
import { requireAdmin } from './auth.js';

const router = Router();
router.use(requireAdmin);

router.get('/', async (_req: Request, res: Response) => {
  try {
    const data = await listStacks();
    res.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to list stacks';
    res.status(500).json({ error: message });
  }
});

router.get('/:name/compose', async (req: Request, res: Response) => {
  try {
    const stackName = String(req.params.name ?? '');
    const [yamlContent, envContent] = await Promise.all([
      getStackCompose(stackName),
      getStackEnv(stackName),
    ]);
    res.json({ stackName, yamlContent, envContent });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to read compose file';
    res.status(404).json({ error: message });
  }
});

router.post('/validate', (req: Request, res: Response) => {
  try {
    const { yamlContent } = req.body as { yamlContent?: string };
    validateComposeYaml(yamlContent ?? '');
    res.json({ valid: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid YAML';
    res.status(400).json({ valid: false, error: message });
  }
});

router.post('/deploy', async (req: Request, res: Response) => {
  const { stackName, yamlContent, envContent } = req.body as {
    stackName?: string;
    yamlContent?: string;
    envContent?: string;
  };

  try {
    validateStackName(stackName ?? '');
    validateComposeYaml(yamlContent ?? '');
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid deployment payload';
    res.status(400).json({ error: message });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sendEvent = (event: string, data: Record<string, unknown>) => {
    if (!res.writableEnded) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }
  };

  try {
    const exitCode = await deployStack(
      stackName!,
      yamlContent!,
      (message, stream) => {
        sendEvent('log', { message, stream, timestamp: new Date().toISOString() });
      },
      envContent
    );

    sendEvent('done', {
      exitCode,
      success: exitCode === 0,
      stackName,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Deploy failed';
    sendEvent('error', { message });
    sendEvent('done', { exitCode: 1, success: false, stackName });
  } finally {
    if (!res.writableEnded) {
      res.end();
    }
  }
});

router.post('/:name/:action', async (req: Request, res: Response) => {
  try {
    const stackName = String(req.params.name ?? '');
    const action = String(req.params.action ?? '');

    if (!['start', 'stop', 'restart', 'remove'].includes(action)) {
      res.status(400).json({ error: `Unsupported action: ${action}` });
      return;
    }

    const result = await runStackAction(
      stackName,
      action as 'start' | 'stop' | 'restart' | 'remove'
    );
    res.json({ success: true, stackName, action, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Stack action failed';
    res.status(500).json({ error: message });
  }
});

router.get('/:name/logs', (req: Request, res: Response) => {
  const stackName = String(req.params.name ?? '');

  try {
    validateStackName(stackName);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid stack name';
    res.status(400).json({ error: message });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const child = streamStackLogs(
    stackName,
    (message, stream) => {
      if (!res.writableEnded) {
        res.write(
          `event: log\ndata: ${JSON.stringify({
            message,
            stream,
            timestamp: new Date().toISOString(),
          })}\n\n`
        );
      }
    },
    (code) => {
      if (!res.writableEnded) {
        res.write(`event: done\ndata: ${JSON.stringify({ exitCode: code })}\n\n`);
        res.end();
      }
    }
  );

  req.on('close', () => {
    child.kill('SIGTERM');
  });
});

export default router;
