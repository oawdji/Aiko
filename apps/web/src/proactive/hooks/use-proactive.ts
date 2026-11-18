import { useEffect, useRef } from 'react';
import type { ProactiveMessageInfo } from '@aiko/shared';
import { evaluateProactive } from '../api/proactive-api';

type Params = {
  conversationId: string;
  /** 流式回复/会话切换期间暂停触发 */
  isBusy: boolean;
  /** 收到主动消息时由调用方注入聊天流 */
  onMessage: (message: ProactiveMessageInfo) => void;
};

const IDLE_MS = 30 * 60000;
const CHECK_INTERVAL_MS = 60 * 1000;
const ATTEMPT_BACKOFF_MS = 5 * 60000;
const DISABLED_BACKOFF_MS = 55 * 60000;

/**
 * 主动消息空闲计时 hook（Phase 4，页面存活期间）：
 * - 监听用户活动，页面可见且空闲 ≥30min 时调用 evaluate（开关/上限/免打扰由服务端复验）；
 * - 被抑制不补发；disabled 状态低频探测；页面刷新/关闭即停止。
 */
export function useProactive({ conversationId, isBusy, onMessage }: Params) {
  const lastActivityRef = useRef(Date.now());
  const lastAttemptRef = useRef(0);
  const busyRef = useRef(isBusy);
  busyRef.current = isBusy;
  const convRef = useRef(conversationId);
  convRef.current = conversationId;
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    const mark = () => {
      lastActivityRef.current = Date.now();
    };
    const events: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'scroll'];
    events.forEach((e) => window.addEventListener(e, mark, { passive: true }));
    return () => events.forEach((e) => window.removeEventListener(e, mark));
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (busyRef.current) return;
      const now = Date.now();
      if (now - lastActivityRef.current < IDLE_MS) return;
      if (now - lastAttemptRef.current < ATTEMPT_BACKOFF_MS) return;
      lastAttemptRef.current = now;
      const d = new Date();
      const localMinutesOfDay = d.getHours() * 60 + d.getMinutes();
      void evaluateProactive({ conversationId: convRef.current, localMinutesOfDay })
        .then((r) => {
          if (r.send && r.message) {
            lastActivityRef.current = Date.now();
            onMessageRef.current(r.message);
          } else if (r.reason === 'disabled') {
            // 关闭状态下退避，避免每分钟空打
            lastAttemptRef.current = Date.now() + DISABLED_BACKOFF_MS;
          }
        })
        .catch(() => {});
    }, CHECK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);
}
