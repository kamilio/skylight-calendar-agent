import { createSubjectSkylightService } from "../dist/skylight/service.js";

const issuer = "https://issuer.example";
const savedGlobalAuthorization = process.env.SKYLIGHT_AUTH_HEADER;
const upstreamRequests = [];

function store(subject) {
  let authorization = `Bearer upstream-${subject}`;
  return {
    name: `subject ${subject}`,
    async read() {
      return authorization;
    },
    async write(value) {
      authorization = value;
    },
    async delete() {
      const existed = authorization.length > 0;
      authorization = "";
      return existed;
    },
  };
}

const upstreamFetch = async (url, init = {}) => {
  const parsed = new URL(String(url));
  const authorization = new Headers(init.headers).get("authorization");
  upstreamRequests.push({ path: parsed.pathname, authorization });
  const subject = authorization?.replace("Bearer upstream-", "") ?? "missing";
  if (parsed.pathname === "/api/frames/calendar") {
    return Response.json({ data: [{ id: `frame-${subject}` }] });
  }
  return Response.json({ subject, path: parsed.pathname });
};

const services = new Map(
  ["alpha", "beta"].map((subject) => [
    subject,
    createSubjectSkylightService({
      issuer,
      subject,
      authorizationStore: store(subject),
      infrastructureEnv: {
        SKYLIGHT_API_BASE: "https://skylight.invalid",
        SKYLIGHT_AUTH_HEADER: "Bearer forbidden-global-fallback",
      },
      accountEnv: {
        SKYLIGHT_BEARER_TOKEN: "forbidden-account-fallback",
      },
    }),
  ])
);

process.env.SKYLIGHT_AUTH_HEADER = "Bearer forbidden-global-fallback";

try {
  const [alphaFrame, alphaFrameAgain, betaFrame, betaFrameAgain] = await Promise.all([
    services.get("alpha").resolveFrameId({ fetch: upstreamFetch }),
    services.get("alpha").resolveFrameId({ fetch: upstreamFetch }),
    services.get("beta").resolveFrameId({ fetch: upstreamFetch }),
    services.get("beta").resolveFrameId({ fetch: upstreamFetch }),
  ]);
  if (
    alphaFrame !== "frame-alpha" ||
    alphaFrameAgain !== "frame-alpha" ||
    betaFrame !== "frame-beta" ||
    betaFrameAgain !== "frame-beta"
  ) {
    throw new Error("Subject frame resolution crossed service boundaries.");
  }
  const frameLookups = upstreamRequests.filter(({ path }) => path === "/api/frames/calendar");
  if (
    frameLookups.length !== 2 ||
    frameLookups.some(({ authorization }) => authorization === "Bearer forbidden-global-fallback")
  ) {
    throw new Error(`Subject frame caches or credentials were not isolated: ${JSON.stringify(frameLookups)}`);
  }

} finally {
  if (savedGlobalAuthorization === undefined) delete process.env.SKYLIGHT_AUTH_HEADER;
  else process.env.SKYLIGHT_AUTH_HEADER = savedGlobalAuthorization;
}

console.log("subject-services-isolated-ok");
