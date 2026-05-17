export interface ChatSidebarSessionItem {
  id: string;
  title: string;
}

export function getVisibleChatSidebarItems(
  sessions: ChatSidebarSessionItem[],
): ChatSidebarSessionItem[] {
  return sessions.map((session) => ({
    id: session.id,
    title: session.title,
  }));
}

export function createConversationTitle(prompt: string) {
  const normalizedPrompt = prompt.trim().replace(/\s+/g, ' ');
  const maxLength = 43;

  if (normalizedPrompt.length <= maxLength) {
    return normalizedPrompt;
  }

  return `${normalizedPrompt.slice(0, maxLength - 3).replace(/[,\s]+$/, '')}...`;
}
