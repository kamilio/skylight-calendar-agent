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

Instead of email and password, you may set one of:

- `SKYLIGHT_AUTH_HEADER` — complete `Authorization` header value
- `SKYLIGHT_BASIC_TOKEN` — base64-encoded Skylight user-id/token pair
- `SKYLIGHT_BEARER_TOKEN` — web-app access token

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
skylight lists item-create --list-id 5984736 --label "Replace air filter"
skylight lists items-create --list-id 5984736 --labels "Buy filter" "Install filter"
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

### MCP safety

Commands that reveal credentials, send account-recovery email, accept account passwords or share tokens, delete the user account, or transfer frame ownership are intentionally limited to the CLI and SDK. They are not advertised as MCP tools.

Dynamic IDs are encoded as individual URL path segments, and typed commands reject blank names, impossible dates, reversed date ranges, invalid page numbers, empty bulk operations, and non-object payloads where a JSON object is required.

## Development

```sh
npm run dev:cli -- lists --help
npm run dev:mcp
npm run check
```

`npm run check` performs a clean TypeScript build, CLI/MCP/transport smoke tests, and an npm package dry run.

## Disclaimer

This project is not affiliated with or endorsed by Skylight. It uses undocumented API endpoints that may change without notice.
