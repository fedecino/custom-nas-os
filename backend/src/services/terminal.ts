import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import { Writable } from 'node:stream';
import { WebSocketServer, WebSocket } from 'ws';
import { authenticateCookieHeader } from '../routes/auth.js';

const PTY_PYTHON_RUNNER = `
import os, pty, select, fcntl, termios, struct, signal

master, slave = pty.openpty()
pid = os.fork()
if pid == 0:
    os.close(master)
    os.setsid()
    fcntl.ioctl(slave, termios.TIOCSCTTY, 0)
    os.dup2(slave, 0)
    os.dup2(slave, 1)
    os.dup2(slave, 2)
    if slave > 2:
        os.close(slave)
    shell = os.environ.get('SHELL', '/bin/bash')
    if not os.path.exists(shell):
        shell = '/bin/sh'
    os.execvp(shell, [shell, '-l'])
else:
    os.close(slave)
    ctl_fd = 3
    fds = [master, 0, ctl_fd]
    while True:
        try:
            r, _, _ = select.select(fds, [], [])
        except InterruptedError:
            continue
        if master in r:
            try:
                data = os.read(master, 8192)
            except OSError:
                break
            if not data:
                break
            os.write(1, data)
        if 0 in r:
            data = os.read(0, 8192)
            if not data:
                break
            os.write(master, data)
        if ctl_fd in r:
            cmd = os.read(ctl_fd, 256).decode('utf-8', 'ignore').strip()
            if not cmd:
                if ctl_fd in fds:
                    fds.remove(ctl_fd)
                continue
            for line in cmd.splitlines():
                if ',' in line:
                    try:
                        cols, rows = map(int, line.split(',', 1))
                        fcntl.ioctl(
                            master,
                            termios.TIOCSWINSZ,
                            struct.pack('HHHH', max(1, rows), max(1, cols), 0, 0),
                        )
                    except Exception:
                        pass
    try:
        os.kill(pid, signal.SIGTERM)
    except Exception:
        pass
`;

function spawnPtyShell(): { proc: ChildProcess; ctlStream: Writable | null } {
  const startDir = fs.existsSync('/DATA') ? '/DATA' : process.env.HOME || '/';
  const env = {
    ...process.env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
  };

  if (fs.existsSync('/usr/bin/python3') || fs.existsSync('/bin/python3')) {
    const proc = spawn('python3', ['-u', '-c', PTY_PYTHON_RUNNER], {
      cwd: startDir,
      env,
      stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
    });
    const ctlStream = (proc.stdio[3] as Writable | undefined) ?? null;
    return { proc, ctlStream };
  }

  // Fallback using util-linux `script`
  const proc = spawn('script', ['-qfc', '/bin/bash -i', '/dev/null'], {
    cwd: startDir,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return { proc, ctlStream: null };
}

export function attachTerminalWebSocket(server: http.Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', async (req, socket, head) => {
    const urlPath = (req.url ?? '').split('?')[0];
    if (urlPath !== '/api/terminal/ws') {
      socket.destroy();
      return;
    }

    try {
      const session = await authenticateCookieHeader(req.headers.cookie);
      if (!session) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    } catch {
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      socket.destroy();
    }
  });

  wss.on('connection', (ws: WebSocket) => {
    const { proc, ctlStream } = spawnPtyShell();

    const sendOutput = (chunk: Buffer) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'output', data: chunk.toString('utf-8') }));
      }
    };

    proc.stdout?.on('data', sendOutput);
    proc.stderr?.on('data', sendOutput);

    proc.on('exit', (code) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'exit', code: code ?? 0 }));
        ws.close();
      }
    });

    proc.on('error', (err) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'output',
            data: `\r\n\x1b[31mErrore avvio shell: ${err.message}\x1b[0m\r\n`,
          })
        );
        ws.close();
      }
    });

    ws.on('message', (raw) => {
      const text = raw.toString();
      try {
        const msg = JSON.parse(text) as {
          type?: string;
          data?: string;
          cols?: number;
          rows?: number;
        };
        if (msg.type === 'input' && typeof msg.data === 'string') {
          proc.stdin?.write(msg.data);
          return;
        }
        if (
          msg.type === 'resize' &&
          typeof msg.cols === 'number' &&
          typeof msg.rows === 'number' &&
          ctlStream &&
          !ctlStream.destroyed
        ) {
          ctlStream.write(`${Math.floor(msg.cols)},${Math.floor(msg.rows)}\n`);
          return;
        }
      } catch {
        // Fallback: treat as raw stdin
        proc.stdin?.write(text);
      }
    });

    ws.on('close', () => {
      try {
        ctlStream?.end();
      } catch {
        // ignore
      }
      if (!proc.killed) {
        proc.kill('SIGTERM');
        setTimeout(() => {
          if (!proc.killed) proc.kill('SIGKILL');
        }, 500);
      }
    });
  });
}
