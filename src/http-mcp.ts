#!/usr/bin/env node
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { createHTTPMCPServer } from "toolcraft/http";
import {
  createInMemoryHostedOAuthStorage,
  hostedOAuth,
  type HostedOAuthStorage,
} from "toolcraft/http/hosted-oauth";
import { loadDotEnv } from "./env.js";
import { root } from "./root.js";
import {
  httpMcpTokenFromEnvironment,
  tokenMatches,
} from "./skylight/http-auth.js";
import {
  createLocalSkylightServices,
} from "./skylight/service.js";
import { deriveOAuthKeyMaterial } from "./skylight/oauth-keys.js";
import { createSkylightOAuthProvider } from "./skylight/oauth-provider.js";
import type { StoredOAuthCredential } from "./skylight/oauth.js";
import { terminalSafeText } from "./skylight/text.js";
import { packageVersion } from "./version.js";
import { skylightCalendarIconSvg } from "./branding.js";

loadDotEnv();

interface Config {
  hostname: string;
  port: number;
  path: string;
  publicUrl: URL | null;
  allowedHosts: Set<string>;
  allowedOrigins: Set<string>;
  maxRequestBytes: number;
  maxBatchSize: number;
  maxSessions: number;
  sessionTtlMs: number;
  maxStreamsPerSession: number;
  maxStreamBufferBytes: number;
  maxSseEventHistory: number;
  sseKeepAliveMs: number;
  maxConcurrentToolCalls: number;
  trustedProxy: boolean;
  insecureNoAuth: boolean;
  embeddedOAuth: boolean;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const SHUTDOWN_GRACE_MS = 50_000;

function integer(value: string | undefined, fallback: number, label: string, minimum: number): number {
  if (value === undefined || value.length === 0) return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`${label} must be an integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error(`${label} must be at least ${minimum}.`);
  }
  return parsed;
}

function boolean(value: string | undefined, label: string): boolean {
  if (value === undefined || value === "" || value === "0" || value === "false") return false;
  if (value === "1" || value === "true") return true;
  throw new Error(`${label} must be 1, 0, true, or false.`);
}

function normalizePath(value: string): string {
  if (value.includes("?") || value.includes("#")) throw new Error("HTTP MCP path cannot contain a query or fragment.");
  const path = value.startsWith("/") ? value : `/${value}`;
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

function csv(value: string | undefined): string[] {
  return (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function rejectExternalOAuth(env: NodeJS.ProcessEnv): void {
  if (
    [
      env.SKYLIGHT_MCP_OAUTH_AUTHORIZATION_SERVERS,
      env.SKYLIGHT_MCP_OAUTH_JWKS_URL,
      env.SKYLIGHT_MCP_OAUTH_SCOPES,
    ].some((value) => (value?.trim() ?? "").length > 0)
  ) {
    throw new Error(
      "External OAuth verification cannot bind an OAuth subject to a Skylight account safely. Use the built-in hosted OAuth flow for per-user accounts, or an explicit pre-shared HTTP token for a single account."
    );
  }
}

function parseArguments(argv: string[], env: NodeJS.ProcessEnv): Config {
  const values = new Map<string, string>();
  let insecureNoAuth = boolean(env.SKYLIGHT_MCP_HTTP_INSECURE_NO_AUTH, "SKYLIGHT_MCP_HTTP_INSECURE_NO_AUTH");
  let embeddedOAuthRequested = boolean(env.SKYLIGHT_MCP_OAUTH_LOGIN, "SKYLIGHT_MCP_OAUTH_LOGIN");
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--insecure-no-auth") {
      insecureNoAuth = true;
      continue;
    }
    if (argument === "--oauth-login") {
      embeddedOAuthRequested = true;
      continue;
    }
    if (argument === "--help") {
      process.stdout.write(`skylight-calendar-mcp-http [options]\n\nOptions:\n  --hostname <host>       Bind host (default 127.0.0.1)\n  --port <port>           Bind port (default 8787; 0 for explicit-token mode)\n  --path <path>           MCP path (default /mcp)\n  --public-url <url>      Canonical externally reachable MCP URL\n  --insecure-no-auth      Disable auth (loopback only)\n\nBrowser OAuth login is enabled automatically unless an explicit HTTP token is configured.\n`);
      process.exit(0);
    }
    if (!argument?.startsWith("--")) throw new Error(`Unknown argument ${JSON.stringify(argument)}.`);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) throw new Error(`${argument} requires a value.`);
    values.set(argument, next);
    index += 1;
  }
  const hostname = values.get("--hostname") ?? env.SKYLIGHT_MCP_HTTP_HOST ?? "127.0.0.1";
  const port = integer(values.get("--port") ?? env.SKYLIGHT_MCP_HTTP_PORT, 8787, "HTTP MCP port", 0);
  if (port > 65_535) throw new Error("HTTP MCP port must not exceed 65535.");
  const path = normalizePath(values.get("--path") ?? env.SKYLIGHT_MCP_HTTP_PATH ?? "/mcp");
  const rawPublicUrl = values.get("--public-url") ?? env.SKYLIGHT_MCP_HTTP_PUBLIC_URL;
  const publicUrl = rawPublicUrl ? new URL(rawPublicUrl) : null;
  if (publicUrl !== null && (publicUrl.username || publicUrl.password || publicUrl.search || publicUrl.hash)) {
    throw new Error("HTTP MCP public URL must not contain credentials, query, or fragment.");
  }
  if (publicUrl !== null && normalizePath(publicUrl.pathname) !== path) {
    throw new Error("HTTP MCP public URL path must match the configured MCP path.");
  }
  const loopback = LOOPBACK_HOSTS.has(hostname);
  if (!loopback && (publicUrl === null || publicUrl.protocol !== "https:")) {
    throw new Error("Non-loopback HTTP MCP binding requires an https --public-url behind a TLS reverse proxy.");
  }
  if (insecureNoAuth && !loopback) throw new Error("--insecure-no-auth is allowed only on loopback.");
  rejectExternalOAuth(env);
  const embeddedOAuth = embeddedOAuthRequested ||
    (!insecureNoAuth && (env.SKYLIGHT_MCP_HTTP_TOKEN?.trim() ?? "").length === 0);
  if (embeddedOAuth && publicUrl === null && port === 0) {
    throw new Error("Automatic OAuth login requires a fixed port when no public URL is configured.");
  }
  if (embeddedOAuth && publicUrl !== null && publicUrl.protocol !== "https:" && !LOOPBACK_HOSTS.has(publicUrl.hostname)) {
    throw new Error("Embedded OAuth login requires an HTTPS public URL unless the URL is loopback.");
  }
  if (embeddedOAuth && insecureNoAuth) {
    throw new Error("OAuth and --insecure-no-auth cannot be enabled together.");
  }
  return {
    hostname,
    port,
    path,
    publicUrl,
    allowedHosts: new Set(csv(env.SKYLIGHT_MCP_HTTP_ALLOWED_HOSTS).map((host) => host.toLowerCase())),
    allowedOrigins: new Set(csv(env.SKYLIGHT_MCP_HTTP_ALLOWED_ORIGINS).map((origin) => new URL(origin).origin)),
    maxRequestBytes: integer(env.SKYLIGHT_MCP_HTTP_MAX_REQUEST_BYTES, 1_048_576, "HTTP MCP max request bytes", 1),
    maxBatchSize: integer(env.SKYLIGHT_MCP_HTTP_MAX_BATCH_SIZE, 20, "HTTP MCP max batch size", 1),
    maxSessions: integer(env.SKYLIGHT_MCP_HTTP_MAX_SESSIONS, 100, "HTTP MCP max sessions", 1),
    sessionTtlMs: integer(env.SKYLIGHT_MCP_HTTP_SESSION_TTL_MS, 1_800_000, "HTTP MCP session TTL", 1_000),
    maxStreamsPerSession: integer(env.SKYLIGHT_MCP_HTTP_MAX_STREAMS_PER_SESSION, 1, "HTTP MCP max streams per session", 1),
    maxStreamBufferBytes: integer(env.SKYLIGHT_MCP_HTTP_MAX_STREAM_BUFFER_BYTES, 1_048_576, "HTTP MCP max stream buffer bytes", 0),
    maxSseEventHistory: integer(env.SKYLIGHT_MCP_HTTP_MAX_SSE_EVENT_HISTORY, 100, "HTTP MCP max SSE event history", 0),
    sseKeepAliveMs: integer(env.SKYLIGHT_MCP_HTTP_SSE_KEEP_ALIVE_MS, 30_000, "HTTP MCP SSE keep-alive", 0),
    maxConcurrentToolCalls: integer(env.SKYLIGHT_MCP_HTTP_MAX_CONCURRENT_TOOL_CALLS, 20, "HTTP MCP max concurrent tool calls", 1),
    trustedProxy: boolean(env.SKYLIGHT_MCP_HTTP_TRUST_PROXY, "SKYLIGHT_MCP_HTTP_TRUST_PROXY"),
    insecureNoAuth,
    embeddedOAuth,
  };
}

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const serialized = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(Buffer.byteLength(serialized)),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    ...headers,
  });
  res.end(serialized);
}

function svg(res: ServerResponse, body: string): void {
  res.writeHead(200, {
    "content-type": "image/svg+xml; charset=utf-8",
    "content-length": String(Buffer.byteLength(body)),
    "cache-control": "public, max-age=86400",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
    "x-content-type-options": "nosniff",
  });
  res.end(body);
}

function requestHost(req: IncomingMessage): string {
  const value = req.headers.host;
  return (Array.isArray(value) ? value[0] : value ?? "").toLowerCase();
}

function normalizedHostname(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith("[")) {
    const closing = normalized.indexOf("]");
    if (closing > 0) return normalized.slice(1, closing);
  }
  const colonCount = [...normalized].filter((character) => character === ":").length;
  if (colonCount > 1) return normalized;
  return normalized.includes(":") ? normalized.split(":")[0] ?? normalized : normalized;
}

function bearer(req: IncomingMessage): string | null {
  const value = req.headers.authorization;
  const header = Array.isArray(value) ? value[0] : value;
  if (header === undefined) return null;
  const match = header.match(/^Bearer ([A-Za-z0-9_-]+)$/);
  return match?.[1] ?? null;
}

interface HostedOAuthResources {
  storage: HostedOAuthStorage<StoredOAuthCredential>;
  close(): Promise<void>;
}

function requiredHostedSecret(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim() ?? "";
  if (value.length === 0) {
    throw new Error(`${name} is required with SKYLIGHT_OAUTH_DB_PATH.`);
  }
  return value;
}

async function createHostedOAuthResources(
  env: NodeJS.ProcessEnv
): Promise<HostedOAuthResources> {
  const databasePath = env.SKYLIGHT_OAUTH_DB_PATH?.trim() ?? "";
  if (databasePath.length === 0) {
    if ((env.SKYLIGHT_OAUTH_MASTER_KEY?.trim() ?? "").length > 0) {
      throw new Error(
        "SKYLIGHT_OAUTH_DB_PATH is required with SKYLIGHT_OAUTH_MASTER_KEY."
      );
    }
    return {
      storage: createInMemoryHostedOAuthStorage<StoredOAuthCredential>({
        development: true,
      }),
      async close() {},
    };
  }

  const { SQLiteSkylightOAuthStore } = await import(
    "./skylight/oauth-sqlite-store.js"
  );
  const keyMaterial = deriveOAuthKeyMaterial(
    requiredHostedSecret(env, "SKYLIGHT_OAUTH_MASTER_KEY")
  );
  const storage = new SQLiteSkylightOAuthStore({
    databasePath,
    ...keyMaterial,
  });
  return {
    storage,
    async close() {
      storage.close();
    },
  };
}

async function main(): Promise<void> {
  const config = parseArguments(process.argv.slice(2), process.env);
  const token = config.insecureNoAuth || config.embeddedOAuth
    ? null
    : httpMcpTokenFromEnvironment();
  let resolvedPort = config.port;
  const canonicalUrl = (): URL =>
    config.publicUrl ?? new URL(`http://${config.hostname.includes(":") ? `[${config.hostname}]` : config.hostname}:${resolvedPort}${config.path}`);
  const configuredHosts = new Set([
    ...LOOPBACK_HOSTS,
    config.hostname.toLowerCase(),
    ...(config.publicUrl === null ? [] : [config.publicUrl.hostname.toLowerCase()]),
    ...config.allowedHosts,
  ]);
  const transportOptions = {
    name: "skylight-calendar-agent",
    version: packageVersion,
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    allowedHosts: [...configuredHosts],
    allowedOrigins: [...config.allowedOrigins],
    maxRequestBytes: config.maxRequestBytes,
    maxBatchSize: config.maxBatchSize,
    maxSessions: config.maxSessions,
    sessionTtlMs: config.sessionTtlMs,
    maxStreamsPerSession: config.maxStreamsPerSession,
    maxStreamBufferBytes: config.maxStreamBufferBytes,
    maxSseEventHistory: config.maxSseEventHistory,
    sseKeepAliveMs: config.sseKeepAliveMs,
    maxConcurrentToolCalls: config.maxConcurrentToolCalls,
    trustedProxy: config.trustedProxy,
  } as const;

  if (config.embeddedOAuth) {
    const resources = await createHostedOAuthResources(process.env);
    try {
      const mcp = await createHTTPMCPServer(root, {
        ...transportOptions,
        oauth: hostedOAuth({
          publicUrl: canonicalUrl().toString(),
          storage: resources.storage,
          provider: createSkylightOAuthProvider(),
          advanced: { branding: { title: "Skylight Calendar" } },
        }),
      });
      const handle = await mcp.listenHttp({
        hostname: config.hostname,
        port: config.port,
        requestTimeoutMs: 30_000,
        headersTimeoutMs: 10_000,
        keepAliveTimeoutMs: 5_000,
      });
      resolvedPort = handle.port;
      process.stdout.write(`${canonicalUrl().toString()}\n`);
      process.stderr.write(
        `Skylight OAuth login is available through ${new URL("/authorize", canonicalUrl()).toString()}.\n`
      );

      let closing = false;
      const shutdown = async () => {
        try {
          await handle.close();
        } finally {
          await resources.close();
        }
      };
      const onSignal = () => {
        if (closing) {
          handle.closeAllConnections();
          process.exit(1);
        }
        closing = true;
        const deadline = setTimeout(() => {
          handle.closeAllConnections();
          process.exit(1);
        }, SHUTDOWN_GRACE_MS);
        deadline.unref();
        void shutdown().then(
          () => {
            clearTimeout(deadline);
            process.exit(0);
          },
          () => {
            clearTimeout(deadline);
            process.exit(1);
          }
        );
      };
      process.on("SIGINT", onSignal);
      process.on("SIGTERM", onSignal);
      return;
    } catch (error) {
      await resources.close();
      throw error;
    }
  }

  const mcp = await createHTTPMCPServer(root, {
    ...transportOptions,
    services: createLocalSkylightServices(),
  });
  const authFailures = new Map<string, { count: number; resetAt: number }>();

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", canonicalUrl());
      if (url.pathname === "/healthz") {
        if (req.method !== "GET") return json(res, 405, { error: "method_not_allowed" }, { allow: "GET" });
        return json(res, 200, { ok: true, name: "skylight-calendar-agent", version: packageVersion });
      }
      const host = normalizedHostname(requestHost(req));
      if (!configuredHosts.has(host)) return json(res, 421, { error: "misdirected_request" });
      if (url.pathname === "/icon.svg") {
        if (req.method !== "GET" && req.method !== "HEAD") {
          return json(res, 405, { error: "method_not_allowed" }, { allow: "GET, HEAD" });
        }
        if (req.method === "HEAD") {
          res.writeHead(200, {
            "content-type": "image/svg+xml; charset=utf-8",
            "cache-control": "public, max-age=86400",
          });
          return res.end();
        }
        return svg(res, skylightCalendarIconSvg);
      }
      if (url.pathname !== config.path) return json(res, 404, { error: "not_found" });

      if (token !== null && req.method !== "OPTIONS") {
        const ip = req.socket.remoteAddress ?? "unknown";
        const now = Date.now();
        const failure = authFailures.get(ip);
        if (failure !== undefined && failure.resetAt > now && failure.count >= 20) {
          return json(res, 429, { error: "too_many_auth_failures" }, {
            "retry-after": String(Math.ceil((failure.resetAt - now) / 1_000)),
          });
        }
        const supplied = bearer(req);
        if (supplied === null || !tokenMatches(supplied, token)) {
          const current = failure === undefined || failure.resetAt <= now
            ? { count: 1, resetAt: now + 60_000 }
            : { count: failure.count + 1, resetAt: failure.resetAt };
          authFailures.set(ip, current);
          return json(res, 401, { error: "invalid_token" }, {
            "www-authenticate": "Bearer realm=\"skylight-mcp\"",
          });
        }
        authFailures.delete(ip);
      }

      await mcp.handleRequest(req, res);
    } catch (error) {
      if (!res.headersSent) json(res, 500, { error: "internal_error" });
      else if (!res.writableEnded) res.end();
      process.stderr.write(`HTTP MCP request failed: ${terminalSafeText(error instanceof Error ? error.message : "Unknown error")}\n`);
    }
  });

  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 100;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.hostname, resolve);
  });
  resolvedPort = (server.address() as AddressInfo).port;
  process.stdout.write(`${canonicalUrl().toString()}\n`);

  let closing = false;
  const shutdown = async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeIdleConnections();
    });
  };
  const onSignal = () => {
    if (closing) {
      server.closeAllConnections();
      process.exit(1);
    }
    closing = true;
    const deadline = setTimeout(() => {
      server.closeAllConnections();
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    deadline.unref();
    void shutdown().then(
      () => {
        clearTimeout(deadline);
        process.exit(0);
      },
      () => {
        clearTimeout(deadline);
        process.exit(1);
      }
    );
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
}

main().catch((error) => {
  process.stderr.write(`${terminalSafeText(error instanceof Error ? error.message : "HTTP MCP startup failed.")}\n`);
  process.exitCode = 1;
});
