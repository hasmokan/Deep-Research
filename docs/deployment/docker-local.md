# 本地 Docker 使用说明

本文说明如何在本地用 Docker 跑 Deep Research，并区分“热更新开发模式”和“生产构建模式”。

## 模式选择

推荐日常开发使用热更新模式：

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

发布前验证使用生产模式：

```bash
docker compose up --build -d
```

两种模式共用：

- `docker-compose.yml`
- `.env`
- `api/.env`
- 同一套端口：前端 `3000`，后端 `8000`
- 同一套 Dockerfile 和依赖版本

区别只在启动命令和源码挂载：

| 模式 | 前端命令 | 后端命令 | 是否热更新 | 用途 |
| --- | --- | --- | --- | --- |
| 热更新模式 | `pnpm dev` | `uvicorn main:app --reload` | 是 | 日常开发 |
| 生产模式 | `node server.js` | `uvicorn main:app` | 否 | 构建后验证、线上部署 |

## 准备环境变量

首次启动前，在仓库根目录创建 `.env`：

```bash
cp .env.deploy.example .env
```

本地开发推荐值：

```env
API_PORT=8000
WEB_PORT=3000
API_BUILD_CONTEXT=./api
WEB_BUILD_CONTEXT=./web
API_ENV_FILE=./api/.env

NEXT_PUBLIC_API_URL=http://localhost:8000
FRONTEND_URL=http://localhost:3000
NEXT_PUBLIC_AUTH_CALLBACK_PATH=/auth/callback
NEXT_PUBLIC_BASE_PATH=

RESEARCH_STORAGE_BACKEND=json

WATCHFILES_FORCE_POLLING=true
WATCHPACK_POLLING=true
CHOKIDAR_USEPOLLING=true
```

后端密钥放在 `api/.env`：

```bash
cd api
cp .env.example .env
```

至少配置：

```env
OPENAI_API_KEY=
OPENAI_BASE_URL=
FRONTEND_URL=http://localhost:3000
RESEARCH_STORAGE_BACKEND=json
```

如果使用 Supabase 存储，再配置：

```env
SUPABASE_URL=
SUPABASE_KEY=
SUPABASE_SERVICE_KEY=
RESEARCH_STORAGE_BACKEND=supabase
```

## 热更新模式

启动：

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

后台启动：

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build -d
```

查看状态：

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml ps
```

查看日志：

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml logs -f --tail=100 api web
```

访问：

```text
http://localhost:3000
http://localhost:8000/health
```

热更新模式会挂载：

```text
./web -> /app
./api -> /app
```

修改前端代码后，Next.js 会自动刷新。

修改后端代码后，Uvicorn 会自动 reload。

停止：

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml down
```

清理热更新模式的依赖缓存 volume：

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml down -v
```

## 生产模式

生产模式用于验证构建后的结果，和线上更接近，但不支持热更新。

启动：

```bash
docker compose up --build -d
```

查看状态：

```bash
docker compose ps
```

查看日志：

```bash
docker compose logs -f --tail=100 api web
```

修改代码后重新构建：

```bash
docker compose build web api
docker compose up -d
```

停止：

```bash
docker compose down
```

## 在两种模式之间切换

从生产模式切到热更新模式：

```bash
docker compose down
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

从热更新模式切回生产模式：

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml down
docker compose up --build -d
```

## 保持本地和线上一致

为了避免“本地能跑，线上不一致”：

1. 不要单独维护另一份 dev Dockerfile。
2. 不要在 `docker-compose.dev.yml` 里改服务名、端口或 API URL 结构。
3. `.env` 使用 `.env.deploy.example` 作为模板。
4. 发布前跑一次生产模式：

```bash
docker compose up --build -d
curl -f http://localhost:8000/health
curl -I http://localhost:3000
```

5. 如果改了 `NEXT_PUBLIC_*`，必须重新 build 前端镜像。

## 常见问题

### 端口被占用

检查端口：

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
lsof -nP -iTCP:8000 -sTCP:LISTEN
```

如果是当前项目容器占用：

```bash
docker compose down
```

如果是热更新模式占用：

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml down
```

### Docker Hub 拉镜像失败

如果出现类似错误：

```text
failed to resolve source metadata for docker.io/library/python:3.12-slim
x509: certificate is valid for *.azureedge.net, not registry-1.docker.io
```

这通常是本机 Docker registry 代理、证书或网络问题，不是项目配置问题。

可先验证：

```bash
docker pull node:22-slim
docker pull python:3.12-slim
```

如果这里失败，先修 Docker Desktop / OrbStack 的代理和证书配置。

### 前端没有热更新

确认是用 dev override 启动：

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml ps
```

确认 `.env` 包含：

```env
WATCHPACK_POLLING=true
CHOKIDAR_USEPOLLING=true
```

### 后端没有自动 reload

确认 `.env` 包含：

```env
WATCHFILES_FORCE_POLLING=true
```

确认启动命令是：

```text
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

