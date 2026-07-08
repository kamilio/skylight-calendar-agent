# Cross-check (OpenAPI + Web bundle + HAR)

## CLI surface

`npm run dev:cli -- --help` shows the 8 requested sections:

- `calendar`, `tasks`, `rewards`, `lists`, `meals`, `recipes`, `photos`, `profiles`

Full action inventory is in `docs/actions.md`.

## OpenAPI spec coverage

From `docs/openapi/openapi.yaml`, the documented endpoints are:

- Browser-backed OAuth2 login through `/auth/session`, `/oauth/authorize`, and `/oauth/token`
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

The authenticated Expo calendar web client uses base URL `https://app.ourskylight.com/api` and currently sends `Skylight-Api-Version: 2026-05-01`.

We matched:

- Header: agent sends `Skylight-Api-Version` (configurable via `SKYLIGHT_API_VERSION`).
- Paths: bundle uses `frames/${frameId}/...` under `/api`; agent uses `/api/frames/${frameId}/...`.
- Methods: we adjusted key endpoints to match bundle usage (notably `PUT` for event edits, chore updates, list updates, etc).

## HAR cross-check

The local `skylight.har` includes authenticated API traffic, including calendar-frame discovery, calendar/task/reward/list/meal reads, chore create/update, and list-item creation. The normalized endpoint inventory is in `docs/har-endpoints.md`.

## Known uncertainties

- Exact request bodies for endpoints not exercised in the current capture (especially uploads and some bulk mutations).
- Array query serialization (e.g. bulk message deletion `message_ids`).
- Whether a public calendar URL id always equals the real `frameId`; the agent verifies via `GET /api/frames/{id}` and falls back to `GET /api/frames/calendar` when needed.
