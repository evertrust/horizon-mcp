# Authentication

Four authentication modes are supported. The server auto-detects which mode to use based on which environment variables are set.

**Priority:** mTLS > API Key > OIDC browser

## Mode 1: API Key

```bash
HORIZON_URL=https://horizon.example.com
HORIZON_API_ID=your-api-id
HORIZON_API_KEY=your-api-key
```

## Mode 2: Mutual TLS (PEM files)

```bash
HORIZON_URL=https://horizon.example.com
HORIZON_CLIENT_CERT=/path/to/client.crt
HORIZON_CLIENT_KEY=/path/to/client.key
HORIZON_CLIENT_KEY_PASSWORD=optional-key-password   # omit if key is unencrypted
```

## Mode 3: Mutual TLS (PKCS12 / PFX)

```bash
HORIZON_URL=https://horizon.example.com
HORIZON_CLIENT_PFX=/path/to/client.p12
HORIZON_CLIENT_PFX_PASSWORD=optional-pfx-password   # omit if bundle is unencrypted
```

## Mode 4: OIDC browser session

Set only `HORIZON_URL`. A browser window opens for interactive login at startup. Requires Playwright:

```bash
bun install playwright
bunx playwright install chromium
```

Then configure with just the URL:

```bash
HORIZON_URL=https://horizon.example.com
```

## Configuration reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `HORIZON_URL` | Yes | `https://localhost` | Horizon instance URL |
| `HORIZON_API_ID` | Mode 1 | | API key identifier |
| `HORIZON_API_KEY` | Mode 1 | | API key secret |
| `HORIZON_CLIENT_CERT` | Mode 2 | | Path to PEM client certificate |
| `HORIZON_CLIENT_KEY` | Mode 2 | | Path to PEM private key |
| `HORIZON_CLIENT_KEY_PASSWORD` | No | | PEM key decryption password |
| `HORIZON_CLIENT_PFX` | Mode 3 | | Path to PKCS12 / PFX bundle |
| `HORIZON_CLIENT_PFX_PASSWORD` | No | | PFX decryption password |
| `HORIZON_VERIFY_SSL` | No | `true` | Verify server TLS certificates |
| `HORIZON_TIMEOUT` | No | `30` | HTTP request timeout (seconds) |
| `HORIZON_LOG_LEVEL` | No | `INFO` | Log verbosity: `DEBUG`, `INFO`, `WARNING`, `ERROR` |

Set these as environment variables in your MCP client configuration (see [client setup](client-setup.md)).
