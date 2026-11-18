import fs from 'node:fs/promises';
import path from 'node:path';
import { Router, Request, Response } from 'express';
import { readFullSettings } from './settings.js';
import {
  DATA_DIR,
  deployStack,
  listStacks,
  runStackAction,
} from '../services/docker.js';
import { inspectImage, searchRepositories } from '../services/registry.js';

const router = Router();
const LOCAL_PORT = Number(process.env.PORT ?? 3000);
const AI_CHATS_FILE = path.join(DATA_DIR, '.nas-os', 'ai-chats.json');

interface StoredAiChat {
  id: string;
  title: string;
  updatedAt: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
    toolCalls?: Array<{ name: string; ok: boolean }>;
  }>;
}

async function readChats(): Promise<StoredAiChat[]> {
  try {
    const raw = await fs.readFile(AI_CHATS_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as StoredAiChat[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveChats(chats: StoredAiChat[]): Promise<void> {
  await fs.mkdir(path.dirname(AI_CHATS_FILE), { recursive: true });
  await fs.writeFile(AI_CHATS_FILE, JSON.stringify(chats.slice(0, 30), null, 2), 'utf-8');
}

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
  useTools: boolean,
  signal?: AbortSignal
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
    signal,
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

router.get('/history', async (_req: Request, res: Response) => {
  const chats = await readChats();
  res.json({ chats });
});

router.delete('/history/:id', async (req: Request, res: Response) => {
  const id = String(req.params.id ?? '');
  const chats = await readChats();
  await saveChats(chats.filter((c) => c.id !== id));
  res.json({ success: true });
});

router.post('/chat', async (req: Request, res: Response) => {
  const abortController = new AbortController();
  req.on('close', () => {
    if (!res.writableEnded) {
      abortController.abort();
    }
  });

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

    const body = req.body as {
      chatId?: string;
      messages?: Array<{
        role: 'user' | 'assistant';
        content: string;
        toolCalls?: Array<{ name: string; ok: boolean }>;
      }>;
    };

    const rawUiMessages = body.messages ?? [];
    const userMessages: ChatMessage[] = rawUiMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const systemPrompt: ChatMessage = {
      role: 'system',
      content: `Sei l'assistente AI integrato di "${nasName}" (sistema operativo NAS). Puoi controllare e gestire il NAS usando gli strumenti (tools) disponibili: stato CPU/RAM/Rete/Dischi, container Docker e App Store, condivisioni SMB/NFS/FTP/SSH e utenti. Rispondi in modo chiaro, conciso e nella lingua dell'utente.`,
    };

    const conversation: ChatMessage[] = [systemPrompt, ...userMessages.slice(-16)];
    const executedTools: Array<{ name: string; ok: boolean }> = [];
    let useTools = true;

    const persistConversation = async (replyText: string) => {
      const chatId =
        body.chatId || `chat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const firstUserMsg = rawUiMessages.find((m) => m.role === 'user')?.content ?? 'Nuova chat';
      const title =
        firstUserMsg.length > 46 ? `${firstUserMsg.slice(0, 46)}...` : firstUserMsg;

      const updatedMessages: StoredAiChat['messages'] = [
        ...rawUiMessages,
        { role: 'assistant', content: replyText, toolCalls: executedTools },
      ];

      const chats = await readChats();
      const filtered = chats.filter((c) => c.id !== chatId);
      const nextChat: StoredAiChat = {
        id: chatId,
        title,
        updatedAt: new Date().toISOString(),
        messages: updatedMessages,
      };
      await saveChats([nextChat, ...filtered]);
      return chatId;
    };

    for (let step = 0; step < 6; step++) {
      let data;
      try {
        data = await callChatCompletion(
          ai.baseUrl,
          ai.apiKey,
          ai.model,
          conversation,
          useTools,
          abortController.signal
        );
      } catch (err) {
        if (abortController.signal.aborted) return;
        // Fallback if local model doesn't support tool calling
        if (useTools && step === 0) {
          useTools = false;
          data = await callChatCompletion(
            ai.baseUrl,
            ai.apiKey,
            ai.model,
            conversation,
            false,
            abortController.signal
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
        const reply = assistantMsg.content ?? '';
        const chatId = await persistConversation(reply);
        res.json({
          chatId,
          reply,
          toolCalls: executedTools,
        });
        return;
      }

      for (const tc of assistantMsg.tool_calls) {
        if (abortController.signal.aborted) return;
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

    const fallbackReply = 'Operazione completata (raggiunto limite massimo di step tool).';
    const chatId = await persistConversation(fallbackReply);
    res.json({
      chatId,
      reply: fallbackReply,
      toolCalls: executedTools,
    });
  } catch (err) {
    if (abortController.signal.aborted || res.writableEnded) return;
    const message = err instanceof Error ? err.message : 'Errore agente AI';
    res.status(502).json({ error: message });
  }
});

export default router;
