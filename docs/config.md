# Configuration

You may set `SKYLIGHT_FRAME_ID` directly or provide a public `SKYLIGHT_CALENDAR_URL`. If neither is set, the agent discovers calendar frames from the account and can continue automatically when exactly one is returned.

## Environment variables

`skylight auth login` prints Skylight's HTTPS OAuth URL for browser sign-in. After sign-in, pass the complete `https://ourskylight.com/welcome?...` URL to `skylight auth complete --callback-url URL`. On macOS, the rotating OAuth credential is encrypted with a random 256-bit key stored in Keychain. On Linux it is stored below `~/.config/skylight-calendar-agent/credentials` with directory mode `0700` and file mode `0600`. Access tokens refresh automatically before expiry and after a `401`. `skylight auth status` reports the active source without revealing it, and `skylight auth logout` removes the stored credential.

- `SKYLIGHT_EMAIL` / `SKYLIGHT_PASSWORD` — portable fallback when no explicit header, Basic token, Bearer token, or stored credential is available. Prefer the browser flow; `skylight auth login-password` explicitly performs direct terminal login.
- `SKYLIGHT_BASIC_TOKEN` — optional base64-encoded `id:token` value, without the `Basic` scheme prefix.
- `SKYLIGHT_BEARER_TOKEN` — optional web-app access token, without the `Bearer` scheme prefix.
- `SKYLIGHT_AUTH_HEADER` — optional full `Authorization` header value (wins over BASIC/BEARER).
- `SKYLIGHT_API_BASE` — defaults to `https://app.ourskylight.com`; plain HTTP is accepted only for localhost or loopback development servers.
- `SKYLIGHT_API_VERSION` — valid `YYYY-MM-DD` value sent as `Skylight-Api-Version` (default `2026-05-01`, matching the current calendar web client).
- `SKYLIGHT_FRAME_ID` — optional explicit frame id for `/api/frames/{frameId}/...` endpoints.
- `SKYLIGHT_CALENDAR_URL` — optional absolute HTTP(S) share URL containing `/calendar/<numeric-id>`.
- `SKYLIGHT_TIMEZONE` — defaults to the machine's IANA timezone.
- `SKYLIGHT_REQUEST_TIMEOUT_MS` — request timeout from `1` to `2147483647` milliseconds (default `30000`).
- `SKYLIGHT_MCP_HTTP_TOKEN` — optional 43-character base64url Bearer token for explicit pre-shared-token mode. When omitted, the HTTP MCP uses its built-in browser OAuth login by default.
- `SKYLIGHT_MCP_HTTP_HOST` / `SKYLIGHT_MCP_HTTP_PORT` / `SKYLIGHT_MCP_HTTP_PATH` — HTTP MCP bind settings (defaults `127.0.0.1`, `8787`, `/mcp`).
- `SKYLIGHT_MCP_HTTP_PUBLIC_URL` — canonical HTTPS endpoint required for non-loopback binding.
- `SKYLIGHT_MCP_HTTP_ALLOWED_HOSTS` — comma-separated additional Host header values.
- `SKYLIGHT_MCP_HTTP_ALLOWED_ORIGINS` — comma-separated browser origins allowed to use CORS. Browser origins are denied by default.
- `SKYLIGHT_MCP_HTTP_MAX_REQUEST_BYTES` / `SKYLIGHT_MCP_HTTP_MAX_BATCH_SIZE` — maximum JSON request size and JSON-RPC batch member count (defaults `1048576` bytes and `20`). Clients must not rely on batching for interoperability with MCP servers that do not implement the extension.
- `SKYLIGHT_MCP_HTTP_MAX_SESSIONS` / `SKYLIGHT_MCP_HTTP_SESSION_TTL_MS` — session capacity and idle expiration (defaults `100` and `1800000`).
- `SKYLIGHT_MCP_HTTP_MAX_STREAMS_PER_SESSION` / `SKYLIGHT_MCP_HTTP_MAX_STREAM_BUFFER_BYTES` — per-session SSE stream and buffering limits (defaults `1` and `1048576`).
- `SKYLIGHT_MCP_HTTP_MAX_SSE_EVENT_HISTORY` / `SKYLIGHT_MCP_HTTP_SSE_KEEP_ALIVE_MS` — replay history and keep-alive interval (defaults `100` and `30000`).
- `SKYLIGHT_MCP_HTTP_MAX_CONCURRENT_TOOL_CALLS` — process-wide concurrent tool-call limit (default `20`).
- `SKYLIGHT_MCP_HTTP_TRUST_PROXY` — set to `1` only behind a trusted reverse proxy; enables forwarded host/protocol handling.
- `SKYLIGHT_MCP_OAUTH_LOGIN` — legacy explicit switch for the built-in OAuth 2.1/PKCE browser login. It is no longer necessary because browser login is the default whenever no HTTP token, external OAuth server, or insecure mode is configured.
- `SKYLIGHT_MCP_OAUTH_AUTHORIZATION_SERVERS` / `SKYLIGHT_MCP_OAUTH_JWKS_URL` — enable standard HTTP MCP OAuth with comma-separated HTTPS issuer URLs and an HTTPS JWKS endpoint. Both are required together, along with an HTTPS public URL.
- `SKYLIGHT_MCP_OAUTH_SCOPES` — comma-separated required access-token scopes (default `mcp`). OAuth access tokens must use `typ=at+jwt` and pass issuer, audience, signature, expiry, and scope checks.

Built-in OAuth login and external OAuth verification are mutually exclusive. The built-in mode publishes authorization-server and protected-resource metadata, supports dynamic client registration and PKCE, and issues short-lived access tokens plus rotating refresh tokens. Its signing key, grants, and Skylight credential are intentionally ephemeral. Locally, `skylight-calendar-mcp-http` works without options at `http://127.0.0.1:8787/mcp`; only public deployments need bind and public URL settings.

Credential precedence is `SKYLIGHT_AUTH_HEADER`, then `SKYLIGHT_BASIC_TOKEN`, then `SKYLIGHT_BEARER_TOKEN`, then the stored OAuth credential, then email/password OAuth login. Explicit environment credentials can temporarily override the stored credential. Run `skylight auth login` again if the refresh credential is revoked or login verification changes.

In `.env`, quote values that contain `#` or intentional leading/trailing spaces. Double-quoted values support `\\`, `\\"`, `\\n`, `\\r`, and `\\t` escapes.

The CLI and MCP entry points load `.env` from the current working directory. The SDK reads `process.env` but does not load `.env` automatically; load it in the host application first when needed.

An explicitly exported credential method takes precedence over credential methods in `.env`. While exported credentials are present, `SKYLIGHT_API_BASE` is not loaded from `.env`; export the custom API base explicitly if that combination is intentional. This prevents a working-directory file from redirecting shell-provided credentials.

## Frame scoping

If `SKYLIGHT_FRAME_ID` is not set, the agent will:

1. Parse the numeric id from `SKYLIGHT_CALENDAR_URL` when present (for example, `/calendar/1234567` -> `1234567`).
2. Call `GET /api/frames/calendar` and require any configured or URL-derived id to appear in that calendar-only result. The agent uses the result automatically when exactly one calendar is returned; for multiple calendars it lists their ids and requires `SKYLIGHT_FRAME_ID`. A `404` from the calendar listing falls back to the legacy `/api/frames` route, while still requiring the selected resource to advertise the calendar app.

## API base URL normalization

If you set `SKYLIGHT_API_BASE` to `https://app.ourskylight.com/api`, the agent will normalize it back to `https://app.ourskylight.com` (it always prefixes paths with `/api/...`).
