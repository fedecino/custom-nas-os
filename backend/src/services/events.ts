import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

export interface SystemNotification {
  id: string;
  level: 'info' | 'success' | 'warning';
  title: string;
  message: string;
  timestamp: string;
}

class SystemEventBus extends EventEmitter {
  private history: SystemNotification[] = [];
  private monitorStarted = false;

  notify(
    level: SystemNotification['level'],
    title: string,
    message: string
  ): SystemNotification {
    const evt: SystemNotification = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      level,
      title,
      message,
      timestamp: new Date().toISOString(),
    };
    this.history = [evt, ...this.history].slice(0, 50);
    this.emit('notification', evt);
    return evt;
  }

  getHistory(): SystemNotification[] {
    return this.history;
  }

  startBlockDeviceMonitor(): void {
    if (this.monitorStarted) return;
    this.monitorStarted = true;

    try {
      const child = spawn(
        'udevadm',
        ['monitor', '--udev', '--subsystem-match=block', '--property'],
        { stdio: ['ignore', 'pipe', 'ignore'] }
      );

      let action = '';
      let devName = '';
      let devType = '';
      let model = '';
      let bus = '';

      const flushBlock = () => {
        if ((action === 'add' || action === 'remove') && devName && !devName.includes('loop')) {
          if (devType === 'disk' || devType === 'partition') {
            const label = model ? `${devName} (${model})` : devName;
            if (action === 'add') {
              this.notify(
                'info',
                bus === 'usb' ? 'Periferica USB collegata' : 'Nuovo disco rilevato',
                `Dispositivo ${label} collegato al sistema.`
              );
            } else {
              this.notify(
                'warning',
                'Dispositivo scollegato',
                `Dispositivo ${label} rimosso dal sistema.`
              );
            }
          }
        }
        action = '';
        devName = '';
        devType = '';
        model = '';
        bus = '';
      };

      let buffer = '';
      child.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf-8');
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line) {
            flushBlock();
            continue;
          }
          if (line.startsWith('ACTION=')) action = line.slice(7);
          else if (line.startsWith('DEVNAME=')) devName = line.slice(8);
          else if (line.startsWith('DEVTYPE=')) devType = line.slice(8);
          else if (line.startsWith('ID_MODEL=')) model = line.slice(9).replace(/_/g, ' ');
          else if (line.startsWith('ID_BUS=')) bus = line.slice(7);
        }
      });

      child.on('error', () => {
        this.monitorStarted = false;
      });
    } catch {
      this.monitorStarted = false;
    }
  }
}

export const systemEvents = new SystemEventBus();
