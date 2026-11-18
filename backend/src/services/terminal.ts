import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import { Writable } from 'node:stream';
import { WebSocketServer, WebSocket } from 'ws';
import { authenticateCookieHeader } from '../routes/auth.js';

interface LinuxUserEntry {
  username: string;
  uid: number;
  gid: number;
  home: string;
  shell: string;
}

function lookupLinuxUser(username: string): LinuxUserEntry | null {
  if (!/^[a-z_][a-z0-9_-]{0,30}$/.test(username)) return null;
  try {
    const passwd = fs.readFileSync('/etc/passwd', 'utf-8');
    const line = passwd.split('\n').find((l) => l.startsWith(`${username}:`));
    if (!line) return null;
    const parts = line.split(':');
    if (parts.length < 7) return null;
    return {
      username,
      uid: Number(parts[2]),
      gid: Number(parts[3]),
      home: parts[5] || `/home/${username}`,
      shell: parts[6] || '/bin/bash',
    };
  } catch {
    return null;
  }
}

const PTY_PYTHON_RUNNER = `
import os, pty, select, fcntl, termios, struct, signal

target_user = os.environ.get('SILO_TERM_USER', '')
target_uid = os.environ.get('SILO_TERM_UID', '')
target_gid = os.environ.get('SILO_TERM_GID', '')
target_home = os.environ.get('SILO_TERM_HOME', '')
target_shell = os.environ.get('SILO_TERM_SHELL', '/bin/bash')

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

    if os.geteuid() == 0 and target_uid.isdigit() and target_gid.isdigit():
        uid = int(target_uid)
        gid = int(target_gid)
        if target_user:
            try:
                os.initgroups(target_user, gid)
            except Exception:
                pass
        os.setgid(gid)
        os.setuid(uid)
        if target_home and os.path.isdir(target_home):
            os.environ['HOME'] = target_home
            os.chdir(target_home)
        if target_user:
            os.environ['USER'] = target_user
            os.environ['LOGNAME'] = target_user

    shell = target_shell if os.path.exists(target_shell) and 'nologin' not in target_shell and 'false' not in target_shell else '/bin/bash'
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

function spawnPtyShell(username: string): { proc: ChildProcess; ctlStream: Writable | null } {
  const runningAsRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  const userEntry = lookupLinuxUser(username);

  if (runningAsRoot && !userEntry) {
    throw new Error(`Utente di sistema "${username}" non trovato`);
  }

  const startDir =
    userEntry && fs.existsSync(userEntry.home)
      ? userEntry.home
      : fs.existsSync(`/DATA/Homes/${username}`)
      ? `/DATA/Homes/${username}`
      : process.env.HOME || '/';

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    ...(userEntry
      ? {
          SILO_TERM_USER: userEntry.username,
          SILO_TERM_UID: String(userEntry.uid),
          SILO_TERM_GID: String(userEntry.gid),
          SILO_TERM_HOME: userEntry.home,
          SILO_TERM_SHELL: userEntry.shell,
        }
      : {}),
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

  // Fallback using util-linux `su` / `script`
  if (runningAsRoot && userEntry) {
    const proc = spawn(
      'su',
      ['-', userEntry.username, '-s', '/bin/bash', '-c', 'exec script -qfc "/bin/bash -i" /dev/null'],
      {
        cwd: startDir,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );
    return { proc, ctlStream: null };
  }

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
        wss.emit('connection', ws, req, session.username);
      });
    } catch {
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      socket.destroy();
    }
  });

  wss.on('connection', (ws: WebSocket, _req: http.IncomingMessage, username: string) => {
    let proc: ChildProcess;
    let ctlStream: Writable | null;
    try {
      ({ proc, ctlStream } = spawnPtyShell(username));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Errore avvio terminale';
      ws.send(JSON.stringify({ type: 'output', data: `\r\n\x1b[31m${msg}\x1b[0m\r\n` }));
      ws.close();
      return;
    }

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
