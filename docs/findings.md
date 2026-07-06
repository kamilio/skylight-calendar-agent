# Findings / Notes

## Sources

- Upstream OpenAPI: `docs/openapi/openapi.upstream.yaml`
- Merged OpenAPI (includes PR #1 auth endpoint): `docs/openapi/openapi.yaml`

## Authentication

PR #1 adds `POST /api/sessions` which returns an `id` and `token`. The API expects:

1. Concatenate `id:token`
2. Base64 encode
3. Send `Authorization: Basic <base64>`

The CLI scaffolding auto-logs-in using `SKYLIGHT_EMAIL`/`SKYLIGHT_PASSWORD` when no explicit auth header, Basic token, or Bearer token is set.

The web app also uses a Bearer token (`Authorization: Bearer <accessToken>`) stored in local storage; you can provide it via `SKYLIGHT_BEARER_TOKEN`.

## API version header

The web app sends `Skylight-Api-Version: 2026-03-01` on API requests. This agent now sends the same header (configurable via `SKYLIGHT_API_VERSION`).

## Calendar scope

The public calendar page at `https://ourskylight.com/calendar/1234567` is an SPA (served HTML just bootstraps an Expo bundle).

OpenAPI endpoints generally require a `frameId` (`/api/frames/{frameId}/...`). We currently do not have an OpenAPI-documented mapping from the public calendar URL to a `frameId`.

In the web app bundle, the route param is named `calendarId` but is passed to API calls as `frameId`, so `1234567` may already be the `frameId` for this project’s scope.

The local `skylight.har` capture includes authenticated API calls summarized in `docs/har-endpoints.md`. The broader endpoint families below combine that capture with web-bundle inspection.

## Discovered endpoint families (from web bundle inspection)

These are implemented as CLI sections now, with sensitive operations excluded from MCP as documented in `docs/actions.md`:

- Calendar: `/api/frames/{frameId}/calendar_events/*`, `/api/frames/{frameId}/source_calendars/*`
- Tasks: `/api/frames/{frameId}/chores/*`, `/api/frames/{frameId}/task_box/items`
- Rewards: `/api/frames/{frameId}/rewards/*`, `/api/frames/{frameId}/reward_points`
- Lists: `/api/frames/{frameId}/lists/*` and `/list_items/*`
- Meals: `/api/frames/{frameId}/meals/categories`, `/meals/sittings/*`
- Recipes: `/api/frames/{frameId}/meals/recipes/*`
- Photos: `/api/frames/{frameId}/messages/*`, `/api/frames/{frameId}/albums/*`
- Profiles: `/api/user`, `/api/user/profile`, `/api/frames/*`, `/api/frames/{frameId}/profile`, `/api/frames/{frameId}/categories/{categoryId}/family_member`

Additionally observed in HAR:

- `/api/frames/{frameId}/event_notification_settings` (GET/PUT)
- `/api/plus_access`
