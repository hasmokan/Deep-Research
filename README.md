# Deep Research

Deep Research 是一个面向研究型问答的全栈应用：前端使用 Next.js，后端使用 FastAPI，研究流程由 LangGraph / LangChain 编排，支持 OpenAI 兼容模型、Supabase 存储和可选 Langfuse 观测。

## 项目简介

Deep Research 旨在把一次复杂研究拆解成可追踪、可复用、可展示的完整流程。用户输入一个研究问题后，系统会围绕问题进行搜索、信息筛选、分析整理和报告生成，并在前端以对话进度、来源列表、推理状态和最终报告的形式呈现结果。

项目的核心目标不是简单返回一段回答，而是提供一个更接近“研究助手”的工作台：前端负责承载清晰的交互体验和报告阅读体验，后端负责组织模型调用、搜索工具、状态流和持久化数据。它可以用于人物背景调查、主题研究、资料汇总、竞品分析、内容选题调研等需要多步骤信息处理的场景。

当前项目已经包含本地开发、Docker 热更新、生产构建、服务器部署和 GitHub Actions 自动部署流程，适合作为一个可继续扩展的 AI research 产品原型。

生产环境当前部署在：

```text
https://eyjamini.com/ds
```

健康检查：

```text
https://eyjamini.com/ds/health
```

## 功能

- 研究问题输入、执行和结果展示
- LangGraph 驱动的搜索、分析、报告生成流程
- 支持本地 JSON 存储或 Supabase 持久化
- 支持 Google 登录和用户隔离
- 支持 Langfuse trace，用于观察研究流程质量
- Docker Compose 部署
- GitHub Actions 自动部署到服务器

## 技术栈

前端：

- Next.js 16 App Router
- React 19
- TypeScript
- Tailwind CSS
- Radix UI / shadcn 风格组件
- Zustand
- Supabase JS

后端：

- Python 3.11+
- FastAPI
- Uvicorn
- LangGraph
- LangChain
- OpenAI / OpenAI-compatible API
- Supabase Python SDK

部署：

- Docker / Docker Compose
- Nginx 反向代理
- GitHub Actions

## 目录结构

```text
deep-research/
├── api/                      # FastAPI 后端
│   ├── main.py               # 应用入口
│   ├── agents/               # LangGraph agent
│   ├── core/                 # 配置
│   ├── database/             # Supabase SQL schema
│   ├── models/               # Pydantic model
│   ├── routers/              # API routes
│   ├── services/             # 业务服务
│   └── tests/                # 后端测试
├── web/                      # Next.js 前端
│   ├── app/                  # App Router pages
│   ├── components/           # UI 和业务组件
│   └── lib/                  # API client、auth、状态和研究逻辑
├── docs/
│   └── deployment/           # 部署文档
├── scripts/
│   └── deploy-production.sh  # 生产部署脚本
├── docker-compose.yml
└── .github/workflows/deploy.yml
```

## 本地开发

### 依赖

- Node.js 18+
- pnpm 10+
- Python 3.11+
- Docker，可选
- Supabase 项目，可选，使用 `RESEARCH_STORAGE_BACKEND=supabase` 时需要
- OpenAI 或兼容接口 key

### 后端

```bash
cd api
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

编辑 `api/.env`，至少配置：

```env
OPENAI_API_KEY=
OPENAI_BASE_URL=
FRONTEND_URL=http://localhost:3000
RESEARCH_STORAGE_BACKEND=json
```

如果使用 Supabase 存储，还需要：

```env
SUPABASE_URL=
SUPABASE_KEY=
SUPABASE_SERVICE_KEY=
RESEARCH_STORAGE_BACKEND=supabase
```

启动后端：

```bash
cd api
source venv/bin/activate
uvicorn main:app --reload --port 8000
```

访问：

```text
http://localhost:8000/health
http://localhost:8000/docs
```

### 前端

```bash
cd web
pnpm install
cp .env.example .env.local
```

编辑 `web/.env.local`：

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
NEXT_PUBLIC_AUTH_CALLBACK_PATH=/auth/callback
```

启动前端：

```bash
cd web
pnpm dev
```

访问：

```text
http://localhost:3000
```

## 数据库和登录

Supabase schema 在：

```text
api/database/schema.sql
```

初始化步骤：

1. 创建 Supabase 项目。
2. 在 SQL Editor 执行 `api/database/schema.sql`。
3. 启用 `pgvector` 扩展。
4. 如果要启用 Google 登录，在 Supabase Authentication Providers 中开启 Google。
5. Google OAuth 回调 URL 使用 Supabase 提供的 `/auth/v1/callback`。
6. Supabase redirect URL 至少加入：

