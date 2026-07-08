# skylight-calendar-agent

Unofficial [Toolcraft](https://www.npmjs.com/package/toolcraft) CLI and MCP server for Skylight Calendar.

It exposes calendar, task, reward, list, meal, recipe, photo, and profile operations. The most common list workflows have typed commands for creating lists and adding one or many to-do items.

## Requirements

- Node.js 20 or newer
- A Skylight account or an existing API token

## Install

```sh
npm install -g @kamilio/skylight-calendar-agent
```

To install the current checkout globally before publishing it:

```sh
npm install
npm run install:global
skylight --version
```

This builds the project first, then installs the checkout into npm's global prefix. Remove it later with `npm uninstall -g @kamilio/skylight-calendar-agent`.

For local development:

```sh
npm install
npm run build
```

## Configure

On macOS, the recommended setup is an interactive OAuth2 login that encrypts the resulting access token, rotating refresh token, and device fingerprint with a random key held in Keychain:

```sh
skylight auth login --email you@example.com
skylight auth status
skylight auth logout
```

The password prompt is hidden and the password is used only to establish Skylight's browser-backed OAuth session; it is never persisted by this package. The encrypted credential file is stored under the user's macOS Application Support directory with mode `0600`, while its encryption key remains in Keychain. CLI and MCP processes automatically refresh it before expiry and after an authorization rejection, so passwords and tokens do not belong in `.mcp.json` or the project directory. Remove both with `skylight auth logout`.

For non-interactive setup, pipe the password without placing it in shell history:

```sh
printf '%s\n' "$SKYLIGHT_PASSWORD" | skylight auth login --email you@example.com --password-stdin
```

Environment variables and `.env` remain available as portable fallbacks:

```sh
SKYLIGHT_EMAIL=you@example.com
SKYLIGHT_PASSWORD=your-password
SKYLIGHT_FRAME_ID=1234567
```

Quote dotenv values that contain `#` or intentional leading/trailing spaces, for example `SKYLIGHT_PASSWORD=" secret#value "`.

Instead of email and password, you may set one of:

- `SKYLIGHT_AUTH_HEADER` — complete `Authorization` header value
- `SKYLIGHT_BASIC_TOKEN` — base64-encoded Skylight user-id/token pair
- `SKYLIGHT_BEARER_TOKEN` — web-app access token

If multiple methods are set, precedence is full auth header, Basic token, Bearer token, the stored Keychain OAuth credential, then email/password OAuth login. Environment credentials therefore remain useful for temporary overrides.

An explicitly exported credential method takes precedence over credential methods in `.env`. When shell credentials are present, `SKYLIGHT_API_BASE` is also not loaded from `.env`; export it explicitly if you intentionally use a custom API host. This prevents a stale or untrusted working-directory file from redirecting exported credentials.

`profiles update-email` uses `SKYLIGHT_PASSWORD` by default, so the current password does not need to appear in shell history. Pass `--password` only to override it.

See `.env.example` for optional API, calendar URL, and timezone settings. Credentials and captured traffic files are ignored by Git and excluded from the npm package.

## Lists and to-dos

Create a to-do list:

```sh
skylight lists create --label "Weekend"
```

Create a shopping list:

```sh
skylight lists create --label "Hardware Store" --kind shopping --color B6E085
```

Find the new list ID, then add one or many items:

```sh
skylight lists list
skylight lists item-create --list-id LIST_ID --label "Replace air filter"
skylight lists items-create --list-id LIST_ID --labels "Buy filter" "Install filter"
```

Skylight list items currently expose label, status, section, position, and creation time, but no due-date field. For a dated task, create a chore instead:

```sh
skylight tasks chore-create-simple --summary "Replace air filter" --start 2026-07-12
```

Raw list and item commands remain available as `lists create-raw` and `lists item-create-raw` for API fields not yet modeled by this package.
Their `*Json` options accept JSON text in the CLI and native JSON values over MCP/SDK.

## MCP

Run the stdio MCP server:

```sh
skylight-calendar-mcp
```

Example MCP client configuration:

```json
{
  "mcpServers": {
    "skylight": {
      "command": "npx",
      "args": ["-y", "--package", "@kamilio/skylight-calendar-agent", "skylight-calendar-mcp"],
      "env": {}
    }
  }
}
```

If the package is globally installed, set `command` directly to `skylight-calendar-mcp` and omit `args`.

For local stdio MCP servers, the MCP authorization specification uses process-local credentials rather than an MCP HTTP authorization exchange. Run `skylight auth login` once before starting Claude; the MCP server then reads and refreshes the Skylight OAuth credential from macOS Keychain without secrets in `.mcp.json`.

### Streamable HTTP

Run the same Toolcraft MCP tools over Streamable HTTP:

```sh
skylight-calendar-mcp-http
# http://127.0.0.1:8787/mcp
```

Connect the client directly. OAuth discovery opens the Skylight login page automatically, so `.mcp.json` contains no headers or secrets:

```json
{
  "mcpServers": {
    "skylight-http": {
      "type": "http",
      "url": "http://127.0.0.1:8787/mcp"
    }
  }
}
```

The HTTP MCP is generated by `toolcraft/http` and uses `tiny-http-mcp-server` for Streamable HTTP protocol handling. Browser-based OAuth login is the default: connect a client to `http://127.0.0.1:8787/mcp`, and the client opens a Skylight email/password page automatically. Security defaults include loopback-only binding, OAuth 2.1 with PKCE, strict Host and Origin validation, bounded request and JSON-RPC batch sizes, bounded sessions and streams, concurrent tool-call limits, idle expiration, and short HTTP timeouts. The unauthenticated `/healthz` endpoint returns only name, version, and health status.

For a TLS-terminated deployment, bind a non-loopback interface only with an HTTPS canonical URL:

```sh
SKYLIGHT_MCP_HTTP_ALLOWED_HOSTS=mcp.example.com \
skylight-calendar-mcp-http \
  --hostname 0.0.0.0 \
  --port 8787 \
  --public-url https://mcp.example.com/mcp
```

Run this as a foreground process under the deployment platform's process manager. Terminate TLS in a trusted reverse proxy. Plain non-loopback HTTP is rejected. `--insecure-no-auth` is available only on loopback for isolated debugging and should not be used normally.

The built-in OAuth login page requires no authentication flags. The client discovers the authorization server, opens a browser, and asks for the same email and password used by Skylight:

```sh
SKYLIGHT_MCP_HTTP_ALLOWED_HOSTS=mcp.example.com \
skylight-calendar-mcp-http \
  --hostname 0.0.0.0 \
  --port 8787 \
  --public-url https://mcp.example.com/mcp
```

The password is sent directly to Skylight and is not stored. The resulting Skylight OAuth credential and this server's OAuth grants are kept only in process memory, so clients sign in again after a restart. One running server supports one Skylight account; restart it to switch accounts. The generated signing key is also process-local, which keeps setup automatic but invalidates issued MCP tokens on restart.

Pre-shared token mode remains available by explicitly setting `SKYLIGHT_MCP_HTTP_TOKEN`; doing so disables the built-in OAuth server. For deployments that already have an authorization service, configure Toolcraft's external JWT verification instead:

The legacy `skylight-calendar-mcp-http-headers` helper is installed for existing pre-shared-token configurations, but new OAuth setups should connect directly without it.

```sh
SKYLIGHT_MCP_HTTP_PUBLIC_URL=https://mcp.example.com/mcp \
SKYLIGHT_MCP_HTTP_ALLOWED_HOSTS=mcp.example.com \
SKYLIGHT_MCP_OAUTH_AUTHORIZATION_SERVERS=https://auth.example.com \
SKYLIGHT_MCP_OAUTH_JWKS_URL=https://auth.example.com/.well-known/jwks.json \
SKYLIGHT_MCP_OAUTH_SCOPES=mcp \
skylight-calendar-mcp-http --hostname 0.0.0.0
```

OAuth mode publishes RFC 9728 protected-resource metadata, requires JWT access tokens with `typ=at+jwt`, and validates signature, issuer, audience, expiry, and required scopes. Set `SKYLIGHT_MCP_HTTP_TRUST_PROXY=1` only when every request reaches the process through a trusted reverse proxy.

## SDK

The package exports a pre-bound SDK factory with typed command names and parameters:

```sh
npm install @kamilio/skylight-calendar-agent
```

```js
import { createSkylightSDK } from "@kamilio/skylight-calendar-agent";

const skylight = createSkylightSDK();
const lists = await skylight.lists.list({});
const created = await skylight.lists.create({ label: "Weekend" });
await skylight.auth.logout({});
```

The SDK reads the same `SKYLIGHT_*` variables from `process.env` and accepts native JSON values for `*Json` parameters. It does not load `.env` automatically; load that file in your application before creating the SDK if needed. Response types are `unknown` because the upstream API is undocumented and may change.

Request failures preserve their structured `SkylightRequestError` type, which is exported with `status`, `method`, and `path` fields for SDK error handling. SDK error messages are stripped of terminal control characters.

### MCP safety

Commands that reveal or mint credentials, OAuth authorization URLs, device activation codes, and signed upload URLs; trigger account emails, exports, migrations, hardware reset/deletion, or hidden-frame state; accept account passwords or share tokens; delete the user account; or transfer frame ownership are intentionally limited to the CLI and SDK. They are not advertised as MCP tools.

The destructive CLI commands `profiles user-delete`, `profiles frame-hide`, `profiles frame-transfer`, `profiles device-delete`, `profiles device-reset`, and `meals migrate` also require `--confirm`.

Dynamic IDs are encoded as individual URL path segments, and typed commands reject blank names, impossible dates, reversed date ranges, invalid page numbers, empty bulk operations, and non-object payloads where a JSON object is required.

To keep malformed requests bounded, command strings are limited to 8,192 characters and command arrays to 500 items. Native/raw JSON inputs additionally allow at most 500 properties or array items per container, 500-character property names, and 100 nesting levels.

For terminal safety, the human-readable CLI flattens response line breaks/tabs and marks exceptionally large response fields or collections as truncated (500 properties/items, 500-character property names, or 10,000-character strings). These CLI-only layout and size limits do not apply to SDK or MCP responses.

## Development

```sh
npm run dev:cli -- lists --help
npm run --silent dev:mcp
npm run check
```

`npm run check` performs a clean TypeScript build, CLI/MCP/transport smoke tests, and an npm package dry run.

## Disclaimer

This project is not affiliated with or endorsed by Skylight. It uses undocumented API endpoints that may change without notice.
