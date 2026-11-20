import http from 'node:http';
import cors from 'cors';
import express from 'express';
import aiRouter from './routes/ai.js';
import authRouter, { requireAuth } from './routes/auth.js';
import backupsRouter, { startBackupScheduler } from './routes/backups.js';
import fansRouter, { startFanControllerLoop } from './routes/fans.js';
import filesRouter from './routes/files.js';
import hubRouter from './routes/hub.js';
import installRouter from './routes/install.js';
import settingsRouter from './routes/settings.js';
import sharesRouter from './routes/shares.js';
import stacksRouter from './routes/stacks.js';
import storageRouter from './routes/storage.js';
import systemRouter from './routes/system.js';
import usersRouter from './routes/users.js';
import { ensureBaseDirectories } from './services/docker.js';
import { systemEvents } from './services/events.js';
import { attachTerminalWebSocket } from './services/terminal.js';

const PORT = Number(process.env.PORT ?? 3000);
const BIND_HOST = process.env.BIND_HOST || '127.0.0.1';
const app = express();

app.set('trust proxy', 1);

// Restrict CORS: in production frontend & backend share the same origin via Nginx
const allowedCorsOrigin = process.env.CORS_ORIGIN?.trim();
if (allowedCorsOrigin) {
  app.use(cors({ origin: allowedCorsOrigin, credentials: true }));
} else if (process.env.NODE_ENV !== 'production') {
  app.use(cors({ origin: /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/, credentials: true }));
}

app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRouter);

// Protect API routes (except health, auth, live installer, and public wallpaper image)
app.use('/api', (req, res, next) => {
  if (
    req.path === '/health' ||
    req.path.startsWith('/auth') ||
    req.path.startsWith('/install') ||
    req.path === '/settings/wallpaper/image' ||
    req.path === '/settings/login-config' ||
    req.path === '/settings/login-wallpaper/image'
  ) {
    next();
    return;
  }
  requireAuth(req, res, next);
});

app.use('/api/install', installRouter);
app.use('/api/hub', hubRouter);
app.use('/api/stacks', stacksRouter);
app.use('/api/system', systemRouter);
app.use('/api/storage', storageRouter);
app.use('/api/shares', sharesRouter);
app.use('/api/users', usersRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/ai', aiRouter);
app.use('/api/files', filesRouter);
app.use('/api/backups', backupsRouter);
app.use('/api/fans', fansRouter);

async function start(): Promise<void> {
  try {
    await ensureBaseDirectories();
  } catch (err) {
    console.warn('Warning: could not initialize /DATA directories:', err);
  }

  const server = http.createServer(app);
  attachTerminalWebSocket(server);

  server.listen(PORT, BIND_HOST, () => {
    console.log(`SiloOs Backend listening on http://${BIND_HOST}:${PORT}`);
    systemEvents.startBlockDeviceMonitor();
    startBackupScheduler();
    startFanControllerLoop();
  });
}

start();
