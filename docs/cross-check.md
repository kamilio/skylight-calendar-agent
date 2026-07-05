# Cross-check (OpenAPI + Web bundle + HAR)

## CLI surface

`npm run dev:cli -- --help` shows the 8 requested sections:

- `calendar`, `tasks`, `rewards`, `lists`, `meals`, `recipes`, `photos`, `profiles`

Full action inventory is in `docs/actions.md`.

## OpenAPI spec coverage

From `docs/openapi/openapi.yaml`, the documented endpoints are:

- `POST /api/sessions` (auth)
- `GET /api/frames/{frameId}`
- `GET|POST /api/frames/{frameId}/chores`
- `GET /api/frames/{frameId}/categories`
- `GET /api/frames/{frameId}/devices`
- `GET /api/frames/{frameId}/lists`
- `GET /api/frames/{frameId}/lists/{listId}`
- `POST /api/frames/{frameId}/task_box/items`
- `GET /api/frames/{frameId}/source_calendars`
- `GET /api/frames/{frameId}/calendar_events`
- `GET /api/frames/{frameId}/rewards`
- `GET /api/frames/{frameId}/reward_points`

Each of these has a corresponding CLI command implemented (either directly or via a `*-jsonapi` raw-body command for the JSON:API shapes).

## Web bundle cross-check

The Expo web bundle for `https://ourskylight.com/calendar/1234567` defines an API client with base URL `https://app.ourskylight.com/api` and header `Skylight-Api-Version: 2026-03-01`.

We matched:

- Header: agent sends `Skylight-Api-Version` (configurable via `SKYLIGHT_API_VERSION`).
- Paths: bundle uses `frames/${frameId}/...` under `/api`; agent uses `/api/frames/${frameId}/...`.
- Methods: we adjusted key endpoints to match bundle usage (notably `PUT` for event edits, chore updates, list updates, etc).

## HAR cross-check

`skylight.har` currently contains only `GET` requests for the SPA shell + static assets; it includes **no API calls** (no `/api/...`, no mutations). See `docs/har.md`.

## Known uncertainties (need a new HAR with API calls)

- Exact request bodies for some endpoints (especially chores create/update, category multipart uploads).
- Array query serialization (e.g. bulk message deletion `message_ids`).
- Whether `1234567` always equals the real `frameId` for your account; the agent verifies via `GET /api/frames/{id}` and falls back to enumerating `GET /api/frames` when needed.
