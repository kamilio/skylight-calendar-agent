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

The recommended setup uses Skylight's HTTPS OAuth page. The CLI prints the complete URL without opening a local browser, which works well when Hermes is running on another machine:

```sh
skylight auth login
```

Open the printed URL on your phone and sign in directly on `app.ourskylight.com`. After Skylight redirects to `https://ourskylight.com/welcome`, copy that complete final URL back to Hermes and have it run:

```sh
skylight auth complete --callback-url 'https://ourskylight.com/welcome?code=...&state=...'
skylight auth status
skylight auth logout
```

Your password stays between your browser and Skylight; it is never sent through Telegram or entered into the remote shell. On macOS, the OAuth credential is encrypted with a random key held in Keychain. On Linux, including typical Hermes hosts, it is stored in `~/.config/skylight-calendar-agent/credentials` with directory mode `0700` and file mode `0600`. CLI processes automatically refresh the credential before expiry and after an authorization rejection. Remove it with `skylight auth logout`.

For direct terminal-only setup, the older password flow remains available:

```sh
printf '%s\n' "$SKYLIGHT_PASSWORD" | skylight auth login-password --email you@example.com --password-stdin
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

If multiple methods are set, precedence is full auth header, Basic token, Bearer token, the stored OAuth credential, then email/password OAuth login. Environment credentials therefore remain useful for temporary overrides.

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

Every advertised tool includes a human-readable title, an object-root output schema, and explicit
read-only, destructive, retry-safety, and open-world annotations. Skylight usually returns objects,
which pass through unchanged. For MCP-compatible structured output, a root array is exposed as
`{ "data": [...] }`, an empty successful response as `{ "ok": true }`, and a root success string as
`{ "message": "..." }`.

For local stdio MCP servers, the MCP authorization specification uses process-local credentials rather than an MCP HTTP authorization exchange. Complete `skylight auth login` once before starting Claude; the MCP server then reads and refreshes the same stored Skylight OAuth credential without secrets in `.mcp.json`.

### Streamable HTTP

Run the same Toolcraft MCP tools over Streamable HTTP:

```sh
skylight-calendar-mcp-http
# http://127.0.0.1:8787/mcp
```

The hosted instance is available at `https://skylight-calendar-kjopek.fly.dev/mcp`. ChatGPT app names and logos are listing metadata configured in ChatGPT; they are not inferred from the MCP URL.

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

The HTTP MCP is generated by `toolcraft/http` and uses `tiny-http-mcp-server` for Streamable HTTP protocol handling. Browser-based OAuth login is the default: connect a client to `http://127.0.0.1:8787/mcp`, and the client opens a Skylight email/password page automatically. Security defaults include loopback-only binding, OAuth 2.1 with PKCE, strict Host and Origin validation, bounded request and JSON-RPC batch sizes, stateless MCP requests, concurrent tool-call limits, and short HTTP timeouts. The unauthenticated `/healthz` endpoint returns only health status.

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

The password passes through the server only for the Skylight sign-in request and is never stored. Local development uses explicit in-memory OAuth storage. Production (`NODE_ENV=production`) requires a persistent `SKYLIGHT_OAUTH_DB_PATH` and one 32-byte base64url `SKYLIGHT_OAUTH_MASTER_KEY`; independent encryption, subject, and signing keys are derived from that secret. Toolcraft refuses to start hosted OAuth without durable encrypted storage and stable keys. Each OAuth subject resolves only its own encrypted Skylight credential, while registrations, grants, tokens, and connections survive process restarts. SQLite supports many users on one server process; run a single Fly machine because its volume is not shared horizontally.

Pre-shared token mode remains available by explicitly setting `SKYLIGHT_MCP_HTTP_TOKEN`; doing so disables the built-in OAuth server. This is the explicit single-account deployment mode.

The legacy `skylight-calendar-mcp-http-headers` helper is installed for existing pre-shared-token configurations, but new OAuth setups should connect directly without it.

Hosted OAuth publishes RFC 9728 protected-resource metadata, supports dynamic client registration and PKCE, and validates issuer, audience, expiry, and required scopes. Set `SKYLIGHT_MCP_HTTP_TRUST_PROXY=1` only when every request reaches the process through a trusted reverse proxy.

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

`lists.itemsCreate` stops at the first failed item. Its error message reports how many items were created and identifies the failed item; HTTP failures retain the original `SkylightRequestError` and its fields. Earlier successful items are not rolled back, and neither they nor the failed item are automatically retried. Check the reported progress before retrying so that already-created items are not duplicated.

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
