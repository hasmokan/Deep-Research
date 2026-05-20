#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

: "${DEPLOY_HOST:?DEPLOY_HOST is required}"
: "${DEPLOY_USER:?DEPLOY_USER is required}"

DEPLOY_PORT="${DEPLOY_PORT:-22}"
DEPLOY_WEB_DIR="${DEPLOY_WEB_DIR:-/ds}"
DEPLOY_API_DIR="${DEPLOY_API_DIR:-/api}"
DEPLOY_PUBLIC_ORIGIN="${DEPLOY_PUBLIC_ORIGIN:-https://eyjamini.com}"
DEPLOY_BASE_PATH="${DEPLOY_BASE_PATH:-/ds}"
DEPLOY_WEB_PORT="${DEPLOY_WEB_PORT:-3002}"
DEPLOY_API_PORT="${DEPLOY_API_PORT:-8000}"
DEPLOY_PROJECT_DIR="${DEPLOY_PROJECT_DIR:-$DEPLOY_WEB_DIR}"

SSH_TARGET="${DEPLOY_USER}@${DEPLOY_HOST}"
SSH_OPTS=(-p "$DEPLOY_PORT" -o BatchMode=yes -o StrictHostKeyChecking=yes)
RSYNC_RSH="ssh -p $DEPLOY_PORT -o BatchMode=yes -o StrictHostKeyChecking=yes"

remote_quote() {
  printf "%q" "$1"
}

echo "Preparing remote directories..."
ssh "${SSH_OPTS[@]}" "$SSH_TARGET" \
  "sudo mkdir -p $(remote_quote "$DEPLOY_WEB_DIR") $(remote_quote "$DEPLOY_API_DIR") && sudo chown -R $(remote_quote "$DEPLOY_USER"):$(remote_quote "$DEPLOY_USER") $(remote_quote "$DEPLOY_WEB_DIR") $(remote_quote "$DEPLOY_API_DIR")"

echo "Syncing frontend to $DEPLOY_WEB_DIR..."
rsync -az --delete \
  --exclude node_modules \
  --exclude .next \
  --exclude .env \
  --exclude ".env.*" \
  --exclude .env.local \
  --exclude ".*.local" \
  --exclude docker-compose.yml \
  --exclude tsconfig.tsbuildinfo \
  -e "$RSYNC_RSH" \
  "$ROOT_DIR/web/" "$SSH_TARGET:$DEPLOY_WEB_DIR/"

echo "Syncing backend to $DEPLOY_API_DIR..."
rsync -az --delete \
  --exclude venv \
  --exclude .venv \
  --exclude __pycache__ \
  --exclude .pytest_cache \
  --exclude data \
  --exclude "*.pyc" \
  --exclude .env \
  --exclude "*.env" \
  -e "$RSYNC_RSH" \
  "$ROOT_DIR/api/" "$SSH_TARGET:$DEPLOY_API_DIR/"

echo "Syncing Docker Compose file..."
rsync -az -e "$RSYNC_RSH" "$ROOT_DIR/docker-compose.yml" "$SSH_TARGET:$DEPLOY_PROJECT_DIR/docker-compose.yml"

echo "Checking server environment files..."
ssh "${SSH_OPTS[@]}" "$SSH_TARGET" \
  "test -f $(remote_quote "$DEPLOY_API_DIR")/.env || { echo 'Missing $(remote_quote "$DEPLOY_API_DIR")/.env'; exit 1; }; touch $(remote_quote "$DEPLOY_PROJECT_DIR")/.env; chmod 600 $(remote_quote "$DEPLOY_PROJECT_DIR")/.env"

echo "Updating deployment environment..."
ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "\
  cd $(remote_quote "$DEPLOY_PROJECT_DIR") && \
  ensure_env() { \
    key=\"\$1\"; \
    value=\"\$2\"; \
    if grep -q \"^\${key}=\" .env; then \
      sed -i \"s#^\${key}=.*#\${key}=\${value}#\" .env; \
    else \
      printf '%s=%s\n' \"\$key\" \"\$value\" >> .env; \
    fi; \
  }; \
  ensure_env API_PORT $(remote_quote "$DEPLOY_API_PORT"); \
  ensure_env WEB_PORT $(remote_quote "$DEPLOY_WEB_PORT"); \
  ensure_env API_BUILD_CONTEXT $(remote_quote "$DEPLOY_API_DIR"); \
  ensure_env WEB_BUILD_CONTEXT $(remote_quote "$DEPLOY_WEB_DIR"); \
  ensure_env API_ENV_FILE $(remote_quote "$DEPLOY_API_DIR/.env"); \
  ensure_env NEXT_PUBLIC_API_URL $(remote_quote "$DEPLOY_PUBLIC_ORIGIN$DEPLOY_BASE_PATH"); \
  ensure_env FRONTEND_URL $(remote_quote "$DEPLOY_PUBLIC_ORIGIN"); \
  ensure_env NEXT_PUBLIC_AUTH_CALLBACK_PATH $(remote_quote "$DEPLOY_BASE_PATH/auth/callback"); \
  ensure_env NEXT_PUBLIC_BASE_PATH $(remote_quote "$DEPLOY_BASE_PATH"); \
  ensure_env RESEARCH_STORAGE_BACKEND json"

echo "Building and starting containers..."
ssh "${SSH_OPTS[@]}" "$SSH_TARGET" \
  "cd $(remote_quote "$DEPLOY_PROJECT_DIR") && sudo docker-compose config >/tmp/deep-research-compose.config && sudo docker-compose build api web && sudo docker-compose up -d api && sudo docker-compose rm -sf web && sudo docker-compose up -d web && sudo docker-compose ps"

echo "Verifying deployment..."
ssh "${SSH_OPTS[@]}" "$SSH_TARGET" \
  "curl -k -fsS $(remote_quote "$DEPLOY_PUBLIC_ORIGIN$DEPLOY_BASE_PATH/health") >/dev/null && curl -k -fsSI $(remote_quote "$DEPLOY_PUBLIC_ORIGIN$DEPLOY_BASE_PATH") >/dev/null"

echo "Deployment complete: $DEPLOY_PUBLIC_ORIGIN$DEPLOY_BASE_PATH"
