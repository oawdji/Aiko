import { generateText } from 'ai';
import type { DbHandle } from '../db/client';
import { resolveEffectiveLlmSettings } from '../settings/service';
import { getChatModel } from '../llm/provider';
import type { PromptMessage } from './recent-window';

/**
 * 方案 1：聊天前小调用独立抽取情绪。
 * 与主对话分开调用（max_tokens≈50），不依赖回复内嵌标记，
 * 解决多轮历史无标记时协议被上下文模仿覆盖的问题。
 * 任何失败返回 null（不产生事件），不阻断聊天流程。
 */

const EXTRACT_SYSTEM = [
  '你是情感分析模块。根据对话上下文，判断 AI 助手收到最后一条用户消息后的情绪反应。',
  '只输出一行，格式严格为：标签|强度|原因',
  '- 标签 ∈ {happy, calm, curious, neutral, low, tense}',
  '- 强度：1~5 整数',
  '- 原因：≤20字',
  '不要输出任何其他内容。',
].join('\n');

function buildExtractUserPrompt(userMessage: string, recent: PromptMessage[]): string {
  const context = recent
    .slice(-6)
    .map((m) => `${m.role === 'assistant' ? '助手' : '用户'}: ${m.content}`)
    .join('\n');
  return context
    ? `${context}\n用户: ${userMessage}\n\n助手收到"用户: ${userMessage}"后的情绪是：`
    : `用户: ${userMessage}\n\n助手收到这条消息后的情绪是：`;
}

/** 宽松解析：标签|强度|原因；标签或强度非法返回 null。 */
function parseExtractionResponse(text: string): {
  tag: string;
  intensity: number;
  reason: string;
} | null {
  const line = text.trim().split('\n').pop() ?? '';
  const match = /^\s*(happy|calm|curious|neutral|low|tense)\s*\|\s*([1-5])\s*\|\s*(.{0,20})/.exec(line);
  if (!match) return null;
  return { tag: match[1]!, intensity: Number(match[2]!), reason: match[3]?.trim() || '情绪抽取' };
}

/**
 * 独立情绪抽取。返回 null = 本次不产生情绪事件（失败/引擎关/解析失败均降级）。
 */
export async function extractEmotionViaLlm(
  handle: DbHandle,
  userMessage: string,
  recent: PromptMessage[],
): Promise<{ tag: string; intensity: number; reason: string } | null> {
  const settings = resolveEffectiveLlmSettings(handle);
  if (!settings.apiKey) return null;
  try {
    const { text } = await generateText({
      model: getChatModel({
        baseUrl: settings.baseUrl,
        model: settings.model,
        apiKey: settings.apiKey,
      }),
      system: EXTRACT_SYSTEM,
      prompt: buildExtractUserPrompt(userMessage, recent),
      maxOutputTokens: 50,
    });
    return parseExtractionResponse(text);
  } catch {
    return null;
  }
}
