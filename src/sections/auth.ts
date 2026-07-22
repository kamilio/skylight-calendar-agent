import { S, UserError } from "toolcraft";
import {
  defineSkylightCommand as defineCommand,
  defineSkylightGroup as defineGroup,
} from "../skylight/service.js";
import { getAuthorizationStatus, loginWithPassword } from "../skylight/auth.js";
import { systemAuthorizationStore } from "../skylight/credential-store.js";
import {
  completeBrowserOAuthLogin,
  createBrowserOAuthLogin,
  serializeOAuthCredential,
} from "../skylight/oauth.js";
import {
  getOrCreateStoredHttpMcpToken,
  rotateStoredHttpMcpToken,
} from "../skylight/http-auth.js";
import { promptLine } from "../skylight/prompt.js";
import { assertBoundedString, boundedStringParam, emailParam } from "../skylight/validation.js";

async function readPasswordFromStdin(): Promise<string> {
  let password = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    password += chunk;
    if (password.length > 8_193) break;
  }
  return password.replace(/\r?\n$/, "");
}

export const authGroup = defineGroup({
  name: "auth",
  description: "Local authentication and secure credential storage",
  children: [
    defineCommand({
      name: "login",
      description: "Print the Skylight OAuth URL for browser sign-in",
      scope: ["cli"],
      params: S.Object({}),
      handler: async () => {
        const login = createBrowserOAuthLogin();
        process.stdout.write(`${login.loginUrl}\n`);
        return {
          next: "After sign-in, copy the final browser URL and run `skylight auth complete --callback-url URL`.",
        };
      },
    }),
    defineCommand({
      name: "complete",
      description: "Complete browser OAuth login from the final Skylight URL",
      scope: ["cli"],
      params: S.Object({
        callbackUrl: boundedStringParam({
          description: "Complete https://ourskylight.com/welcome URL shown after sign-in",
        }),
      }),
      handler: async (ctx) => {
        const store = systemAuthorizationStore();
        if (store === null) {
          throw new UserError("Local credential storage is unavailable on this platform.");
        }
        const credential = await completeBrowserOAuthLogin({
          fetch: ctx.fetch,
          callbackUrl: ctx.params.callbackUrl,
        });
        await store.write(serializeOAuthCredential(credential));
        return {
          authenticated: true,
          storage: store.name,
          apiBaseUrl: (await getAuthorizationStatus({ store })).apiBaseUrl,
        };
      },
    }),
    defineCommand({
      name: "login-password",
      description: "Log in by reading the Skylight password in this terminal",
      scope: ["cli"],
      params: S.Object({
        email: S.Optional(emailParam({ description: "Skylight account email", short: "e" })),
        passwordStdin: S.Optional(
          S.Boolean({ description: "Read the password from standard input instead of prompting" })
        ),
      }),
      handler: async (ctx) => {
        const store = systemAuthorizationStore();
        if (store === null) throw new UserError("Local credential storage is unavailable on this platform.");
        const email =
          ctx.params.email ??
          process.env.SKYLIGHT_EMAIL ??
          (await promptLine("Email: "));
        const password =
          ctx.params.passwordStdin === true
            ? await readPasswordFromStdin()
            : process.env.SKYLIGHT_PASSWORD ?? (await promptLine("Password: ", true));
        assertBoundedString(password, "Password");
        const credential = await loginWithPassword({
          fetch: ctx.fetch,
          email,
          password,
        });
        await store.write(serializeOAuthCredential(credential));
        return {
          authenticated: true,
          storage: store.name,
          apiBaseUrl: (await getAuthorizationStatus({ store })).apiBaseUrl,
        };
      },
    }),
    defineCommand({
      name: "status",
      description: "Show the active authentication source without revealing credentials",
      scope: ["cli", "sdk"],
      params: S.Object({}),
      handler: async () => getAuthorizationStatus(),
    }),
    defineCommand({
      name: "http-token",
      description: "Print or rotate the local HTTP MCP bearer token",
      scope: ["cli"],
      params: S.Object({
        rotate: S.Optional(S.Boolean({ description: "Rotate the token before printing it" })),
      }),
      handler: async (ctx) => ({
        token:
          ctx.params.rotate === true
            ? await rotateStoredHttpMcpToken()
            : await getOrCreateStoredHttpMcpToken(),
      }),
    }),
    defineCommand({
      name: "logout",
      description: "Remove the locally stored OAuth credential",
      scope: ["cli", "sdk"],
      params: S.Object({}),
      handler: async () => {
        const store = systemAuthorizationStore();
        if (store === null) {
          throw new UserError("Secure local credential storage is unavailable on this platform.");
        }
        const removed = await store.delete();
        return {
          removed,
          storage: store.name,
        };
      },
    }),
  ],
});
