export type ChatMessageRole = 'user' | 'assistant' | 'system';

export type ChatMessageStatus = 'streaming' | 'complete' | 'failed';

export type ChatMessageDTO = {
  id: string;
  conversationId: string;
  agentId: string;
  role: ChatMessageRole;
  content: string;
  status: ChatMessageStatus;
  errorCode: string | null;
  createdAt: string;
};