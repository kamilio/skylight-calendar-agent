# Configuration

Set either `SKYLIGHT_FRAME_ID` or an optional public `SKYLIGHT_CALENDAR_URL`.

## Environment variables

- `SKYLIGHT_EMAIL` / `SKYLIGHT_PASSWORD` — used to call `POST /api/sessions` when `SKYLIGHT_BASIC_TOKEN` is not set.
- `SKYLIGHT_BASIC_TOKEN` — optional precomputed `Authorization: Basic <base64(id:token)>` value.
- `SKYLIGHT_BEARER_TOKEN` — optional `Authorization: Bearer <token>` value (matches the web app’s accessToken).
- `SKYLIGHT_AUTH_HEADER` — optional full `Authorization` header value (wins over BASIC/BEARER).
- `SKYLIGHT_API_BASE` — defaults to `https://app.ourskylight.com`.
- `SKYLIGHT_API_VERSION` — valid `YYYY-MM-DD` value sent as `Skylight-Api-Version` (default `2026-03-01`).
- `SKYLIGHT_FRAME_ID` — required for most OpenAPI-documented endpoints (`/api/frames/{frameId}/...`).
- `SKYLIGHT_CALENDAR_URL` — optional absolute HTTP(S) share URL containing `/calendar/<numeric-id>`.
- `SKYLIGHT_TIMEZONE` — defaults to `America/Chicago`.
- `SKYLIGHT_REQUEST_TIMEOUT_MS` — request timeout from `1` to `2147483647` milliseconds (default `30000`).

## Frame scoping

If `SKYLIGHT_FRAME_ID` is not set, the agent will:

1. Try to parse the numeric id from `SKYLIGHT_CALENDAR_URL` (e.g. `/calendar/1234567` -> `1234567`).
2. Try `GET /api/frames/{id}` with that id; only if it returns `404`, call `GET /api/frames` and use the only returned frame (or ask you to pick one).

## API base URL normalization

If you set `SKYLIGHT_API_BASE` to `https://app.ourskylight.com/api`, the agent will normalize it back to `https://app.ourskylight.com` (it always prefixes paths with `/api/...`).
