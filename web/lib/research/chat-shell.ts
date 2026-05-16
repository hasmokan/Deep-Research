export const chatSidebarRecents = [
  'Eating Habits Analysis',
  'Translate German to English',
  'Noodle observation',
  'Noodles boiling observation',
  'Greeting conversation',
  'Meeting planning assistance',
  '面试准备建议',
  '总结面试回答不足',
  '面试经验总结',
  '哈希表原理解析',
  'HTTP 八股文解析',
  'Gstack与Superpowers对比',
];

export function createConversationTitle(prompt: string) {
  const normalizedPrompt = prompt.trim().replace(/\s+/g, ' ');
  const maxLength = 43;

  if (normalizedPrompt.length <= maxLength) {
    return normalizedPrompt;
  }

  return `${normalizedPrompt.slice(0, maxLength - 3).replace(/[,\s]+$/, '')}...`;
}
