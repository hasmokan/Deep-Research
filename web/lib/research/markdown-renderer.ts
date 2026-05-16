import MarkdownIt from 'markdown-it';

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
});

export function renderMarkdown(content: string | null | undefined) {
  return markdown.render(content ?? '');
}
