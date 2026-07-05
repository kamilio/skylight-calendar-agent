# HAR endpoints (captured)

This file is derived from `skylight.har` and is meant to be a quick “did we capture the right stuff?” checklist.

## API host

- `app.ourskylight.com`

## Unique API endpoints (method + path)

- `GET /api/user`
- `GET /api/frames/calendar`
- `GET /api/frames/photo`
- `GET /api/frames/tv`
- `GET /api/frames/{frameId}` (captured id redacted)
- `GET /api/frames/{frameId}/calendar_events`
- `GET /api/frames/{frameId}/categories`
- `GET /api/frames/{frameId}/categories/{categoryId}`
- `GET /api/frames/{frameId}/chores`
- `POST /api/frames/{frameId}/chores/create_multiple`
- `PUT /api/frames/{frameId}/chores/{choreId}`
- `GET /api/frames/{frameId}/devices`
- `GET /api/frames/{frameId}/event_notification_settings`
- `GET /api/frames/{frameId}/lists`
- `GET /api/frames/{frameId}/lists/{listId}`
- `POST /api/frames/{frameId}/lists/{listId}/list_items`
- `GET /api/frames/{frameId}/meals/categories`
- `GET /api/frames/{frameId}/meals/recipes`
- `GET /api/frames/{frameId}/meals/recipes/{recipeId}`
- `GET /api/frames/{frameId}/meals/sittings`
- `GET /api/frames/{frameId}/reward_points`
- `GET /api/frames/{frameId}/rewards`
- `GET /api/frames/{frameId}/source_calendars`
- `GET /api/frames/{frameId}/task_box/items`
- `GET /api/plus_access`

## Notes

- HAR shows `Authorization: Bearer ...` (not Basic) for API calls.
- HAR includes a stray `GET /api/frames/undefined` (404) from the web app; ignored by the agent.