```text
http://localhost:3000/auth/callback
https://eyjamini.com/ds/auth/callback
```

详细说明见：

```text
api/database/README.md
```

## API

常用接口：

```text
GET  /health
POST /api/research/
POST /api/research/execute
GET  /api/research/documents
POST /api/research/documents
DELETE /api/research/documents/{id}
```

添加文档示例：

```bash
curl -X POST http://localhost:8000/api/research/documents \
  -H "Content-Type: application/json" \
  -d '{
    "content": "文档正文",
    "metadata": {"source": "example"}
  }'
```

## Docker Compose

项目保留两种 Docker 模式：

- 生产模式：使用 `docker-compose.yml`，构建 Next standalone 和 FastAPI runtime，和线上部署一致。
- 热更新模式：叠加 `docker-compose.dev.yml`，仍使用同一套服务、端口、`.env` 和 Dockerfile，只把命令切换成 `pnpm dev` 与 `uvicorn --reload`。

### 本地热更新模式

首次启动：

```bash
cp .env.deploy.example .env
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

后续启动：

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

本地默认端口：

```text
Web: http://localhost:3000
API: http://localhost:8000
```

热更新模式会挂载：

```text
./web -> /app
./api -> /app
```

前端依赖和 `.next` 缓存在 Docker volume 中，不会写进宿主机项目目录：

```text
web-node-modules
web-next-cache
web-pnpm-store
```

停止热更新环境：

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml down
```

如果要清掉前端依赖缓存：

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml down -v
```

### 本地生产模式

本地生产模式用于验证“构建后”的效果，不提供热更新：

```bash
cp .env.deploy.example .env
docker compose up --build -d
docker compose ps
```

修改代码后需要重新构建：

```bash
docker compose build web api
docker compose up -d
```

### 生产服务器

生产服务器当前布局：

```text
/ds   前端源码、docker-compose.yml、部署 .env
/api  后端源码、api/.env
```

生产环境关键变量：

```env
API_PORT=8000
WEB_PORT=3002
API_BUILD_CONTEXT=/api
WEB_BUILD_CONTEXT=/ds
API_ENV_FILE=/api/.env
NEXT_PUBLIC_API_URL=https://eyjamini.com/ds
FRONTEND_URL=https://eyjamini.com
NEXT_PUBLIC_AUTH_CALLBACK_PATH=/ds/auth/callback
NEXT_PUBLIC_BASE_PATH=/ds
```

## 自动部署

GitHub Actions workflow：

```text
.github/workflows/deploy.yml
```

触发方式：

- push 到 `main`
- GitHub Actions 页面手动 `workflow_dispatch`

部署脚本：

```text
scripts/deploy-production.sh
```

GitHub Secrets 需要配置在 `Production` environment 下：

```text
DEPLOY_HOST=159.195.30.218
DEPLOY_USER=cxk
DEPLOY_PORT=22
DEPLOY_SSH_KEY=<部署私钥>
```

部署脚本会：

1. 同步 `web/` 到服务器 `/ds`。
2. 同步 `api/` 到服务器 `/api`。
3. 保留服务器上的 `/ds/.env` 和 `/api/.env`。
4. 执行 `docker-compose build api web`。
5. 执行 `docker-compose up -d api web`。
6. 检查 `https://eyjamini.com/ds` 和 `https://eyjamini.com/ds/health`。

更多细节见：

```text
docs/deployment/docker-local.md
docs/deployment/github-actions.md
docs/deployment/docker.md
```

## 常用命令

查看生产容器：

```bash
ssh summi-netcup
cd /ds
sudo docker-compose ps
```

查看日志：

```bash
cd /ds
sudo docker-compose logs -f --tail=100 api web
```

手动重启：

```bash
cd /ds
sudo docker-compose restart
```

本地运行前端 lint：

```bash
cd web
pnpm lint
```

运行前端 Node 测试示例：

```bash
node --test web/lib/auth/callback-redirect.test.mts
```

## 注意事项

- 不要提交 `.env`、私钥、OpenAI key、Supabase service key。
- `NEXT_PUBLIC_*` 会进入浏览器 bundle，只能放公开值。
- 生产前端挂在 `/ds` 下，Next.js 通过 `NEXT_PUBLIC_BASE_PATH=/ds` 构建。
- 前端 OAuth 回调路径是 `/ds/auth/callback`。
- 如果修改 `NEXT_PUBLIC_*`，需要重新 build 前端镜像。

## License

MIT
