import type { AgentMessage, Document } from '@/lib/api/types';
import type { TokenUsageDirection } from './token-usage';

export function getAgentMessageTokenEstimate(
  message: AgentMessage,
): { text: string; direction: TokenUsageDirection } | null {
  if (message.type === 'ai') {
    const toolCallText = message.tool_calls
      ?.map((toolCall) => `${toolCall.name} ${JSON.stringify(toolCall.args)}`)
      .join('\n') ?? '';
    const text = [message.reasoning_content, message.content, toolCallText].filter(Boolean).join('\n');
    return text ? { text, direction: 'output' } : null;
  }

  return message.content ? { text: message.content, direction: 'input' } : null;
}

export function getDocumentsTokenEstimate(documents: Document[]) {
  return documents
    .map((document) => `${document.metadata.title ?? ''}\n${document.content}`)
    .join('\n');
}
