# Security Rules

## Absolute Prohibitions (Zero Tolerance)

### Sensitive Information

- ❌ **NEVER** hardcode in code:
  - API Keys / Tokens
  - Database passwords
  - Private keys / Certificates
  - User credentials

- ❌ **NEVER** commit these files:
  - `.env` / `.env.local` / `.env.production`
  - `credentials.json`
  - `*.pem` / `*.key`
  - `serviceAccountKey.json`

### Detection Patterns

Must **immediately stop and warn** when detecting:

```
# API Keys
sk-[a-zA-Z0-9]{32,}
AKIA[0-9A-Z]{16}
ghp_[a-zA-Z0-9]{36}

# Supabase
eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+

# Generic
password\s*=\s*["'][^"']+["']
secret\s*=\s*["'][^"']+["']
```

## Environment Variable Guidelines

```bash
# ✅ Correct: Read from environment variables
const apiKey = process.env.OPENAI_API_KEY
api_key = os.environ["OPENAI_API_KEY"]

# ❌ Wrong: Hardcoded
const apiKey = "sk-xxxx"
api_key = "sk-xxxx"
```

## Input Validation

- All user input must be validated and sanitized
- Frontend use zod schema validation
- Backend use Pydantic model validation
- SQL queries use parameterization (Supabase RPC)

## Warning Template

```
🚨 Security Warning!

Detected sensitive information:
- File: {file_path}:{line_number}
- Type: {credential_type}

Operation aborted. Please:
1. Immediately remove sensitive info from code
2. Use environment variables instead
3. If already committed, rotate the credential
```
