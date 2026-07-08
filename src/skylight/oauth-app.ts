import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
} from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  createAuthorizationInteractionSecurity,
  createHTTPMCPAuthorization,
  createInMemoryAuthorizationServerStore,
  createOAuthAuthorizationServer,
  verifyAuthorizationInteractionCsrf,
  type OAuthAuthorizationServer,
  type TinyHttpMcpServerOAuthOptions,
} from "toolcraft/http";
import { loginWithPassword, setRuntimeAuthorizationStore } from "./auth.js";
import type { AuthorizationStore } from "./credential-store.js";
import { serializeOAuthCredential } from "./oauth.js";
import { terminalSafeText } from "./text.js";

const FORM_MAX_BYTES = 64 * 1024;
const AUTHORIZATION_PATHS = new Set([
  "/.well-known/oauth-authorization-server",
  "/.well-known/jwks.json",
  "/register",
  "/authorize",
  "/token",
  "/revoke",
]);

class MemoryAuthorizationStore implements AuthorizationStore {
  readonly name = "embedded OAuth session memory";
  #authorization: string | null = null;

  async read(): Promise<string | null> {
    return this.#authorization;
  }

  async write(authorization: string): Promise<void> {
    this.#authorization = authorization;
  }

  async delete(): Promise<boolean> {
    const existed = this.#authorization !== null;
    this.#authorization = null;
    return existed;
  }
}

export interface SkylightOAuthApp {
  authorizationServer: OAuthAuthorizationServer;
  mcpAuthorization: TinyHttpMcpServerOAuthOptions;
  handles(pathname: string): boolean;
  handle(request: IncomingMessage, response: ServerResponse): Promise<void>;
}

export function createSkylightOAuthApp(options: {
  publicUrl: URL;
  fetch?: typeof globalThis.fetch;
  env?: NodeJS.ProcessEnv;
  onAuthorizationUrl?: (url: URL) => void;
}): SkylightOAuthApp {
  const publicUrl = new URL(options.publicUrl);
  const issuer = publicUrl.origin;
  const resource = publicUrl.toString();
  const fetch = options.fetch ?? globalThis.fetch;
  const env = options.env ?? process.env;
  const credentialStore = new MemoryAuthorizationStore();
  const interactions = new Map<string, { scopes: readonly string[]; expiresAt: number }>();
  let accountSubject: string | null = null;

  setRuntimeAuthorizationStore(credentialStore);

  const authorizationServer = createOAuthAuthorizationServer({
    issuer,
    resources: [resource],
    signingKey: createSigningKey(generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey),
    store: createInMemoryAuthorizationServerStore(),
    interaction: {
      start(context) {
        options.onAuthorizationUrl?.(new URL(context.request.url));
        pruneInteractions(interactions);
        interactions.set(context.transaction.id, {
          scopes: context.transaction.scopes,
          expiresAt: context.transaction.expiresAt,
        });
        const security = createAuthorizationInteractionSecurity();
        return htmlResponse(
          renderAuthorizationPage({
            csrfToken: security.csrfToken,
            transactionId: context.transaction.id,
            scopes: context.transaction.scopes,
          }),
          200,
          { "set-cookie": security.setCookie }
        );
      },
    },
    accessTokenTtlSeconds: 300,
    authorizationCodeTtlSeconds: 300,
    authorizationTransactionTtlSeconds: 600,
    refreshTokenTtlSeconds: 30 * 24 * 60 * 60,
    maxRequestBodyBytes: FORM_MAX_BYTES,
  });
  const mcpAuthorization = createHTTPMCPAuthorization({
    authorizationServer,
    resource,
    requiredScopes: ["mcp"],
    scopesSupported: ["mcp", "offline_access"],
  });

  return {
    authorizationServer,
    mcpAuthorization,
    handles(pathname) {
      return AUTHORIZATION_PATHS.has(pathname) || pathname === "/interaction/login" || pathname === "/";
    },
    async handle(request, response) {
      try {
        const pathname = new URL(request.url ?? "/", issuer).pathname;
        if (AUTHORIZATION_PATHS.has(pathname)) {
          await sendFetchResponse(response, await authorizationServer.handle(await toFetchRequest(request, issuer)));
          return;
        }
        if (pathname === "/interaction/login" && request.method === "POST") {
          const form = await readForm(request);
          const transactionId = requiredFormValue(form, "transaction_id");
          validateInteractionRequest(request, issuer, requiredFormValue(form, "csrf"));
          const interaction = interactions.get(transactionId);
          if (interaction === undefined || interaction.expiresAt <= Date.now()) {
            await sendFetchResponse(response, htmlResponse(renderErrorPage(), 400));
            return;
          }
          const email = requiredFormValue(form, "email");
          const subject = oauthSubject(email);
          if (accountSubject !== null && accountSubject !== subject) {
            await restartAuthorization(response, interactions, transactionId, interaction.scopes,
              "This server is already connected to a different Skylight account. Restart it to switch accounts.");
            return;
          }
          try {
            const credential = await loginWithPassword({
              fetch,
              env,
              email,
              password: requiredFormValue(form, "password", false),
            });
            if (accountSubject !== null && accountSubject !== subject) {
              throw new Error("A different Skylight account completed sign-in first.");
            }
            accountSubject = subject;
            await credentialStore.write(serializeOAuthCredential(credential));
            const result = await authorizationServer.completeAuthorization({ transactionId, subject });
            interactions.delete(transactionId);
            await sendFetchResponse(response, htmlResponse(renderCompletionPage(result.redirectUrl.href)));
          } catch (error) {
            process.stderr.write(`Skylight OAuth login failed: ${terminalSafeText(error instanceof Error ? error.message : "Unknown error")}\n`);
            await restartAuthorization(response, interactions, transactionId, interaction.scopes,
              "Skylight sign-in failed. Check your email and password, then try again.");
          }
          return;
        }
        if (pathname === "/" && request.method === "GET") {
          await sendFetchResponse(response, htmlResponse(renderLandingPage(resource)));
          return;
        }
        await sendFetchResponse(response, new Response(JSON.stringify({ error: "not_found" }), {
          status: 404,
          headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
        }));
      } catch (error) {
        process.stderr.write(`Skylight OAuth request failed: ${terminalSafeText(error instanceof Error ? error.message : "Unknown error")}\n`);
        if (!response.headersSent) await sendFetchResponse(response, htmlResponse(renderErrorPage(), 400));
        else if (!response.writableEnded) response.end();
      }
    },
  };
}

