#!/usr/bin/env node
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import {
  createHTTPMCPServer,
  createJwksTokenVerifier,
  type TinyHttpMcpServerOAuthOptions,
} from "toolcraft/http";
import { loadDotEnv } from "./env.js";
import { root } from "./root.js";
import {
  httpMcpTokenFromEnvironment,
  tokenMatches,
} from "./skylight/http-auth.js";
import { createSkylightOAuthApp } from "./skylight/oauth-app.js";
import { terminalSafeText } from "./skylight/text.js";
import { packageVersion } from "./version.js";

loadDotEnv();

interface OAuthConfig {
  authorizationServers: URL[];
  jwksUrl: URL;
  scopes: string[];
}

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
  oauth: OAuthConfig | null;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

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

function httpsUrl(value: string, label: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error(`${label} must be an HTTPS URL without credentials, query, or fragment.`);
  }
  return url;
}

function parseOAuth(env: NodeJS.ProcessEnv): OAuthConfig | null {
  const authorizationServerValues = csv(env.SKYLIGHT_MCP_OAUTH_AUTHORIZATION_SERVERS);
  const jwksValue = env.SKYLIGHT_MCP_OAUTH_JWKS_URL?.trim() ?? "";
  if (authorizationServerValues.length === 0 && jwksValue.length === 0) return null;
  if (authorizationServerValues.length === 0 || jwksValue.length === 0) {
    throw new Error("OAuth requires both SKYLIGHT_MCP_OAUTH_AUTHORIZATION_SERVERS and SKYLIGHT_MCP_OAUTH_JWKS_URL.");
  }
  return {
    authorizationServers: authorizationServerValues.map((value) => httpsUrl(value, "OAuth authorization server")),
    jwksUrl: httpsUrl(jwksValue, "OAuth JWKS URL"),
    scopes: csv(env.SKYLIGHT_MCP_OAUTH_SCOPES).length > 0 ? csv(env.SKYLIGHT_MCP_OAUTH_SCOPES) : ["mcp"],
  };
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
      process.stdout.write(`skylight-calendar-mcp-http [options]\n\nOptions:\n  --hostname <host>       Bind host (default 127.0.0.1)\n  --port <port>           Bind port (default 8787; 0 for explicit-token mode)\n  --path <path>           MCP path (default /mcp)\n  --public-url <url>      Canonical externally reachable MCP URL\n  --insecure-no-auth      Disable auth (loopback only)\n\nBrowser OAuth login is enabled automatically unless an explicit HTTP token or external OAuth server is configured.\n`);
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
  const oauth = parseOAuth(env);
  const embeddedOAuth = embeddedOAuthRequested ||
    (!insecureNoAuth && oauth === null && (env.SKYLIGHT_MCP_HTTP_TOKEN?.trim() ?? "").length === 0);
  if (embeddedOAuthRequested && oauth !== null) {
    throw new Error("Embedded OAuth login and an external OAuth authorization server cannot be enabled together.");
  }
  if (embeddedOAuth && publicUrl === null && port === 0) {
    throw new Error("Automatic OAuth login requires a fixed port when no public URL is configured.");
  }
  if (embeddedOAuth && publicUrl !== null && publicUrl.protocol !== "https:" && !LOOPBACK_HOSTS.has(publicUrl.hostname)) {
    throw new Error("Embedded OAuth login requires an HTTPS public URL unless the URL is loopback.");
  }
  if (oauth !== null && publicUrl?.protocol !== "https:") {
    throw new Error("OAuth requires an HTTPS SKYLIGHT_MCP_HTTP_PUBLIC_URL.");
  }
  if ((oauth !== null || embeddedOAuth) && insecureNoAuth) {
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
    oauth,
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

function protectedResourcePaths(path: string): string[] {
  return path === "/"
    ? ["/.well-known/oauth-protected-resource"]
    : [`/.well-known/oauth-protected-resource${path}`];
}

function protectedResourceDocument(publicUrl: URL, oauth: OAuthConfig): Record<string, unknown> {
  return {
    resource: publicUrl.toString(),
    authorization_servers: oauth.authorizationServers.map((url) => url.toString()),
    bearer_methods_supported: ["header"],
    scopes_supported: oauth.scopes,
  };
}

async function main(): Promise<void> {
  const config = parseArguments(process.argv.slice(2), process.env);
  const token = config.insecureNoAuth || config.oauth !== null || config.embeddedOAuth
    ? null
    : httpMcpTokenFromEnvironment();
  let resolvedPort = config.port;
  const canonicalUrl = (): URL =>
    config.publicUrl ?? new URL(`http://${config.hostname.includes(":") ? `[${config.hostname}]` : config.hostname}:${resolvedPort}${config.path}`);
  const embeddedOAuth = config.embeddedOAuth
    ? createSkylightOAuthApp({
        publicUrl: config.publicUrl ?? canonicalUrl(),
        onAuthorizationUrl(url) {
          process.stderr.write(`Open Skylight login: ${url.toString()}\n`);
        },
      })
    : null;
  const oauthOptions: TinyHttpMcpServerOAuthOptions | undefined = embeddedOAuth?.mcpAuthorization ?? (config.oauth === null
    ? undefined
    : {
      resource: config.publicUrl as URL,
      authorizationServers: config.oauth.authorizationServers,
      bearerMethodsSupported: ["header"],
      scopesSupported: config.oauth.scopes,
      requiredScopes: config.oauth.scopes,
      verifier: createJwksTokenVerifier({
        jwksUrl: config.oauth.jwksUrl,
        requireAccessTokenType: true,
      }),
    });
  const configuredHosts = new Set([
    ...LOOPBACK_HOSTS,
    config.hostname.toLowerCase(),
    ...(config.publicUrl === null ? [] : [config.publicUrl.hostname.toLowerCase()]),
    ...config.allowedHosts,
  ]);
  const mcp = await createHTTPMCPServer(root, {
    name: "skylight-calendar-agent",
    version: packageVersion,
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
    ...(oauthOptions === undefined ? {} : { oauth: oauthOptions }),
  });
  const authFailures = new Map<string, { count: number; resetAt: number }>();

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", canonicalUrl());
      const host = normalizedHostname(requestHost(req));
      if (!configuredHosts.has(host)) return json(res, 421, { error: "misdirected_request" });
      if (url.pathname === "/healthz") {
        if (req.method !== "GET") return json(res, 405, { error: "method_not_allowed" }, { allow: "GET" });
        return json(res, 200, { ok: true, name: "skylight-calendar-agent", version: packageVersion });
      }
      if (config.oauth !== null && protectedResourcePaths(config.path).includes(url.pathname)) {
        if (req.method !== "GET") return json(res, 405, { error: "method_not_allowed" }, { allow: "GET" });
        return json(res, 200, protectedResourceDocument(config.publicUrl as URL, config.oauth), {
          "cache-control": "public, max-age=300",
        });
      }
      if (embeddedOAuth !== null && protectedResourcePaths(config.path).includes(url.pathname)) {
        if (req.method !== "GET") return json(res, 405, { error: "method_not_allowed" }, { allow: "GET" });
        return json(res, 200, {
          resource: canonicalUrl().toString(),
          authorization_servers: embeddedOAuth.mcpAuthorization.authorizationServers,
          bearer_methods_supported: embeddedOAuth.mcpAuthorization.bearerMethodsSupported,
          scopes_supported: embeddedOAuth.mcpAuthorization.scopesSupported,
        }, { "cache-control": "public, max-age=300" });
      }
      if (embeddedOAuth !== null && url.pathname !== config.path && embeddedOAuth.handles(url.pathname)) {
        await embeddedOAuth.handle(req, res);
        return;
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
  if (embeddedOAuth !== null) {
    process.stderr.write(`Skylight login page: ${new URL("/", canonicalUrl()).toString()}\n`);
  }

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
    void shutdown().then(() => process.exit(0), () => process.exit(1));
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
}

main().catch((error) => {
  process.stderr.write(`${terminalSafeText(error instanceof Error ? error.message : "HTTP MCP startup failed.")}\n`);
  process.exitCode = 1;
});
