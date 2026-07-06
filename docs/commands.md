# Commands

Top-level sections (groups):

- `calendar`
- `tasks`
- `rewards`
- `lists`
- `meals`
- `recipes`
- `photos`
- `profiles`

Entry points:

- CLI: `npm run dev:cli -- --help`
- MCP (stdio): `npm run --silent dev:mcp` (silent mode keeps npm banners off the JSON-RPC stream)

## Examples

- Calendar events: `npm run dev:cli -- calendar events --date-min 2026-04-01 --date-max 2026-04-30`
- Tasks (chores): `npm run dev:cli -- tasks chores --after 2026-04-01 --before 2026-04-30`
- Rewards: `npm run dev:cli -- rewards list`
- Lists: `npm run dev:cli -- lists list`
- Meals: `npm run dev:cli -- meals list --date-min 2026-04-01 --date-max 2026-04-30`
- Recipes: `npm run dev:cli -- recipes list`
- Photos: `npm run dev:cli -- photos albums`
- Profiles/auth: `npm run dev:cli -- profiles token`
