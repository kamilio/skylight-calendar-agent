import {
  HostedOAuthLoginError,
  type HostedOAuthProvider,
} from "toolcraft/http/hosted-oauth";
import { loginWithPassword } from "./auth.js";
import { getSkylightRequestConfig } from "./config.js";
import {
  createHostedSkylightServices,
  type SkylightServices,
} from "./service.js";
import type { StoredOAuthCredential } from "./oauth.js";

export interface CreateSkylightOAuthProviderOptions {
  fetch?: typeof globalThis.fetch;
  env?: NodeJS.ProcessEnv;
  accountEnv?: NodeJS.ProcessEnv;
}

function isSkylightLoginTimeout(error: unknown): boolean {
  return (
    error instanceof Error &&
    /^Skylight login timed out after \d+ms\.$/.test(error.message)
  );
}

export function createSkylightOAuthProvider(
  options: CreateSkylightOAuthProviderOptions = {}
): HostedOAuthProvider<StoredOAuthCredential, SkylightServices> {
  const fetch = options.fetch ?? globalThis.fetch;
  const env = options.env ?? process.env;

  return {
    // This value is part of durable subject derivation. Display branding may
    // change independently, but the protocol name must remain stable.
    name: "Skylight",
    login: { fields: ["email", "password"] },
    async connect({ email, password, signal }) {
      let credential: StoredOAuthCredential;
      try {
        credential = await loginWithPassword({
          fetch,
          env,
          email: email ?? "",
          password: password ?? "",
          signal,
        });
      } catch (error) {
        throw new HostedOAuthLoginError(
          signal.aborted
            ? "Skylight sign-in was canceled. Start the connection again."
            : isSkylightLoginTimeout(error)
              ? "Skylight took too long to respond. Check your connection and try again."
              : "Skylight sign-in failed. Check your email and password, then try again."
        );
      }

      try {
        signal.throwIfAborted();
        return {
          accountId: await skylightAccountId({ fetch, env, credential, signal }),
          credential,
        };
      } catch {
        throw new HostedOAuthLoginError(
          signal.aborted
            ? "Skylight sign-in was canceled. Start the connection again."
            : "Skylight sign-in succeeded, but the account could not be identified. Try again later."
        );
      }
    },
    services({ credentials, identity }) {
      return createHostedSkylightServices({
        credentials,
        identity,
        infrastructureEnv: env,
        ...(options.accountEnv === undefined
          ? {}
          : { accountEnv: options.accountEnv }),
      });
    },
  };
}

async function skylightAccountId(options: {
  fetch: typeof globalThis.fetch;
  env: NodeJS.ProcessEnv;
  credential: StoredOAuthCredential;
  signal: AbortSignal;
}): Promise<string> {
  const config = getSkylightRequestConfig(options.env);
  const response = await options.fetch(`${config.apiBaseUrl}/api/user`, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${options.credential.accessToken}`,
      "skylight-api-version": config.apiVersion,
    },
    signal: AbortSignal.any([
      options.signal,
      AbortSignal.timeout(config.requestTimeoutMs),
    ]),
  });
  if (!response.ok) {
    throw new Error(`Skylight account lookup failed (${response.status}).`);
  }
  const payload = (await response.json()) as { data?: { id?: unknown } };
  const rawId = payload.data?.id;
  const accountId =
    typeof rawId === "string"
      ? rawId.trim()
      : typeof rawId === "number" && Number.isSafeInteger(rawId)
        ? String(rawId)
        : "";
  if (accountId.length === 0 || accountId.length > 200) {
    throw new Error(
      "Skylight account identity response did not contain a valid user id."
    );
  }
  return accountId;
}
