import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { Router, Request, Response } from 'express';
import { requireAdmin } from './auth.js';
import { isUserAdmin, readFullSettings } from './settings.js';
import { resolveRealPathSafe } from '../services/security.js';
import {
  DATA_DIR,
  STACKS_DIR,
  deployStack,
  listStacks,
  runStackAction,
  validateComposeYaml,
  validateStackName,
} from '../services/docker.js';
import { inspectImage, searchRepositories } from '../services/registry.js';

const execFileAsync = promisify(execFile);
const router = Router();
const LOCAL_PORT = Number(process.env.PORT ?? 3000);
const AI_CHATS_DIR = path.join(DATA_DIR, '.nas-os', 'ai-chats');

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

function getUserChatFile(req: Request): string {
  const rawUser = (req as Request & { user?: string }).user || 'default';
  const safeUser = rawUser.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(AI_CHATS_DIR, `${safeUser}.json`);
}

async function readChats(req: Request): Promise<StoredAiChat[]> {
  try {
    const raw = await fs.readFile(getUserChatFile(req), 'utf-8');
    const parsed = JSON.parse(raw) as StoredAiChat[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveChats(req: Request, chats: StoredAiChat[]): Promise<void> {
  await fs.mkdir(AI_CHATS_DIR, { recursive: true, mode: 0o700 });
  await fs.writeFile(getUserChatFile(req), JSON.stringify(chats.slice(0, 30), null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  });
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

async function resolveDockerAllowedPath(rawPath: string): Promise<string> {
  const cleaned = String(rawPath ?? '').trim();
  const candidate = path.isAbsolute(cleaned)
    ? await resolveRealPathSafe(cleaned)
    : await resolveRealPathSafe(path.resolve(DATA_DIR, cleaned));
  const stacksRoot = await resolveRealPathSafe(STACKS_DIR);
  const appDataRoot = await resolveRealPathSafe(path.join(DATA_DIR, 'AppData'));
  const inStacks = candidate === stacksRoot || candidate.startsWith(`${stacksRoot}/`);
  const inAppData = candidate === appDataRoot || candidate.startsWith(`${appDataRoot}/`);
  if (!inStacks && !inAppData) {
    throw new Error('Percorso consentito solo dentro /DATA/Stacks o /DATA/AppData');
  }
  return candidate;
}

const READ_TOOLS = [
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
      name: 'read_docker_compose',
      description: 'Legge il file docker-compose.yml di uno stack Docker installato.',
      parameters: {
        type: 'object',
        properties: {
          stackName: { type: 'string', description: 'Nome dello stack Docker' },
        },
        required: ['stackName'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_docker_logs',
      description: 'Legge gli ultimi log di uno stack Docker per diagnosticare errori.',
      parameters: {
        type: 'object',
        properties: {
          stackName: { type: 'string', description: 'Nome dello stack Docker' },
          tail: { type: 'number', description: 'Numero di righe (default 80)' },
        },
        required: ['stackName'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_docker_app_file',
      description:
        'Legge un file di configurazione o .env dentro /DATA/Stacks o /DATA/AppData.',
      parameters: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: 'Percorso assoluto dentro /DATA/Stacks o /DATA/AppData',
          },
        },
        required: ['filePath'],
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
      name: 'list_users',
      description: 'Elenca gli utenti NAS/Linux di sistema.',
      parameters: { type: 'object', properties: {} },
    },
  },
];

const ADMIN_WRITE_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'write_docker_compose',
      description:
        'Modifica il docker-compose.yml di uno stack Docker e lo riavvia/rideploya (solo Admin).',
      parameters: {
        type: 'object',
        properties: {
          stackName: { type: 'string', description: 'Nome dello stack Docker' },
          yamlContent: { type: 'string', description: 'Contenuto YAML completo e valido' },
        },
        required: ['stackName', 'yamlContent'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_docker_app_file',
      description:
        'Scrive o aggiorna un file di configurazione (.env, .conf, .yml, .json) dentro /DATA/Stacks o /DATA/AppData (solo Admin).',
      parameters: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: 'Percorso assoluto dentro /DATA/Stacks o /DATA/AppData',
          },
          content: { type: 'string', description: 'Nuovo contenuto del file' },
        },
        required: ['filePath', 'content'],
      },
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

const ADMIN_ONLY_TOOL_NAMES = new Set(ADMIN_WRITE_TOOLS.map((t) => t.function.name));

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
  args: Record<string, unknown>,
  isAdmin: boolean
): Promise<unknown> {
  if (!isAdmin && ADMIN_ONLY_TOOL_NAMES.has(name)) {
    return {
      error: 'Permesso negato: solo un utente amministratore può modificare file o container Docker.',
    };
  }

  switch (name) {
    case 'get_system_status':
      return localApi('/api/system/info');
    case 'list_docker_stacks':
      return listStacks();
    case 'read_docker_compose': {
      const stackName = validateStackName(String(args.stackName ?? ''));
      const composePath = path.join(STACKS_DIR, stackName, 'docker-compose.yml');
      const yamlContent = await fs.readFile(composePath, 'utf-8');
      return { stackName, composePath, yamlContent };
    }
    case 'get_docker_logs': {
      const stackName = validateStackName(String(args.stackName ?? ''));
      const tail = Math.min(200, Math.max(10, Number(args.tail ?? 80) || 80));
      const composePath = path.join(STACKS_DIR, stackName, 'docker-compose.yml');
      const { stdout, stderr } = await execFileAsync(
        'docker',
        ['compose', '-f', composePath, 'logs', '--no-color', '--tail', String(tail)],
        { timeout: 8000 }
      );
      return { stackName, logs: (stdout + '\n' + stderr).trim() };
    }
    case 'read_docker_app_file': {
      const resolved = await resolveDockerAllowedPath(String(args.filePath ?? ''));
      const content = await fs.readFile(resolved, 'utf-8');
      return { filePath: resolved, content: content.slice(0, 16000) };
    }
    case 'write_docker_compose': {
      const stackName = validateStackName(String(args.stackName ?? ''));
      const yamlContent = String(args.yamlContent ?? '');
      validateComposeYaml(yamlContent);
      const logs: string[] = [];
      const exitCode = await deployStack(stackName, yamlContent, (msg) => {
        logs.push(msg);
      });
      return {
        success: exitCode === 0,
        exitCode,
        stackName,
        logs: logs.slice(-20),
      };
    }
    case 'write_docker_app_file': {
      const resolved = await resolveDockerAllowedPath(String(args.filePath ?? ''));
      const content = String(args.content ?? '');
      await fs.mkdir(path.dirname(resolved), { recursive: true });
      await fs.writeFile(resolved, content, 'utf-8');
      return { success: true, filePath: resolved, bytes: Buffer.byteLength(content) };
    }
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
  tools: unknown[] | null,
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
  if (tools && tools.length > 0) {
    payload.tools = tools;
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

router.post('/test', requireAdmin, async (req: Request, res: Response) => {
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
      null
    );

    const reply = result.choices?.[0]?.message?.content ?? 'OK';
    res.json({ success: true, reply });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Test connessione AI fallito';
    res.status(502).json({ error: message });
  }
});

router.get('/history', async (req: Request, res: Response) => {
  const chats = await readChats(req);
  res.json({ chats });
});

router.delete('/history/:id', async (req: Request, res: Response) => {
  const id = String(req.params.id ?? '');
  const chats = await readChats(req);
  await saveChats(req, chats.filter((c) => c.id !== id));
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

    const username = (req as Request & { user?: string }).user || 'root';
    const isAdmin = await isUserAdmin(username);
    const activeTools = isAdmin ? [...READ_TOOLS, ...ADMIN_WRITE_TOOLS] : READ_TOOLS;

    const systemPrompt: ChatMessage = {
      role: 'system',
      content: isAdmin
        ? `Sei l'assistente AI integrato di "${nasName}" (sistema operativo NAS). L'utente "${username}" è AMMINISTRATORE: puoi leggere log, leggere e modificare file docker-compose.yml e file di configurazione in /DATA/Stacks o /DATA/AppData per diagnosticare e risolvere problemi dei container, oltre a gestire stack, condivisioni e utenti. Rispondi in modo chiaro, conciso e nella lingua dell'utente.`
        : `Sei l'assistente AI integrato di "${nasName}" (sistema operativo NAS). L'utente "${username}" è un utente standard (NON amministratore): puoi solo consultare lo stato di sistema, leggere log e configurazioni in sola lettura; NON puoi modificare file, container o impostazioni. Rispondi in modo chiaro, conciso e nella lingua dell'utente.`,
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

      const chats = await readChats(req);
      const filtered = chats.filter((c) => c.id !== chatId);
      const nextChat: StoredAiChat = {
        id: chatId,
        title,
        updatedAt: new Date().toISOString(),
        messages: updatedMessages,
      };
      await saveChats(req, [nextChat, ...filtered]);
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
          useTools ? activeTools : null,
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
            null,
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
          toolResult = await executeTool(tc.function.name, parsedArgs, isAdmin);
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
