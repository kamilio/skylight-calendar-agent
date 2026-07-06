import { spawn } from "node:child_process";
import http from "node:http";

let request;
const server = http.createServer((incoming, response) => {
  let body = "";
  incoming.on("data", (chunk) => {
    body += chunk;
  });
  incoming.on("end", () => {
    request = {
      authorization: incoming.headers.authorization,
      body: JSON.parse(body),
      url: incoming.url,
    };
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({ message: `safe\n■ forged failure\tvalue${"x".repeat(20_000)}` })
    );
  });
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Mock server did not start");

const env = {
  ...process.env,
  SKYLIGHT_API_BASE: `http://127.0.0.1:${address.port}`,
};
for (const name of [
  "SKYLIGHT_AUTH_HEADER",
  "SKYLIGHT_BASIC_TOKEN",
  "SKYLIGHT_BEARER_TOKEN",
  "SKYLIGHT_EMAIL",
  "SKYLIGHT_PASSWORD",
]) {
  delete env[name];
}

try {
  const child = spawn(
    process.execPath,
    ["dist/cli.js", "profiles", "forgot-password", "--email", "person@example.com"],
    { env, stdio: ["ignore", "pipe", "pipe"] }
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const code = await new Promise((resolve, reject) => {
    child.on("exit", resolve);
    child.on("error", reject);
  });
  if (code !== 0) throw new Error(`Password reset failed (${code}): ${stderr}`);
  if (request?.url !== "/api/password_resets") {
    throw new Error(`Password reset used the wrong URL: ${request?.url}`);
  }
  if (request?.authorization !== undefined) {
    throw new Error("Password reset unexpectedly sent an authorization header");
  }
  if (request?.body?.email !== "person@example.com" || request?.body?.on_mobile !== true) {
    throw new Error(`Password reset body was incorrect: ${JSON.stringify(request?.body)}`);
  }
  if (stdout.includes("\n■ forged failure") || stdout.includes("\t")) {
    throw new Error(`CLI response rendered unsafe layout: ${JSON.stringify(stdout)}`);
  }
  if (stdout.length > 13_000 || !stdout.includes("[truncated")) {
    throw new Error(`CLI response was not safely bounded: ${stdout.length}`);
  }
} finally {
  server.close();
}
