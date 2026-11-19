import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_AGENT_ID } from '@aiko/shared';
import type {
  BootstrapResponse,
  ChatMessageDTO,
  ConversationListItem,
  SettingsResponse,
} from '@aiko/shared';
import { HistorySidebar } from '../chat/components/HistorySidebar';
import { MessageComposer } from '../chat/components/MessageComposer';
import { MessageList } from '../chat/components/MessageList';
import { useAgentChat } from '../chat/hooks/use-agent-chat';
import { extractStateEvents } from '../chat/utils/extract-state-events';
import { DevChecklist } from './DevChecklist';
import { SettingsDialog } from '../settings/components/SettingsDialog';
import {
  clearConversations,
  createConversation,
  deleteConversation,
  fetchConversation,
  fetchConversationList,
} from '../shared/api/chat-recovery';
import { fetchPlugins } from '../shared/api/plugins-api';
import { fetchSettings } from '../shared/api/settings-api';
import { MemoryViewer } from '../memories/components/MemoryViewer';
import { PersonaPanel } from '../persona/components/PersonaPanel';
import { fetchMemories } from '../shared/api/memories-api';
import { StatusTimeline } from '../status/components/StatusTimeline';
import { StatusPanel } from '../status/components/StatusPanel';
import { ErrorNotice } from '../shared/components/ErrorNotice';
import { useServerHealth } from '../shared/hooks/useServerHealth';
import { agentStateStore } from '../shared/stores/agent-state-store';

type ChatStatus = 'submitted' | 'streaming' | 'ready' | 'error';

function previewFromMessages(messages: ChatMessageDTO[]): string | null {
  const firstUser = messages.find((message) => message.role === 'user');
  if (!firstUser) return null;
  const flat = firstUser.content.replace(/\s+/g, ' ').trim();
  if (!flat) return null;
  return flat.length > 80 ? `${flat.slice(0, 80)}…` : flat;
}

function ChatTranscript({
  restoredMessages,
  conversationId,
  agentId,
  onStatus,
  onUpdated,
}: {
  restoredMessages: ChatMessageDTO[];
  conversationId: string;
  agentId: string;
  onStatus: (status: ChatStatus) => void;
  onUpdated: () => void;
}) {
  const { messages, sendMessage, status, stop, error, regenerate } = useAgentChat({
    restoredMessages,
    conversationId,
    agentId,
  });
  const statusRef = useRef(status);

  const stateEvents = extractStateEvents(messages);
  const appliedEventIdRef = useRef<string | null>(
    agentStateStore.getState().latestEvent?.id ?? null,
  );

  useEffect(() => {
    const latest = stateEvents.at(-1);
    if (latest && latest.id !== appliedEventIdRef.current) {
      appliedEventIdRef.current = latest.id;
      agentStateStore.applyStateEvent(latest);
    }
  }, [stateEvents]);

  useEffect(() => {
    const previous = statusRef.current;
    statusRef.current = status;
    onStatus(status);
    const wasBusy = previous === 'submitted' || previous === 'streaming';
    if (wasBusy && status === 'ready') onUpdated();
  }, [status, onStatus, onUpdated]);

  const isBusy = status === 'submitted' || status === 'streaming';

  return (
    <>
      <MessageList
        messages={messages}
        disabled={isBusy}
        onRegenerate={isBusy ? undefined : () => regenerate()}
      />

      {status === 'error' && (
        <div className="px-4 pb-2">
          <ErrorNotice
            message={error instanceof Error ? error.message : String(error ?? '未知错误')}
            hint={/DUPLICATE_CLIENT_MESSAGE/.test(error?.message ?? String(error)) ? "消息重复：已从服务端刷新会话，请勿重发同一内容" : "请检查本地服务与 LLM 配置后重试"}
          />
        </div>
      )}

      <div className="border-t border-neutral-800 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <MessageComposer
          onSend={(text) => {
            void sendMessage({ text });
          }}
          onStop={stop}
          isBusy={isBusy}
        />
      </div>
    </>
  );
}