function createSigningKey(privateKey: KeyObject): Parameters<typeof createOAuthAuthorizationServer>[0]["signingKey"] {
  const publicKey = createPublicKey(privateKey);
  const publicJwk = publicKey.export({ format: "jwk" });
  const keyId = createHash("sha256")
    .update(publicKey.export({ format: "der", type: "spki" }))
    .digest("base64url")
    .slice(0, 22);
  return { algorithm: "ES256", keyId, privateKey, publicJwk };
}

function oauthSubject(email: string): string {
  return createHash("sha256")
    .update("skylight-calendar-agent-oauth-subject\0")
    .update(email.trim().toLowerCase())
    .digest("base64url");
}

function pruneInteractions(interactions: Map<string, { expiresAt: number }>): void {
  const now = Date.now();
  for (const [id, interaction] of interactions) {
    if (interaction.expiresAt <= now) interactions.delete(id);
  }
}

async function restartAuthorization(
  response: ServerResponse,
  interactions: Map<string, { scopes: readonly string[]; expiresAt: number }>,
  transactionId: string,
  scopes: readonly string[],
  errorMessage: string
): Promise<void> {
  const interaction = interactions.get(transactionId);
  if (interaction === undefined || interaction.expiresAt <= Date.now()) {
    await sendFetchResponse(response, htmlResponse(renderErrorPage(), 400));
    return;
  }
  const security = createAuthorizationInteractionSecurity();
  await sendFetchResponse(response, htmlResponse(renderAuthorizationPage({
    csrfToken: security.csrfToken,
    transactionId,
    scopes,
    errorMessage,
  }), 200, { "set-cookie": security.setCookie }));
}

function validateInteractionRequest(request: IncomingMessage, issuer: string, csrfToken: string): void {
  if (!verifyAuthorizationInteractionCsrf({
    cookieHeader: request.headers.cookie ?? null,
    submittedToken: csrfToken,
  })) {
    throw new Error("Authorization form CSRF validation failed.");
  }
  const origin = request.headers.origin;
  const referer = request.headers.referer;
  const sameOrigin = origin === issuer || ((!origin || origin === "null") &&
    (request.headers["sec-fetch-site"] === "same-origin" || referer?.startsWith(`${issuer}/`)));
  if (!sameOrigin) throw new Error("Authorization form origin is invalid.");
}

async function readForm(request: IncomingMessage): Promise<URLSearchParams> {
  if (request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() !== "application/x-www-form-urlencoded") {
    throw new Error("Authorization form encoding is invalid.");
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > FORM_MAX_BYTES) throw new Error("Authorization form is too large.");
    chunks.push(buffer);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

function requiredFormValue(form: URLSearchParams, name: string, trim = true): string {
  const raw = form.get(name);
  const value = trim ? raw?.trim() : raw;
  if (!value) throw new Error(`Authorization form is missing ${name}.`);
  return value;
}

async function toFetchRequest(request: IncomingMessage, issuer: string): Promise<Request> {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    else if (value !== undefined) headers.set(name, value);
  }
  const method = request.method ?? "GET";
  const body = method === "GET" || method === "HEAD" ? undefined : Buffer.from(await requestToArrayBuffer(request));
  return new Request(new URL(request.url ?? "/", issuer), {
    method,
    headers,
    ...(body === undefined ? {} : { body }),
  });
}

async function requestToArrayBuffer(request: IncomingMessage): Promise<ArrayBuffer> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > FORM_MAX_BYTES) throw new Error("OAuth request is too large.");
    chunks.push(buffer);
  }
  const body = Buffer.concat(chunks);
  return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
}

