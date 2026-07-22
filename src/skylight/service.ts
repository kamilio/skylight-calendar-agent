import {
  UserError,
  defineCommand,
  defineGroup,
  type Command,
  type CommandConfig,
  type CommandNode,
  type CommandTypeInfo,
  type Group,
  type GroupConfig,
  type GroupTypeInfo,
  type HumanInLoopConfig,
  type ObjectSchema,
  type Scope,
  type SecretDeclarations,
} from "toolcraft";
import type {
  HostedOAuthCredentialAccess,
  HostedOAuthIdentity,
} from "toolcraft/http/hosted-oauth";
import { getSkylightTimezone } from "./config.js";
import {
  createHostedOAuthAuthorizationStore,
  type AuthorizationStore,
} from "./credential-store.js";
import {
  createFrameResolver,
  type FramesListResponse,
} from "./frame.js";
import {
  requestJson,
  type SkylightRequestOptions,
} from "./http.js";
import type { StoredOAuthCredential } from "./oauth.js";

export type SkylightServiceRequestOptions = Omit<
  SkylightRequestOptions,
  "env" | "authorizationStore"
>;

export interface SkylightService {
  request<TResponse>(opts: SkylightServiceRequestOptions): Promise<TResponse>;
  listCalendarFrames(
    ctx: { fetch: typeof globalThis.fetch },
    options?: { forDiscovery?: boolean }
  ): Promise<FramesListResponse>;
  resolveFrameId(ctx: {
    fetch: typeof globalThis.fetch;
    params?: unknown;
  }): Promise<string>;
  timezone(): string;
}

export interface SkylightServices {
  skylight: SkylightService;
}

type SkylightScopeInput = readonly Scope[] | undefined;
type SkylightHumanInLoopMode = "sync" | "async";
type SkylightHumanInLoopModeInput = SkylightHumanInLoopMode | null | undefined;
type SkylightAnyObjectSchema = ObjectSchema<Record<string, never>>;
type ResolveOwnHumanInLoopMode<TValue> = TValue extends {
  mode: infer TMode extends SkylightHumanInLoopMode;
}
  ? TMode
  : TValue extends null
    ? null
    : undefined;

type SkylightCommandMetadata<
  TName extends string,
  TParamsSchema extends ObjectSchema<any>,
  TResult,
  TOwnScope extends SkylightScopeInput,
  TOwnHumanInLoopMode extends SkylightHumanInLoopModeInput,
> = {
  readonly __agentKitCommandTypeInfo: CommandTypeInfo<
    TName,
    TParamsSchema,
    TResult,
    TOwnScope,
    TOwnHumanInLoopMode
  >;
};

type SkylightGroupMetadata<
  TName extends string,
  TChildren extends readonly unknown[],
  TOwnScope extends SkylightScopeInput,
  TOwnHumanInLoopMode extends SkylightHumanInLoopModeInput,
> = {
  readonly __agentKitGroupTypeInfo: GroupTypeInfo<
    SkylightServices,
    TName,
    TChildren,
    TOwnScope,
    TOwnHumanInLoopMode
  >;
};

export function defineSkylightCommand<
  TName extends string,
  TParamsSchema extends ObjectSchema<any>,
  TSecrets extends SecretDeclarations | undefined = undefined,
  TResult = unknown,
  TOwnScope extends SkylightScopeInput = undefined,
  TOwnHumanInLoop extends
    | HumanInLoopConfig<TParamsSchema>
    | null
    | undefined = undefined,
>(
  config: Omit<
    CommandConfig<SkylightServices, TParamsSchema, TSecrets, TResult>,
    "name" | "scope" | "humanInLoop"
  > & {
    name: TName;
    scope?: TOwnScope;
    humanInLoop?: TOwnHumanInLoop;
  }
): Command<SkylightServices, TParamsSchema, TSecrets, TResult> &
  SkylightCommandMetadata<
    TName,
    TParamsSchema,
    TResult,
    TOwnScope,
    ResolveOwnHumanInLoopMode<TOwnHumanInLoop>
  > {
  return defineCommand<
    SkylightServices,
    TName,
    TParamsSchema,
    TSecrets,
    TResult,
    TOwnScope,
    TOwnHumanInLoop
  >(config);
}

export function defineSkylightGroup<
  TName extends string,
  TChildren extends readonly unknown[],
  TOwnScope extends SkylightScopeInput = undefined,
  TOwnHumanInLoop extends
    | HumanInLoopConfig<SkylightAnyObjectSchema>
    | null
    | undefined = undefined,