/**
 * 聊天主视图（M2.5）：
 * - 仅在 bootstrap ready 后挂载，恢复消息一次性注入 useChat；
 * - 流式 data part 事件经 effect 单向写入 AgentStateStore（§633 流程），
 *   store 内部按事件 id 去重，不产生第二套消息存储。
 */
export function ChatView({ bootstrap }: { bootstrap: BootstrapResponse }) {
  const serverStatus = useServerHealth();
  const [session, setSession] = useState({
    id: bootstrap.conversation.id,
    messages: bootstrap.messages,
  });
  const [historyItems, setHistoryItems] = useState<ConversationListItem[]>([
    { ...bootstrap.conversation, preview: previewFromMessages(bootstrap.messages) },
  ]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const [chatStatus, setChatStatus] = useState<ChatStatus>('ready');
  const [pluginLinks, setPluginLinks] = useState<
    Array<{ pluginId: string; label: string; url: string }>
  >([]);

  const isBusy = chatStatus === 'submitted' || chatStatus === 'streaming';

  const loadHistory = useCallback(
    (signal?: AbortSignal) => {
      return fetchConversationList(bootstrap.agent.id, { signal })
        .then((data) => {
          if (signal?.aborted) return;
          setHistoryItems(data.items);
          setHistoryError(null);
        })
        .catch((error: unknown) => {
          if (signal?.aborted) return;
          setHistoryError(error instanceof Error ? error.message : '历史记录加载失败');
        });
    },
    [bootstrap.agent.id],
  );

  useEffect(() => {
    const controller = new AbortController();
    setHistoryLoading(true);
    void loadHistory(controller.signal).finally(() => {
      if (!controller.signal.aborted) setHistoryLoading(false);
    });
    return () => controller.abort();
  }, [loadHistory]);
  // 插件声明的前端插槽（工具链接），声明式无代码扩展
  useEffect(() => {
    fetchPlugins()
      .then((data) => setPluginLinks(data.uiLinks ?? []))
      .catch(() => setPluginLinks([]));
  }, []);

  const refreshHistory = useCallback(() => {
    void loadHistory();
  }, [loadHistory]);

  const selectConversation = useCallback(
    (id: string) => {
      if (isBusy || opening) return;
      if (id === session.id) {
        setHistoryOpen(false);
        return;
      }
      setOpening(true);
      setOpenError(null);
      void fetchConversation(id)
        .then((detail) => {
          setSession({ id: detail.conversation.id, messages: detail.messages });
          setChatStatus('ready');
          setHistoryOpen(false);
        })
        .catch((error: unknown) => {
          setOpenError(error instanceof Error ? error.message : '会话打开失败');
        })
        .finally(() => setOpening(false));
    },
    [isBusy, opening, session.id],
  );

  /** 删除单个会话：从列表移除；若是当前会话则切换到最近的其余会话，没有则重新 bootstrap。 */
  const handleDeleteConversation = (id: string) => {
    void deleteConversation(id)
      .then(() => {
        const rest = historyItems.filter((item) => item.id !== id);
        setHistoryItems(rest);
        if (id === session.id) {
          const next = rest[0];
          if (next) {
            selectConversation(next.id);
          } else {
            window.location.reload();
          }
        }
      })
      .catch((error: unknown) => {
        setOpenError(error instanceof Error ? error.message : '会话删除失败');
      });
  };

  /** 清空全部会话（不可恢复）：清空后重新 bootstrap 获得全新会话。 */
  const handleClearConversations = () => {
    void clearConversations()
      .then(() => window.location.reload())
      .catch((error: unknown) => {
        setOpenError(error instanceof Error ? error.message : '清空会话失败');
      });
  };

  /** 手动新建空白会话：立即切换，并把它插入历史列表最前。 */
  const handleCreateConversation = () => {
    if (isBusy || opening) return;
    setOpening(true);
    setOpenError(null);
    void createConversation(bootstrap.agent.id)
      .then((res) => {
        setSession({ id: res.conversation.id, messages: [] });
        setChatStatus('ready');
        setHistoryItems((items) => [
          { ...res.conversation, preview: null },
          ...items.filter((item) => item.id !== res.conversation.id),
        ]);
        setHistoryOpen(false);
      })
      .catch((error: unknown) => {
        setOpenError(error instanceof Error ? error.message : '新建会话失败');
      })
      .finally(() => setOpening(false));
  };

  const [llmSettings, setLlmSettings] = useState<SettingsResponse | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => {
    if (!panelOpen && !historyOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !settingsOpen) {
        setPanelOpen(false);
        setHistoryOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panelOpen, historyOpen, settingsOpen]);
  const [memoriesOpen, setMemoriesOpen] = useState(false);
  const [personaOpen, setPersonaOpen] = useState(false);

  // 待确认记忆数徽标：挂载时与查看器开关变化后刷新
  const [candidateMemoryCount, setCandidateMemoryCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    fetchMemories({ status: 'candidate', limit: 1 })
      .then((r) => {
        if (!cancelled) setCandidateMemoryCount(r.total ?? 0);
      })
      .catch(() => {
        // 徽标获取失败静默忽略，不影响聊天
      });
    return () => {
      cancelled = true;
    };
  }, [memoriesOpen]);

  useEffect(() => {
    let cancelled = false;
    fetchSettings()
      .then((data) => {
        if (!cancelled) setLlmSettings(data);
      })
      .catch(() => {
        // 设置读取失败不阻塞聊天，弹窗内可重试
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const llmConfigured = llmSettings?.llm.apiKeyConfigured ?? true;

  return (
    <main className="flex h-dvh bg-neutral-950 text-neutral-100">
      {historyOpen && (
        <button
          type="button"
          aria-label="关闭历史记录"
          className="fixed inset-0 z-30 bg-black/60 lg:hidden"
          onClick={() => setHistoryOpen(false)}
        />
      )}

      <aside
        className={`${
          historyOpen ? 'fixed inset-y-0 left-0 z-40 flex w-[min(100%,16rem)]' : 'hidden'
        } min-h-0 border-r border-neutral-800 bg-neutral-950 lg:static lg:z-auto lg:flex lg:w-60 lg:shrink-0`}
      >
        <HistorySidebar
          items={historyItems}
          activeId={session.id}
          loading={historyLoading}
          error={historyError}
          disabled={isBusy || opening}
          onSelect={selectConversation}
          onNew={handleCreateConversation}
          onDelete={handleDeleteConversation}
          onClearAll={handleClearConversations}
          onRetry={refreshHistory}
          uiLinks={pluginLinks}
          onClose={() => setHistoryOpen(false)}
        />
      </aside>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex items-center gap-2 border-b border-neutral-800 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 sm:gap-3 sm:px-4">
          <button
            type="button"
            aria-label="打开历史记录"
            onClick={() => {
              setPanelOpen(false);
              setHistoryOpen(true);
            }}
            className="shrink-0 rounded-lg border border-neutral-700 px-3 py-2 text-xs text-neutral-300 hover:bg-neutral-800 lg:hidden"
          >
            历史
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold">{bootstrap.agent.displayName}</h1>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-neutral-400">
              <span>已载入 {session.messages.length} 条</span>
              <span>
                后端：
                {serverStatus === 'checking' && '检测中…'}
                {serverStatus === 'ok' && <span className="text-emerald-400">已连接</span>}
                {serverStatus === 'error' && <span className="text-red-400">未连接</span>}
              </span>
              <span className="hidden sm:inline">Agent: {DEFAULT_AGENT_ID}</span>
            </p>
          </div>
          <button
            type="button"
            aria-label="打开状态面板"
            onClick={() => {
              setHistoryOpen(false);
              setPanelOpen(true);
            }}
            className="shrink-0 rounded-lg border border-neutral-700 px-3 py-2 text-xs text-neutral-300 hover:bg-neutral-800 lg:hidden"
          >
            状态
          </button>
          <button
            type="button"
            aria-label="打开记忆查看器"
            onClick={() => setMemoriesOpen(true)}
            className="shrink-0 rounded-lg border border-neutral-700 px-3 py-2 text-xs text-neutral-300 hover:bg-neutral-800"
          >
            🧠 记忆
            {candidateMemoryCount > 0 && (
              <span
                aria-label={candidateMemoryCount + ' 条记忆待确认'}
                className="ml-1 rounded-full bg-amber-500 px-1.5 text-[10px] font-semibold text-neutral-950"
              >
                {candidateMemoryCount}
              </span>
            )}
          </button>
          <button
            type="button"
            aria-label="打开人格面板"
            onClick={() => setPersonaOpen(true)}
            className="shrink-0 rounded-lg border border-neutral-700 px-3 py-2 text-xs text-neutral-300 hover:bg-neutral-800"
          >
            🎭 人格
          </button>
          <button
            type="button"
            aria-label="打开设置"
            onClick={() => setSettingsOpen(true)}
            className="shrink-0 rounded-lg border border-neutral-700 px-3 py-2 text-xs text-neutral-300 hover:bg-neutral-800"
          >
            设置
          </button>
        </header>

        {!llmConfigured && (
          <div className="mx-4 mt-3 flex flex-col gap-2 rounded-lg border border-amber-700/50 bg-amber-950/40 px-4 py-2 text-xs text-amber-300 sm:flex-row sm:items-center sm:justify-between">
            <span>尚未配置 LLM API Key，发送消息前请先完成设置。</span>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="shrink-0 rounded-md bg-amber-600 px-3 py-1.5 font-medium text-neutral-950 hover:bg-amber-500"
            >
              去设置
            </button>
          </div>
        )}

        {openError && (
          <div className="px-4 pt-3">
            <ErrorNotice message={openError} hint="请重新选择左侧的历史会话" />
          </div>
        )}

        <div className="relative flex min-h-0 flex-1 flex-col">
          <ChatTranscript
            key={session.id}
            restoredMessages={session.messages}
            conversationId={session.id}
            agentId={bootstrap.agent.id}
            onStatus={setChatStatus}
            onUpdated={refreshHistory}
          />
          {opening && (
            <div className="absolute inset-0 flex items-center justify-center bg-neutral-950/70 text-sm text-neutral-300">
              正在打开会话…
            </div>
          )}
        </div>
      </section>

      {panelOpen && (
        <button
          type="button"
          aria-label="关闭状态面板"
          className="fixed inset-0 z-30 bg-black/60 lg:hidden"
          onClick={() => setPanelOpen(false)}
        />
      )}

      <aside
        aria-label="状态面板"
        className={`${
          panelOpen ? 'fixed inset-y-0 right-0 z-40 flex w-[min(100%,20rem)]' : 'hidden'
        } flex-col gap-3 overflow-y-auto border-l border-neutral-800 bg-neutral-950 p-4 pt-[max(1rem,env(safe-area-inset-top))] lg:static lg:z-auto lg:flex lg:w-80 lg:shrink-0`}
      >
        <div className="flex items-center justify-between lg:hidden">
          <h2 className="text-sm font-semibold">状态与联调</h2>
          <button
            type="button"
            aria-label="关闭状态面板"
            onClick={() => setPanelOpen(false)}
            className="rounded-md px-2 py-1 text-sm text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
          >
            关闭
          </button>
        </div>
        <StatusPanel />
        <StatusTimeline agentId={bootstrap.agent.id} />
        <DevChecklist />
      </aside>

      <SettingsDialog
        open={settingsOpen}
        settings={llmSettings}
        onSaved={(data) => setLlmSettings(data)}
        onClose={() => setSettingsOpen(false)}
      />

      <MemoryViewer open={memoriesOpen} onClose={() => setMemoriesOpen(false)} />
      <PersonaPanel open={personaOpen} onClose={() => setPersonaOpen(false)} />
    </main>
  );
}