async function sendFetchResponse(response: ServerResponse, fetchResponse: Response): Promise<void> {
  response.statusCode = fetchResponse.status;
  fetchResponse.headers.forEach((value, name) => {
    if (name !== "set-cookie") response.setHeader(name, value);
  });
  const cookies = fetchResponse.headers.getSetCookie();
  if (cookies.length > 0) response.setHeader("set-cookie", cookies);
  response.end(Buffer.from(await fetchResponse.arrayBuffer()));
}

function htmlResponse(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      pragma: "no-cache",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      ...headers,
    },
  });
}

function renderAuthorizationPage(input: {
  csrfToken: string;
  transactionId: string;
  scopes: readonly string[];
  errorMessage?: string;
}): string {
  const error = input.errorMessage ? `<p class="error" role="alert">${escapeHtml(input.errorMessage)}</p>` : "";
  return page("Connect Skylight Calendar", `<main>
    <div class="brand">SKYLIGHT CALENDAR</div>
    <h1>Connect your calendar</h1>
    <p class="intro">Sign in with the same email and password you use for Skylight. Your password is sent directly to Skylight and is never stored by this server.</p>
    <section>
      ${error}
      <form method="post" action="/interaction/login">
        <input type="hidden" name="csrf" value="${escapeHtml(input.csrfToken)}">
        <input type="hidden" name="transaction_id" value="${escapeHtml(input.transactionId)}">
        <label for="email">Email</label>
        <input id="email" name="email" type="email" required autocomplete="username" autofocus>
        <label for="password">Password</label>
        <input id="password" name="password" type="password" required autocomplete="current-password">
        <button type="submit">Connect Skylight</button>
      </form>
      <p class="scope">Requested access: ${escapeHtml(input.scopes.join(", "))}</p>
    </section>
    <p class="fine">This personal MCP server supports one Skylight account at a time.</p>
  </main>`);
}

function renderCompletionPage(redirectUrl: string): string {
  const escapedUrl = escapeHtml(redirectUrl);
  return page("Skylight connected", `<main>
    <div class="success">✓</div>
    <h1>Skylight connected</h1>
    <p class="intro">Authentication succeeded. Returning to your MCP client in two seconds.</p>
    <a class="button" href="${escapedUrl}">Return to MCP client</a>
  </main>`, `<meta http-equiv="refresh" content="2;url=${escapedUrl}">`);
}

function renderLandingPage(resource: string): string {
  return page("Skylight Calendar MCP", `<main><div class="brand">SKYLIGHT CALENDAR</div><h1>Skylight Calendar MCP</h1><p class="intro">Connect an MCP client to <code>${escapeHtml(resource)}</code>. The client will open this browser to sign in securely.</p></main>`);
}

function renderErrorPage(): string {
  return page("Authorization failed", `<main><h1>Authorization failed</h1><p class="intro">This authorization attempt expired or was invalid. Restart the MCP connection to try again.</p></main>`);
}

function page(title: string, body: string, extraHead = ""): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${extraHead}<title>${escapeHtml(title)}</title><style>
    :root{color-scheme:light;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:linear-gradient(145deg,#fffaf2,#f5eadc);color:#30271f}main{max-width:28rem;margin:0 auto;padding:4.5rem 1.25rem}.brand{font-size:.72rem;font-weight:800;letter-spacing:.18em;color:#a85e30}h1{font-size:2rem;line-height:1.1;margin:.75rem 0}.intro{line-height:1.6;color:#66584d}section{background:#fff;border:1px solid #e6d7c6;border-radius:1.15rem;padding:1.4rem;margin:1.5rem 0;box-shadow:0 1rem 3rem #6f452018}form{display:grid;gap:.65rem}label{font-size:.88rem;font-weight:700}input,button,.button{font:inherit;border-radius:.7rem}input{width:100%;border:1px solid #cdbba9;padding:.82rem;background:#fff;color:#30271f}input:focus{outline:3px solid #e9b98e66;border-color:#b96d3b}button,.button{display:inline-block;border:0;padding:.85rem 1rem;background:#b86635;color:#fff;text-decoration:none;text-align:center;font-weight:800;cursor:pointer;margin-top:.35rem}.scope,.fine{font-size:.78rem;color:#847466;line-height:1.45}.error{padding:.8rem;border-radius:.65rem;background:#fff0ed;color:#952f20;font-weight:700;line-height:1.4}.success{display:grid;place-items:center;width:3.5rem;height:3.5rem;border-radius:50%;background:#dcefdc;color:#26712a;font-size:2rem;font-weight:900}code{overflow-wrap:anywhere;background:#fff;padding:.15rem .3rem;border-radius:.3rem}@media(prefers-color-scheme:dark){:root{color-scheme:dark}body{background:linear-gradient(145deg,#201a16,#2a211b);color:#f5eee7}.intro,.scope,.fine{color:#c4b4a6}section{background:#30261f;border-color:#554334}input{background:#211a16;color:#f5eee7;border-color:#6e5747}code{background:#30261f}}
  </style></head><body>${body}</body></html>`;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
