# GitHub Actions Deployment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a GitHub Actions pipeline that deploys `main` to the existing `/ds` and `/api` server paths.

**Architecture:** A checked-in deploy script performs SSH setup-independent deployment using `rsync` and remote Docker Compose commands. The workflow provides SSH credentials from GitHub Secrets and invokes the script on `main` pushes.

**Tech Stack:** GitHub Actions, SSH, rsync, Docker Compose v1, Nginx reverse proxy.

---

### Task 1: Make Compose Server-Layout Aware

**Files:**
- Modify: `docker-compose.yml`
- Modify: `.env.deploy.example`

**Steps:**
1. Add build-context variables so local defaults remain `./api` and `./web`.
2. Add `NEXT_PUBLIC_BASE_PATH` to the web build args.
3. Document server values for `/api`, `/ds`, and `/ds` base path in `.env.deploy.example`.
4. Validate with `docker-compose config` locally if available.

### Task 2: Add Deployment Script

**Files:**
- Create: `scripts/deploy-production.sh`

**Steps:**
1. Validate required environment variables: `DEPLOY_HOST`, `DEPLOY_USER`.
2. Create `/ds` and `/api` on the server with `sudo`.
3. Sync `web/` to `/ds` and `api/` to `/api`, excluding local caches, virtualenvs, and env files.
4. Sync `docker-compose.yml` to `/ds/docker-compose.yml`.
5. Ensure non-secret `/ds/.env` deployment values are correct.
6. Run `sudo docker-compose config`, build, start, and verify `/ds` and `/ds/health`.

### Task 3: Add GitHub Actions Workflow

**Files:**
- Create: `.github/workflows/deploy.yml`

**Steps:**
1. Trigger on `push` to `main` and manual dispatch.
2. Check out the repository.
3. Install SSH private key from `DEPLOY_SSH_KEY`.
4. Trust the deployment host with `ssh-keyscan`.
5. Run `scripts/deploy-production.sh`.

### Task 4: Verify

**Commands:**
- `bash -n scripts/deploy-production.sh`
- `git diff --check`
- `git status --short`

**Expected:**
- Shell syntax check passes.
- No whitespace errors.
- Only intended deployment files are changed.

