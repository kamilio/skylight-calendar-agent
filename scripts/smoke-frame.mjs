import { spawn } from "node:child_process";
import http from "node:http";
import { listCalendarFrames, resolveFrameId } from "../dist/skylight/frame.js";
import { flattenResponseLayoutForCli } from "../dist/skylight/http.js";

const originalAuthHeader = process.env.SKYLIGHT_AUTH_HEADER;
process.env.SKYLIGHT_AUTH_HEADER = "Bearer test";
try {
  try {
    await listCalendarFrames({
      fetch: async () => Response.json({ data: {} }),
    });
    throw new Error("Malformed frame list unexpectedly succeeded");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("Frame list response is missing a data array")) throw error;
  }
  try {
    await listCalendarFrames({
      fetch: async () => Response.json({ data: [null] }),
    });
    throw new Error("Malformed frame record unexpectedly succeeded");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("Frame list response contains an invalid frame id")) throw error;
  }
  try {
    await listCalendarFrames({
      fetch: async () => Response.json({ data: [{ id: "1" }, { id: " 1 " }] }),
    });
    throw new Error("Duplicate frame ids unexpectedly succeeded");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('duplicate frame id "1"')) throw error;
  }
  try {
    const id = `safe\u202E${"x".repeat(100_000)}`;
    await listCalendarFrames({
      fetch: async () => Response.json({ data: [{ id }, { id }] }),
    });
    throw new Error("Oversized duplicate frame ids unexpectedly succeeded");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.length > 300 || message.includes("\u202E") || !message.includes("…")) {
      throw new Error(`Duplicate frame error was not safely bounded: ${message.length}`);
    }
  }
  const normalizedFrames = await listCalendarFrames({
    fetch: async () => Response.json({ data: [{ id: " 42 " }] }),
  });
  if (normalizedFrames.data[0]?.id !== "42") {
    throw new Error(`Frame response id was not normalized: ${JSON.stringify(normalizedFrames)}`);
  }
} finally {
  if (originalAuthHeader === undefined) delete process.env.SKYLIGHT_AUTH_HEADER;
  else process.env.SKYLIGHT_AUTH_HEADER = originalAuthHeader;
}

