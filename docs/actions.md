# Actions by section

This agent implements the sections you asked for:

All listed actions are available to the CLI and SDK. For safety, these are not advertised as MCP tools: `meals migrate`; `photos upload-credentials`, `photos upload-url`, `photos upload-urls`; and `profiles token`, `profiles forgot-password`, `profiles update-email`, `profiles discount-code`, `profiles plus-resend-entitlement-email`, `profiles user-export`, `profiles user-delete`, `profiles frame-hide`, `profiles frame-transfer`, and `profiles frame-share-token-redeem`.

## Calendar

- Events: `calendar events`, `calendar events-search`, `calendar events-countdowns`, `calendar recent-invited-emails`
- Notification settings: `calendar notification-settings`, `calendar notification-settings-update`
- Mutations: `calendar event-create`, `calendar event-edit`, `calendar event-delete`
- Accounts/sync: `calendar calendar-accounts`, `calendar calendar-account-calendars`, `calendar calendar-account-update`, `calendar webcal-sync`, `calendar webcal-urls`, `calendar sync-oauth-url`
- Source calendars: `calendar source-calendars`, `calendar source-calendar-get`, `calendar source-calendar-save`, `calendar source-calendar-delete`, `calendar source-calendar-set-default`, `calendar source-calendar-link-profiles`

## Tasks

- Chores: `tasks chores`, `tasks chore-create`, `tasks chore-create-simple`, `tasks chore-create-jsonapi`, `tasks chore-update`, `tasks chore-delete`, `tasks chore-status`
- Task Box: `tasks taskbox-list`, `tasks taskbox-save`, `tasks taskbox-delete`
- Task Box create: `tasks taskbox-create`, `tasks taskbox-create-jsonapi`

## Rewards

- Rewards: `rewards list`, `rewards get`, `rewards create`, `rewards update`, `rewards delete`, `rewards redeem`, `rewards unredeem`
- Points: `rewards points`, `rewards points-add`

## Lists

- Lists: `lists list`, `lists get`, `lists create`, `lists create-raw`, `lists update`, `lists delete`
- Items: `lists items`, `lists item-create`, `lists items-create`, `lists item-create-raw`, `lists item-update`, `lists item-delete`, `lists item-move`, `lists items-move-section`, `lists items-delete`

## Meals

- Categories: `meals categories`, `meals category-update`
- Sittings: `meals list`, `meals get`, `meals create`, `meals create-raw`, `meals update`, `meals delete`, `meals migrate`

## Recipes

- Recipes: `recipes list`, `recipes get`, `recipes create`, `recipes update`, `recipes delete`, `recipes add-to-grocery-list`

## Photos

- Messages: `photos list`, `photos list-paged`, `photos list-synced`, `photos get`, `photos delete`, `photos delete-many`, `photos copy-to-frames`, `photos caption-update`
- Social: `photos likes`, `photos like`, `photos unlike`, `photos comments`, `photos comment`, `photos comment-delete`
- Upload helpers: `photos upload-credentials`, `photos upload-url`, `photos upload-urls`, `photos upload-message`
- Albums: `photos albums`, `photos album-create`, `photos album-rename`, `photos album-delete`, `photos album-messages`, `photos album-message-ids`, `photos album-add`, `photos album-remove`

## Profiles

- Auth helper: `profiles token`
- Account: `profiles user`, `profiles user-update`, `profiles user-export`, `profiles user-delete`
- Subscription: `profiles plus-access`, `profiles plus-resend-entitlement-email`
- Account prefs: `profiles notification-preference`, `profiles marketing-preference`, `profiles forgot-password`, `profiles update-email`, `profiles discount-code`
- Frames: `profiles frames`, `profiles frame`, `profiles frame-update`, `profiles frame-rename`, `profiles frame-hide`, `profiles frame-transfer`, `profiles frame-share-token-redeem`
- Household: `profiles owner-profile-update`, `profiles family-member-update`
- Categories: `profiles categories`, `profiles category-get`, `profiles category-create`, `profiles category-find-or-create`, `profiles category-update`, `profiles category-delete`, `profiles category-link-source-calendars`
- Devices: `profiles devices`, `profiles device-get`, `profiles device-create`, `profiles device-rename`, `profiles device-update-settings`, `profiles device-reset`, `profiles device-activation-code`, `profiles device-delete`

## Notes

- `profiles user-delete`, `profiles frame-hide`, and `meals migrate` require `--confirm` in the CLI or `confirm: true` in the SDK.
- Commands that accept `*Json` parameters pass raw JSON through to the API. The CLI accepts JSON text; MCP and SDK callers can pass native JSON values.
- Skylight list items do not expose a due-date field. Use `tasks chore-create-simple --start YYYY-MM-DD` for a dated task.
- `SKYLIGHT_FRAME_ID` is optional; if unset, the agent first tries the numeric id from `SKYLIGHT_CALENDAR_URL`, then discovers calendar frames from the account and uses the result when exactly one frame is returned.
