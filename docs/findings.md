# Findings / Notes

## Sources

- Upstream OpenAPI: `docs/openapi/openapi.upstream.yaml`
- Merged OpenAPI (includes PR #1 auth endpoint): `docs/openapi/openapi.yaml`

## Authentication

The legacy `POST /api/sessions` login now rejects current clients with an unsupported-version response. Authentication uses Skylight's OAuth2 authorization-code flow:

1. Establish a browser session through `/auth/session/new` and `/auth/session`.
2. Request an authorization code from `/oauth/authorize` with client id `skylight-mobile` and a stable device fingerprint.
3. Exchange the code at `/oauth/token` for Bearer access and rotating refresh tokens.
4. Persist the refresh token and fingerprint securely, rotate the stored refresh token on every refresh, and send the access token as `Authorization: Bearer <token>`.

The CLI scaffolding auto-logs-in using this OAuth flow when `SKYLIGHT_EMAIL`/`SKYLIGHT_PASSWORD` are set and no explicit or stored credential is available.

The web app also uses a Bearer token (`Authorization: Bearer <accessToken>`) stored in local storage; you can provide it via `SKYLIGHT_BEARER_TOKEN`.

## API version header

The authenticated calendar web app currently sends `Skylight-Api-Version: 2026-05-01` on API requests. This agent sends the same header by default (configurable via `SKYLIGHT_API_VERSION`).

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