async function runScenario(candidateStatus) {
  const paths = [];
  const server = http.createServer((request, response) => {
    paths.push(request.url);
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/frames/123") {
      response.statusCode = candidateStatus;
      response.end(JSON.stringify({ error: "candidate response" }));
      return;
    }
    response.end(JSON.stringify({ data: [{ id: "456", attributes: { name: "Home" } }] }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Mock server did not start");

  const child = spawn(process.execPath, ["dist/cli.js", "lists", "list"], {
    env: {
      ...process.env,
      SKYLIGHT_API_BASE: `http://127.0.0.1:${address.port}`,
      SKYLIGHT_AUTH_HEADER: "Bearer test",
      SKYLIGHT_CALENDAR_URL: "https://ourskylight.com/calendar/123",
      SKYLIGHT_FRAME_ID: "",
    },
    stdio: "ignore",
  });
  const code = await new Promise((resolve) => child.on("exit", resolve));
  server.close();
  return { code, paths };
}

const unauthorized = await runScenario(401);
if (unauthorized.code === 0 || unauthorized.paths.join(",") !== "/api/frames/123") {
  throw new Error(`Authentication failure was incorrectly masked: ${JSON.stringify(unauthorized)}`);
}

const missing = await runScenario(404);
if (
  missing.code !== 0 ||
  missing.paths.join(",") !==
    "/api/frames/123,/api/frames/calendar,/api/frames/456/lists"
) {
  throw new Error(`Missing candidate did not fall back correctly: ${JSON.stringify(missing)}`);
}

const savedEnv = { ...process.env };
try {
  delete process.env.SKYLIGHT_FRAME_ID;
  delete process.env.SKYLIGHT_CALENDAR_URL;
  process.env.SKYLIGHT_API_BASE = "https://example.invalid";
  process.env.SKYLIGHT_AUTH_HEADER = "Bearer test";
  let malformedUnicodeCalls = 0;
  try {
    await resolveFrameId({
      params: { label: "\uD800" },
      fetch: async () => {
        malformedUnicodeCalls += 1;
        return Response.json({ data: [{ id: "42" }] });
      },
    });
    throw new Error("Malformed Unicode parameter unexpectedly succeeded");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('Command parameter "label" contains invalid Unicode')) throw error;
    if (malformedUnicodeCalls !== 0) {
      throw new Error("Malformed Unicode parameter reached frame discovery");
    }
  }
  let invalidJsonCalls = 0;
  try {
    await resolveFrameId({
      params: { bodyJson: { value: Number.NaN } },
      fetch: async () => {
        invalidJsonCalls += 1;
        return Response.json({ data: [{ id: "42" }] });
      },
    });
    throw new Error("Non-finite JSON parameter unexpectedly succeeded");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('Command parameter "bodyJson"."value" contains a non-finite number')) {
      throw error;
    }
    if (invalidJsonCalls !== 0) {
      throw new Error("Non-finite JSON parameter reached frame discovery");
    }
  }
  let sparseArrayCalls = 0;
  const sparseArray = [];
  sparseArray.length = 1;
  try {
    await resolveFrameId({
      params: { bodyJson: { items: sparseArray } },
      fetch: async () => {
        sparseArrayCalls += 1;
        return Response.json({ data: [{ id: "42" }] });
      },
    });
    throw new Error("Sparse JSON array unexpectedly succeeded");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('Command parameter "bodyJson"."items" contains a sparse array entry')) {
      throw error;
    }
    if (sparseArrayCalls !== 0) {
      throw new Error("Sparse JSON array reached frame discovery");
    }
  }
  try {
    await resolveFrameId({
      fetch: async () =>
        Response.json({
          data: [
            { id: "1", attributes: { name: "Home\u001b[31m" } },
            { id: "2", attributes: { name: "Other\nFrame" } },
          ],
        }),
    });
    throw new Error("Ambiguous frame discovery unexpectedly succeeded");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("Multiple frames found")) throw error;
    if (message.includes("[31m") || message.includes("\u001b") || message.includes("\nFrame")) {
      throw new Error(`Frame selection error retained control characters: ${JSON.stringify(message)}`);
    }
  }
  try {
    await resolveFrameId({
      fetch: async () =>
        Response.json({
          data: [
            { id: "3", attributes: { name: 123 } },
            { id: "4", attributes: { household_name: {} } },
          ],
        }),
    });
    throw new Error("Ambiguous frames with malformed names unexpectedly succeeded");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("Multiple frames found") || !message.includes("- 3") || !message.includes("- 4")) {
      throw error;
    }
  }
  try {
    await resolveFrameId({
      fetch: async () =>
        Response.json({
          data: Array.from({ length: 10_000 }, (_, index) => ({ id: String(index) })),
        }),
    });
    throw new Error("Oversized ambiguous frame discovery unexpectedly succeeded");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.length > 5_000 || !message.includes("and 9990 more")) {
      throw new Error(`Ambiguous frame error was not safely bounded: ${message.length}`);
    }
  }
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const fetch = async () => {
    calls += 1;
    await gate;
    return Response.json({ data: [{ id: "789" }] });
  };
  const first = resolveFrameId({ fetch });
  const second = resolveFrameId({ fetch });
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (calls !== 1) throw new Error(`Concurrent frame discovery made ${calls} requests`);
  release();
  const ids = await Promise.all([first, second]);
  if (ids[0] !== "789" || ids[1] !== "789") {
    throw new Error(`Concurrent frame discovery returned wrong ids: ${ids.join(",")}`);
  }
  if ((await resolveFrameId({ fetch })) !== "789" || calls !== 1) {
    throw new Error(`Resolved frame was not cached for its fetch client: ${calls} requests`);
  }

  const firstClientPaths = [];
  const secondClientPaths = [];
  const firstClientFetch = async (url) => {
    firstClientPaths.push(new URL(url).pathname);
    await new Promise((resolve) => setTimeout(resolve, 10));
    return Response.json({ data: [{ id: "111" }] });
  };
  const secondClientFetch = async (url) => {
    secondClientPaths.push(new URL(url).pathname);
    return Response.json({ data: [{ id: "222" }] });
  };
  const clientIds = await Promise.all([
    resolveFrameId({ fetch: firstClientFetch }),
    resolveFrameId({ fetch: secondClientFetch }),
  ]);
  if (
    clientIds[0] !== "111" ||
    clientIds[1] !== "222" ||
    firstClientPaths.join(",") !== "/api/frames/calendar" ||
    secondClientPaths.join(",") !== "/api/frames/calendar"
  ) {
    throw new Error(
      `Frame discovery leaked across fetch clients: ${JSON.stringify({ clientIds, firstClientPaths, secondClientPaths })}`
    );
  }

  process.env.SKYLIGHT_AUTH_HEADER = "Bearer old-account";
  let accountSwitchCalls = 0;
  let releaseOldAccount;
  const oldAccountGate = new Promise((resolve) => {
    releaseOldAccount = resolve;
  });
  const accountSwitchFetch = async () => {
    accountSwitchCalls += 1;
    if (accountSwitchCalls === 1) {
      await oldAccountGate;
      return Response.json({ data: [{ id: "old-frame" }] });
    }
    return Response.json({ data: [{ id: "new-frame" }] });
  };
  const oldAccountResolution = resolveFrameId({ fetch: accountSwitchFetch });
  await new Promise((resolve) => setTimeout(resolve, 0));
  process.env.SKYLIGHT_AUTH_HEADER = "Bearer new-account";
  releaseOldAccount();
  if ((await oldAccountResolution) !== "old-frame") {
    throw new Error("Old account frame discovery returned the wrong frame");
  }
  const newAccountFrame = await resolveFrameId({ fetch: accountSwitchFetch });
  if (newAccountFrame !== "new-frame" || accountSwitchCalls !== 2) {
    throw new Error(
      `Frame discovery leaked across credential changes: ${JSON.stringify({ newAccountFrame, accountSwitchCalls })}`
    );
  }

  delete process.env.SKYLIGHT_AUTH_HEADER;
  delete process.env.SKYLIGHT_BASIC_TOKEN;
  process.env.SKYLIGHT_EMAIL = "cache@example.com";
  process.env.SKYLIGHT_PASSWORD = "secret";
  const authenticatedPaths = [];
  const authenticatedFetch = async (url) => {
    const path = new URL(url).pathname;
    authenticatedPaths.push(path);
    if (path === "/api/sessions") {
      return Response.json({ data: { id: "user", attributes: { token: "token" } } });
    }
    return Response.json({ data: [{ id: "333" }] });
  };
  if (
    (await resolveFrameId({ fetch: authenticatedFetch })) !== "333" ||
    (await resolveFrameId({ fetch: authenticatedFetch })) !== "333" ||
    authenticatedPaths.join(",") !== "/api/sessions,/api/frames/calendar"
  ) {
    throw new Error(
      `Login changed the frame cache identity: ${JSON.stringify(authenticatedPaths)}`
    );
  }

  flattenResponseLayoutForCli();
  process.env.SKYLIGHT_AUTH_HEADER = "Bearer test";
  delete process.env.SKYLIGHT_EMAIL;
  delete process.env.SKYLIGHT_PASSWORD;
  delete process.env.SKYLIGHT_FRAME_ID;
  delete process.env.SKYLIGHT_CALENDAR_URL;
  const manyFrames = Array.from({ length: 600 }, (_, index) => ({ id: String(index + 1) }));
  const displayedFrames = await listCalendarFrames({
    fetch: async () => Response.json({ data: manyFrames }),
  });
  if (
    displayedFrames.data.length !== 501 ||
    displayedFrames.data.at(-1) !== "… [truncated 100 items]"
  ) {
    throw new Error("CLI frame listing was not bounded after validation");
  }
  try {
    await resolveFrameId({
      fetch: async () => Response.json({ data: manyFrames }),
    });
    throw new Error("Large ambiguous frame discovery unexpectedly succeeded");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("Multiple frames found") || !message.includes("and 590 more")) {
      throw error;
    }
  }
  try {
    await listCalendarFrames({
      fetch: async () => Response.json({ data: [{ id: "bad\nid" }] }),
    });
    throw new Error("Control-character frame id unexpectedly succeeded in CLI mode");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("Frame list response contains an invalid frame id")) throw error;
  }
} finally {
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  Object.assign(process.env, savedEnv);
}