>(
  config: Omit<
    GroupConfig<SkylightServices>,
    "name" | "children" | "scope" | "humanInLoop"
  > & {
    name: TName;
    children: TChildren & readonly CommandNode<SkylightServices>[];
    scope?: TOwnScope;
    humanInLoop?: TOwnHumanInLoop;
  }
): Group<SkylightServices> &
  SkylightGroupMetadata<
    TName,
    TChildren,
    TOwnScope,
    ResolveOwnHumanInLoopMode<TOwnHumanInLoop>
  > {
  return defineGroup<
    SkylightServices,
    TName,
    TChildren,
    TOwnScope,
    TOwnHumanInLoop
  >(config);
}

export interface CreateSkylightServiceOptions {
  env?: NodeJS.ProcessEnv;
  authorizationStore?: AuthorizationStore | null;
  cacheIdentity?: string;
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function createSkylightService(
  options: CreateSkylightServiceOptions = {}
): SkylightService {
  const hasEnvironment = hasOwn(options, "env");
  const hasAuthorizationStore = hasOwn(options, "authorizationStore");
  const serviceRequest = <TResponse>(opts: SkylightServiceRequestOptions) =>
    requestJson<TResponse>({
      ...opts,
      ...(hasEnvironment ? { env: options.env } : {}),
      ...(hasAuthorizationStore
        ? { authorizationStore: options.authorizationStore }
        : {}),
    });
  const frames = createFrameResolver({
    ...(hasEnvironment ? { env: options.env } : {}),
    requestJson: serviceRequest,
    ...(options.cacheIdentity === undefined
      ? {}
      : { cacheIdentity: options.cacheIdentity }),
  });

  return {
    request: serviceRequest,
    listCalendarFrames: frames.listCalendarFrames,
    resolveFrameId: frames.resolveFrameId,
    timezone() {
      return getSkylightTimezone(options.env ?? process.env);
    },
  };
}

export function createLocalSkylightServices(
  options: CreateSkylightServiceOptions = {}
): SkylightServices {
  return { skylight: createSkylightService(options) };
}

const HOSTED_INFRASTRUCTURE_ENV_KEYS = [
  "SKYLIGHT_API_BASE",
  "SKYLIGHT_API_VERSION",
  "SKYLIGHT_REQUEST_TIMEOUT_MS",
] as const;

export function hostedSkylightEnvironment(
  infrastructure: NodeJS.ProcessEnv = process.env,
  account: NodeJS.ProcessEnv = {}
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of HOSTED_INFRASTRUCTURE_ENV_KEYS) {
    if (infrastructure[key] !== undefined) env[key] = infrastructure[key];
  }
  for (const key of [
    "SKYLIGHT_FRAME_ID",
    "SKYLIGHT_CALENDAR_URL",
    "SKYLIGHT_TIMEZONE",
  ] as const) {
    if (account[key] !== undefined) env[key] = account[key];
  }
  return env;
}

export function createSubjectSkylightService(options: {
  issuer: string;
  subject: string;
  authorizationStore: AuthorizationStore;
  infrastructureEnv?: NodeJS.ProcessEnv;
  accountEnv?: NodeJS.ProcessEnv;
}): SkylightService {
  const issuer = options.issuer.trim();
  const subject = options.subject.trim();
  if (issuer.length === 0 || subject.length === 0) {
    throw new UserError("Hosted Skylight services require an issuer and subject.");
  }
  return createSkylightService({
    env: hostedSkylightEnvironment(
      options.infrastructureEnv,
      options.accountEnv
    ),
    authorizationStore: options.authorizationStore,
    cacheIdentity: `${issuer}\0${subject}`,
  });
}

export function createHostedSkylightServices(options: {
  credentials: HostedOAuthCredentialAccess<StoredOAuthCredential>;
  identity: HostedOAuthIdentity;
  infrastructureEnv?: NodeJS.ProcessEnv;
  accountEnv?: NodeJS.ProcessEnv;
}): SkylightServices {
  return {
    skylight: createSubjectSkylightService({
      issuer: options.identity.issuer,
      subject: options.identity.subject,
      authorizationStore: createHostedOAuthAuthorizationStore(
        options.credentials
      ),
      ...(options.infrastructureEnv === undefined
        ? {}
        : { infrastructureEnv: options.infrastructureEnv }),
      ...(options.accountEnv === undefined
        ? {}
        : { accountEnv: options.accountEnv }),
    }),
  };
}
