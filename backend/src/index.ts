import cors from 'cors';
import express from 'express';
import aiRouter from './routes/ai.js';
import filesRouter from './routes/files.js';
import hubRouter from './routes/hub.js';
import settingsRouter from './routes/settings.js';
import sharesRouter from './routes/shares.js';
import stacksRouter from './routes/stacks.js';
import storageRouter from './routes/storage.js';
import systemRouter from './routes/system.js';
import usersRouter from './routes/users.js';
import { ensureBaseDirectories } from './services/docker.js';
import { systemEvents } from './services/events.js';

const PORT = Number(process.env.PORT ?? 3000);
const app = express();

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/hub', hubRouter);
app.use('/api/stacks', stacksRouter);
app.use('/api/system', systemRouter);
app.use('/api/storage', storageRouter);
app.use('/api/shares', sharesRouter);
app.use('/api/users', usersRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/ai', aiRouter);
app.use('/api/files', filesRouter);

async function start(): Promise<void> {
  try {
    await ensureBaseDirectories();
  } catch (err) {
    console.warn('Warning: could not initialize /DATA directories:', err);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`NAS-OS Backend listening on http://0.0.0.0:${PORT}`);
    systemEvents.startBlockDeviceMonitor();
  });
}

start();
