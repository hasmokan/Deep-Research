---
paths: web/**/*.tsx, web/**/*.ts
---

# Next.js 前端规则

## 组件规范

- Server Components 默认，Client Components 仅用于交互/hooks
- 文件顶部 `'use client'` 标记客户端组件
- Props 使用 interface 定义，命名为 `{ComponentName}Props`

## App Router

- 页面文件: `page.tsx`
- 布局文件: `layout.tsx`
- 加载状态: `loading.tsx`
- 错误边界: `error.tsx`

## Tailwind CSS

- 优先使用 Tailwind 类，避免自定义 CSS
- 响应式: `sm:` `md:` `lg:` `xl:`
- 暗色模式: `dark:` 前缀

## 数据获取

```tsx
// Server Component 直接 fetch
async function Page() {
  const data = await fetch(`${API_URL}/endpoint`, { cache: 'no-store' })
  return <Component data={data} />
}
```
