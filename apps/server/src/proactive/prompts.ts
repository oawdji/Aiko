import { PERSONA_ANCHORS, type PersonaEvolvable } from '@aiko/shared';

/** 主动消息生成指令（追加在人格锚点 + 风格段之后）。 */
export const PROACTIVE_INSTRUCTIONS = [
  '现在没有用户输入，请你**主动发起一条简短的消息**。',
  '规则：',
  '1. 不超过两句话，口语化，符合你当前的心情和说话风格；',
  '2. 只基于下面给出的线索，自然地提起，不要照抄线索原文；',
  '3. 不要重复最近聊过的内容；不要说教、不要长篇大论；',
  '4. 直接输出消息正文，不要 JSON、不要任何解释或舞台指示（如 *微笑*）。',
].join('\n');

export function buildEmotionCarePrompt(evidence: string): string {
  return [
    '线索：上一次对话中，用户的情绪明显偏低（' + evidence + '），之后你们没有再聊过。',
    '请以朋友的口吻自然地表达关心，问问现在感觉怎么样。',
    '语气克制温柔，不要小题大做，也不要连环追问。',
  ].join('\n');
}

export function buildMemoryRecallPrompt(memoryContent: string): string {
  return [
    '线索：你记得一件之前聊过的事：「' + memoryContent + '」。',
    '这件事已经有一段时间没提起了。请自然地想起来并问问近况。',
    '像突然想起来一样，不要用“根据我的记忆”之类的说法。',
  ].join('\n');
}

export function buildCuriousPrompt(recentTopicHint: string): string {
  return [
    '线索：你们最近聊到过「' + recentTopicHint + '」。',
    '请基于这个话题提出一个轻松的开放式小问题，表现出你的好奇。',
  ].join('\n');
}

/** 风格段渲染所需的最小说明（供 service 组装 system 时引用，保持词表一致）。 */
export function styleHint(e: PersonaEvolvable): string {
  return (
    '（当前风格：warmth=' + e.warmth + ', humor=' + e.humor + ', verbosity=' + e.verbosity + '，' +
    PERSONA_ANCHORS.verbosity.values[e.verbosity] + '）'
  );
}
