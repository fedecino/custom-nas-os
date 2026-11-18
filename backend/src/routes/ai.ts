import { Router, Request, Response } from 'express';
import { readFullSettings } from './settings.js';
import {
  deployStack,
  listStacks,
  runStackAction,
} from '../services/docker.js';
import { inspectImage, searchRepositories } from '../services/registry.js';

const router = Router();
const LOCAL_PORT = Number(process.env.PORT ?? 3000);

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_call_id?: string;
  name?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
}

const NAS_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_system_status',
      description:
        'Ottiene lo stato attuale del NAS: uso CPU, RAM, traffico rete, uptime e dischi montati.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_docker_stacks',
      description:
        'Elenca tutti gli stack Docker Compose e i container installati sul NAS con il loro stato.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'manage_docker_stack',
      description: 'Avvia, ferma, riavvia o rimuove uno stack Docker esistente.',
      parameters: {
        type: 'object',
        properties: {
          stackName: { type: 'string', description: 'Nome dello stack Docker' },
          action: {
            type: 'string',
            enum: ['start', 'stop', 'restart', 'remove'],
            description: 'Azione da eseguire sullo stack',
          },
        },
        required: ['stackName', 'action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_docker_hub',
      description: 'Cerca immagini Docker su Docker Hub.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Termine di ricerca (es. nginx, jellyfin)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'deploy_docker_app',
      description:
        'Ispeziona un immagine Docker Hub e la installa/avvia automaticamente come stack Docker Compose.',
      parameters: {
        type: 'object',
        properties: {
          image: { type: 'string', description: 'Nome immagine (es. nginx, jellyfin/jellyfin)' },
          tag: { type: 'string', description: 'Tag immagine (default latest)' },
          stackName: { type: 'string', description: 'Nome stack opzionale' },
        },
        required: ['image'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_disks',
      description: 'Elenca dischi fisici, partizioni (lsblk) e volumi montati.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_shares_and_services',
      description:
        'Elenca le condivisioni SMB/NFS/FTP configurate e lo stato dei servizi smbd, nfs-kernel-server, vsftpd, ssh.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_share',
      description: 'Crea una nuova cartella condivisa SMB/NFS/FTP sul NAS.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Nome condivisione (es. Media)' },
          smb: { type: 'boolean', description: 'Abilita SMB/Samba' },
          nfs: { type: 'boolean', description: 'Abilita NFS' },
          ftp: { type: 'boolean', description: 'Abilita FTP' },
          readOnly: { type: 'boolean', description: 'Sola lettura' },
          guestOk: { type: 'boolean', description: 'Accesso guest senza password' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'control_nas_service',
      description: 'Avvia, ferma o riavvia un servizio di rete NAS (smbd, nfs-kernel-server, vsftpd, ssh).',
      parameters: {
        type: 'object',
        properties: {
          service: {
            type: 'string',
            enum: ['smbd', 'nfs-kernel-server', 'vsftpd', 'ssh'],
          },
          action: {
            type: 'string',
            enum: ['start', 'stop', 'restart'],
          },
        },
        required: ['service', 'action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_users',
      description: 'Elenca gli utenti NAS/Linux di sistema.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_user',
      description: 'Crea un nuovo utente sul NAS con accesso opzionale SMB e SSH/SFTP.',
      parameters: {
        type: 'object',
        properties: {
          username: { type: 'string' },
          password: { type: 'string' },
          sambaAccess: { type: 'boolean' },
          sshAccess: { type: 'boolean' },
          sudoAccess: { type: 'boolean' },
        },
        required: ['username', 'password'],
      },
    },
  },
];

async function localApi(path: string, method = 'GET', body?: unknown): Promise<unknown> {
  const res = await fetch(`http://127.0.0.1:${LOCAL_PORT}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

async function executeTool(
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  switch (name) {
    case 'get_system_status':
      return localApi('/api/system/info');
    case 'list_docker_stacks':
      return listStacks();
    case 'manage_docker_stack':
      return runStackAction(
        String(args.stackName ?? ''),
        String(args.action ?? 'restart') as 'start' | 'stop' | 'restart' | 'remove'
      );
    case 'search_docker_hub':
      return searchRepositories(String(args.query ?? ''), 10);
    case 'deploy_docker_app': {
      const image = String(args.image ?? '');
      const tag = String(args.tag ?? 'latest') || 'latest';
      const inspected = await inspectImage(image, tag);
      const stackName = String(args.stackName ?? '').trim() || inspected.appName;
      const logs: string[] = [];
      const exitCode = await deployStack(stackName, inspected.composeYaml, (msg) => {
        logs.push(msg);
      });
      return {
        success: exitCode === 0,
        exitCode,
        stackName,
        image: `${inspected.image}:${inspected.tag}`,
        exposedPorts: inspected.exposedPorts,
        logs: logs.slice(-15),
      };
    }
    case 'list_disks':
      return localApi('/api/storage/disks');
    case 'list_shares_and_services':
      return localApi('/api/shares');
    case 'create_share':
      return localApi('/api/shares', 'POST', args);
    case 'control_nas_service':
      return localApi(
        `/api/shares/services/${encodeURIComponent(String(args.service))}/${encodeURIComponent(String(args.action))}`,
        'POST',
        {}
      );
    case 'list_users':
      return localApi('/api/users');
    case 'create_user':
      return localApi('/api/users', 'POST', args);
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

async function callChatCompletion(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  useTools: boolean
) {
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const payload: Record<string, unknown> = {
    model,
    messages,
    temperature: 0.2,
  };
  if (useTools) {
    payload.tools = NAS_TOOLS;
    payload.tool_choice = 'auto';
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`LLM API error (${res.status}): ${errText}`);
  }

  return (await res.json()) as {
    choices?: Array<{
      message?: ChatMessage;
    }>;
  };
}

router.post('/test', async (req: Request, res: Response) => {
  try {
    const saved = await readFullSettings();
    const body = req.body as {
      baseUrl?: string;
      model?: string;
      apiKey?: string;
    };

    const baseUrl = (body.baseUrl ?? saved.ai.baseUrl).trim();
    const model = (body.model ?? saved.ai.model).trim();
    const apiKey = (body.apiKey?.trim() || saved.ai.apiKey || '').trim();

    if (!baseUrl || !model) {
      res.status(400).json({ error: 'Base URL e Modello sono obbligatori' });
      return;
    }

    const result = await callChatCompletion(
      baseUrl,
      apiKey,
      model,
      [{ role: 'user', content: 'Rispondi solo con: OK' }],
      false
    );

    const reply = result.choices?.[0]?.message?.content ?? 'OK';
    res.json({ success: true, reply });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Test connessione AI fallito';
    res.status(502).json({ error: message });
  }
});

router.post('/chat', async (req: Request, res: Response) => {
  try {
    const { ai, nasName } = await readFullSettings();
    if (!ai.enabled) {
      res.status(400).json({
        error: 'Assistente AI disabilitato. Abilitalo nelle Impostazioni.',
      });
      return;
    }
    if (!ai.baseUrl || !ai.model) {
      res.status(400).json({
        error: 'Configurazione AI incompleta (Base URL o Modello mancante).',
      });
      return;
    }

    const userMessages = (req.body as { messages?: ChatMessage[] }).messages ?? [];
    const systemPrompt: ChatMessage = {
      role: 'system',
      content: `Sei l'assistente AI integrato di "${nasName}" (sistema operativo NAS basato su Debian 13). Puoi controllare e gestire il NAS usando gli strumenti (tools) disponibili: stato CPU/RAM/Rete/Dischi, container Docker e App Store, condivisioni SMB/NFS/FTP/SSH e utenti. Rispondi in modo chiaro, conciso e nella lingua dell'utente.`,
    };

    const conversation: ChatMessage[] = [systemPrompt, ...userMessages.slice(-16)];
    const executedTools: Array<{ name: string; ok: boolean }> = [];
    let useTools = true;

    for (let step = 0; step < 6; step++) {
      let data;
      try {
        data = await callChatCompletion(
          ai.baseUrl,
          ai.apiKey,
          ai.model,
          conversation,
          useTools
        );
      } catch (err) {
        // Fallback if local model doesn't support tool calling
        if (useTools && step === 0) {
          useTools = false;
          data = await callChatCompletion(
            ai.baseUrl,
            ai.apiKey,
            ai.model,
            conversation,
            false
          );
        } else {
          throw err;
        }
      }

      const assistantMsg = data.choices?.[0]?.message;
      if (!assistantMsg) {
        throw new Error('Risposta vuota dal modello AI');
      }

      conversation.push(assistantMsg);

      if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
        res.json({
          reply: assistantMsg.content ?? '',
          toolCalls: executedTools,
        });
        return;
      }

      for (const tc of assistantMsg.tool_calls) {
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
        } catch {
          parsedArgs = {};
        }

        let toolResult: unknown;
        let ok = true;
        try {
          toolResult = await executeTool(tc.function.name, parsedArgs);
        } catch (err) {
          ok = false;
          toolResult = {
            error: err instanceof Error ? err.message : 'Tool execution failed',
          };
        }

        executedTools.push({ name: tc.function.name, ok });
        conversation.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: tc.function.name,
          content: JSON.stringify(toolResult),
        });
      }
    }

    res.json({
      reply: 'Operazione completata (raggiunto limite massimo di step tool).',
      toolCalls: executedTools,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Errore agente AI';
    res.status(502).json({ error: message });
  }
});

export default router;
