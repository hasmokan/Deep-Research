# GitHub Actions Deployment Design

## Goal

Deploy the Deep Research app automatically when `main` is pushed to GitHub.

## Approach

Use GitHub Actions to SSH into the existing server and run the same Docker Compose deployment model that is already working manually. The workflow syncs `web/` into `/ds`, syncs `api/` into `/api`, preserves server-side `.env` files, rebuilds the containers, starts them, and verifies the public `/ds` endpoints.

## Architecture

- GitHub Actions runs on `push` to `main` and on manual dispatch.
- SSH credentials live in GitHub Secrets.
- The deployment script uses `rsync` for fast incremental uploads.
- `/ds/.env` and `/api/.env` remain server-owned secret/config files.
- `docker-compose.yml` supports both local repo layout and server layout through build-context environment variables.
- Nginx remains a one-time server prerequisite: `https://eyjamini.com/ds` proxies to the web container and `https://eyjamini.com/ds/api` proxies to the API.

## Required Secrets

- `DEPLOY_HOST`: `159.195.30.218`
- `DEPLOY_USER`: `cxk`
- `DEPLOY_SSH_KEY`: private key allowed to SSH as `cxk`
- `DEPLOY_PORT`: optional, defaults to `22`

## Failure Handling

The workflow fails if SSH is unavailable, required server `.env` files are missing, Docker Compose config is invalid, container startup fails, or the final health checks fail.

