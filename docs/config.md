# Configuration

You may set `SKYLIGHT_FRAME_ID` directly or provide a public `SKYLIGHT_CALENDAR_URL`. If neither is set, the agent discovers calendar frames from the account and can continue automatically when exactly one is returned.

## Environment variables

- `SKYLIGHT_EMAIL` / `SKYLIGHT_PASSWORD` — used to call `POST /api/sessions` when no explicit header, Basic token, or Bearer token is set.
- `SKYLIGHT_BASIC_TOKEN` — optional precomputed `Authorization: Basic <base64(id:token)>` value.
- `SKYLIGHT_BEARER_TOKEN` — optional `Authorization: Bearer <token>` value (matches the web app’s accessToken).
- `SKYLIGHT_AUTH_HEADER` — optional full `Authorization` header value (wins over BASIC/BEARER).
- `SKYLIGHT_API_BASE` — defaults to `https://app.ourskylight.com`.
- `SKYLIGHT_API_VERSION` — valid `YYYY-MM-DD` value sent as `Skylight-Api-Version` (default `2026-03-01`).
- `SKYLIGHT_FRAME_ID` — optional explicit frame id for `/api/frames/{frameId}/...` endpoints.
- `SKYLIGHT_CALENDAR_URL` — optional absolute HTTP(S) share URL containing `/calendar/<numeric-id>`.
- `SKYLIGHT_TIMEZONE` — defaults to the machine's IANA timezone.
- `SKYLIGHT_REQUEST_TIMEOUT_MS` — request timeout from `1` to `2147483647` milliseconds (default `30000`).

Credential precedence is `SKYLIGHT_AUTH_HEADER`, then `SKYLIGHT_BASIC_TOKEN`, then `SKYLIGHT_BEARER_TOKEN`, then email/password login. Unset an expired higher-priority token if you want the agent to log in with email and password.

In `.env`, quote values that contain `#` or intentional leading/trailing spaces. Double-quoted values support `\\`, `\\"`, `\\n`, `\\r`, and `\\t` escapes.

## Frame scoping

If `SKYLIGHT_FRAME_ID` is not set, the agent will:

1. Try to parse the numeric id from `SKYLIGHT_CALENDAR_URL` (e.g. `/calendar/1234567` -> `1234567`).
2. Try `GET /api/frames/{id}` with that id. Only if it returns `404`, or when no URL id exists, call `GET /api/frames/calendar`. The agent uses the result automatically when exactly one frame is returned; for multiple frames it lists their ids and requires `SKYLIGHT_FRAME_ID`. A `404` from the calendar listing falls back to the legacy `/api/frames` route.

## API base URL normalization

If you set `SKYLIGHT_API_BASE` to `https://app.ourskylight.com/api`, the agent will normalize it back to `https://app.ourskylight.com` (it always prefixes paths with `/api/...`).
