---
paths: api/**/*.py
---

# Python 后端规则

## 代码风格

- 类型注解必须完整
- 使用 `async def` 处理 I/O
- 文档字符串使用 Google 风格

## FastAPI 路由

```python
@router.post("/search", response_model=SearchResponse)
async def search(request: SearchRequest) -> SearchResponse:
    """执行语义搜索"""
    ...
```

## LangGraph 节点

- 节点函数纯净，无副作用
- State 使用 TypedDict 定义
- 条件边使用 Literal 类型

```python
def should_continue(state: State) -> Literal["continue", "end"]:
    return "continue" if state["needs_more"] else "end"
```

## Supabase 操作

- 使用 `supabase-py` 客户端
- 向量搜索使用 RPC 函数
- 批量操作使用事务
