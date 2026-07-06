# Capturing API traffic in a HAR

If a capture contains only static asset `GET`s to `https://ourskylight.com/...` (fonts, images, or the JS bundle), record again while the app is making **Fetch/XHR** requests to:

- `https://app.ourskylight.com/api/...`

## Web (Chrome / Edge) — recommended

1. Open the app in a normal tab (not an extension/devtools-only window).
2. Open DevTools → **Network**.
3. Enable:
   - **Preserve log**
   - **Disable cache** (only works while DevTools is open)
4. In Network, click the filter **Fetch/XHR** (or just use the search box and type `api`).
5. Reload with DevTools open:
   - Right-click reload → **Empty Cache and Hard Reload**
6. Perform actions that force network calls (examples below).
7. Confirm you see requests whose URL starts with `https://app.ourskylight.com/api/`.
8. Export:
   - Click the Network request list, then right-click → **Save all as HAR with content**

### Actions to click through (forces all sections)

Try to hit at least one endpoint per section:

- Calendar: open the calendar month/week view (loads events), search events
- Tasks: open chores/tasks screen, toggle a chore status if possible
- Rewards: open rewards screen
- Lists: open lists, open a specific list (loads list items)
- Meals: open meals screen, open meal categories
- Recipes: open recipes list, open a recipe detail
- Photos: open photos/messages, open albums
- Profiles: open account/profile/settings screen

## Sanity-check the HAR locally

After exporting, confirm it contains API calls:

```sh
jq -r '.log.entries[] | select(.request.url | test("app\\.ourskylight\\.com/api")) | .request.method + " " + (.request.url | sub("\\\\?.*"; ""))' \
  skylight.har | sort -u | head -200
```

If this prints nothing, you didn’t capture while the app was making API requests.

## Common gotchas

- You started recording *after* the data loaded (reload with **Preserve log** on).
- You exported from a tab that only served assets (make sure you’re capturing the same tab where you interact with the app).
- The Network panel was filtered (clear filters; use **All** or **Fetch/XHR**).
- Cached data prevented calls (use **Disable cache** + hard reload).

## Security / redaction

HAR files can include sensitive tokens (Authorization headers, cookies) and personal data.

- Do **not** commit raw HAR files.
- If you need to share a HAR, redact:
  - `Authorization` headers
  - cookies (e.g. `_skylight_cloud_session`)
  - emails, IDs, URLs containing share tokens

## Playwright `open` (what went wrong + fixed command)

You ran:

```sh
npx playwright open \
  --save-har=skylight.har \
  --save-har-glob="**/ourskylight.com/**" \
  --save-storage=auth.json \
  https://app.ourskylight.com
```

That glob only matches `ourskylight.com`, so it **filters out** the API host:

- `https://app.ourskylight.com/api/...`

### Capture only API calls (recommended)

```sh
npx playwright open \
  --save-har=skylight.har \
  --save-har-glob="**/app.ourskylight.com/api/**" \
  --save-storage=auth.json \
  https://app.ourskylight.com
```

### Capture both app + public calendar site

```sh
npx playwright open \
  --save-har=skylight.har \
  --save-har-glob="**/*ourskylight.com/**" \
  --save-storage=auth.json \
  https://app.ourskylight.com
```

### Important

- You must **interact** with the app (open lists, meals, photos, etc.) to generate requests.
- The HAR is written when the Playwright browser closes; close the window to flush it.
