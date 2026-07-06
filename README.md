# skylight-calendar-agent

Unofficial [Toolcraft](https://www.npmjs.com/package/toolcraft) CLI and MCP server for Skylight Calendar.

It exposes calendar, task, reward, list, meal, recipe, photo, and profile operations. The most common list workflows have typed commands for creating lists and adding one or many to-do items.

## Requirements

- Node.js 20 or newer
- A Skylight account or an existing API token

## Install

```sh
npm install -g skylight-calendar-agent
```

For local development:

```sh
npm install
npm run build
```

## Configure

Set credentials in the environment or a `.env` file in the working directory:

```sh
SKYLIGHT_EMAIL=you@example.com
SKYLIGHT_PASSWORD=your-password
SKYLIGHT_FRAME_ID=1234567
```

Quote dotenv values that contain `#` or intentional leading/trailing spaces, for example `SKYLIGHT_PASSWORD=" secret#value "`.

Instead of email and password, you may set one of:

- `SKYLIGHT_AUTH_HEADER` — complete `Authorization` header value
- `SKYLIGHT_BASIC_TOKEN` — base64-encoded Skylight user-id/token pair
- `SKYLIGHT_BEARER_TOKEN` — web-app access token

If multiple methods are set, precedence is full auth header, Basic token, Bearer token, then email/password login. Unset an expired token to fall back to email/password.

An explicitly exported credential method takes precedence over credential methods in `.env`. When shell credentials are present, `SKYLIGHT_API_BASE` is also not loaded from `.env`; export it explicitly if you intentionally use a custom API host. This prevents a stale or untrusted working-directory file from redirecting exported credentials.

`profiles update-email` uses `SKYLIGHT_PASSWORD` by default, so the current password does not need to appear in shell history. Pass `--password` only to override it.

See `.env.example` for optional API, calendar URL, and timezone settings. Credentials and captured traffic files are ignored by Git and excluded from the npm package.

## Lists and to-dos

Create a to-do list:

```sh
skylight lists create --label "Weekend"
```

Create a shopping list:

```sh
skylight lists create --label "Hardware Store" --kind shopping --color B6E085
```

Find the new list ID, then add one or many items:

```sh
skylight lists list
skylight lists item-create --list-id LIST_ID --label "Replace air filter"
skylight lists items-create --list-id LIST_ID --labels "Buy filter" "Install filter"
```

Skylight list items currently expose label, status, section, position, and creation time, but no due-date field. For a dated task, create a chore instead:

```sh
skylight tasks chore-create-simple --summary "Replace air filter" --start 2026-07-12
```

Raw list and item commands remain available as `lists create-raw` and `lists item-create-raw` for API fields not yet modeled by this package.
Their `*Json` options accept JSON text in the CLI and native JSON values over MCP/SDK.

## MCP

Run the stdio MCP server:

```sh
skylight-calendar-mcp
```

Example MCP client configuration:

```json
{
  "mcpServers": {
    "skylight": {
      "command": "npx",
      "args": ["-y", "--package", "skylight-calendar-agent", "skylight-calendar-mcp"],
      "env": {
        "SKYLIGHT_EMAIL": "you@example.com",
        "SKYLIGHT_PASSWORD": "your-password",
        "SKYLIGHT_FRAME_ID": "1234567"
      }
    }
  }
}
```

If the package is globally installed, set `command` directly to `skylight-calendar-mcp` and omit `args`.

## SDK

The package exports a pre-bound SDK factory with typed command names and parameters:

```sh
npm install skylight-calendar-agent
```

```js
import { createSkylightSDK } from "skylight-calendar-agent";

const skylight = createSkylightSDK();
const lists = await skylight.lists.list({});
const created = await skylight.lists.create({ label: "Weekend" });
```

The SDK reads the same `SKYLIGHT_*` variables from `process.env` and accepts native JSON values for `*Json` parameters. It does not load `.env` automatically; load that file in your application before creating the SDK if needed. Response types are `unknown` because the upstream API is undocumented and may change.

Request failures preserve their structured `SkylightRequestError` type, which is exported with `status`, `method`, and `path` fields for SDK error handling. SDK error messages are stripped of terminal control characters.

### MCP safety

Commands that reveal or mint credentials, OAuth authorization URLs, device activation codes, and signed upload URLs; trigger account emails, exports, migrations, hardware reset/deletion, or hidden-frame state; accept account passwords or share tokens; delete the user account; or transfer frame ownership are intentionally limited to the CLI and SDK. They are not advertised as MCP tools.

The destructive CLI commands `profiles user-delete`, `profiles frame-hide`, `profiles frame-transfer`, `profiles device-delete`, `profiles device-reset`, and `meals migrate` also require `--confirm`.

Dynamic IDs are encoded as individual URL path segments, and typed commands reject blank names, impossible dates, reversed date ranges, invalid page numbers, empty bulk operations, and non-object payloads where a JSON object is required.

To keep malformed requests bounded, command strings are limited to 8,192 characters and command arrays to 500 items. Native/raw JSON inputs additionally allow at most 500 properties or array items per container, 500-character property names, and 100 nesting levels.

For terminal safety, the human-readable CLI flattens response line breaks/tabs and marks exceptionally large response fields or collections as truncated (500 properties/items, 500-character property names, or 10,000-character strings). These CLI-only layout and size limits do not apply to SDK or MCP responses.

## Development

```sh
npm run dev:cli -- lists --help
npm run --silent dev:mcp
npm run check
```

`npm run check` performs a clean TypeScript build, CLI/MCP/transport smoke tests, and an npm package dry run.

## Disclaimer

This project is not affiliated with or endorsed by Skylight. It uses undocumented API endpoints that may change without notice.
