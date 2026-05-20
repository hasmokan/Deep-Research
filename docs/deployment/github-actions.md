# GitHub Actions Deployment

The repository deploys to `https://eyjamini.com/ds` through `.github/workflows/deploy.yml`.

## Required GitHub Secrets

Set these in GitHub:

`Settings` -> `Secrets and variables` -> `Actions` -> `New repository secret`

```text
DEPLOY_HOST=159.195.30.218
DEPLOY_USER=cxk
DEPLOY_PORT=22
DEPLOY_SSH_KEY=<private key contents>
```

The private key for `DEPLOY_SSH_KEY` is stored locally at:

```bash
~/.ssh/deep_research_github_actions
```

Copy it with:

```bash
cat ~/.ssh/deep_research_github_actions
```

Only paste the private key into GitHub Secrets. Do not commit it.

## Server Layout

The workflow deploys to the existing server layout:

```text
/ds   Next.js frontend and docker-compose.yml
/api  FastAPI backend and backend .env
```

The script preserves server-owned environment files:

```text
/ds/.env
/api/.env
```

## Trigger

The workflow runs on every push to `main` and can also be started manually from the GitHub Actions tab.

## Verification

The workflow checks:

```text
https://eyjamini.com/ds
https://eyjamini.com/ds/health
```

