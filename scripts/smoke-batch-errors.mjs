import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createLocalSkylightServices,
  createSkylightSDK,
  SkylightRequestError,
} from "../dist/index.js";

const itemPath = "/api/frames/42/lists/7/list_items";
const labels = ["First item", "Second item", "Third item"];

function fixture(respond) {
  const requests = [];
  const sdk = createSkylightSDK({
    services: createLocalSkylightServices({
      env: {
        SKYLIGHT_API_BASE: "https://example.invalid",
        SKYLIGHT_AUTH_HEADER: "Bearer test",
        SKYLIGHT_FRAME_ID: "42",
        SKYLIGHT_TIMEZONE: "UTC",
      },
      authorizationStore: null,
    }),
    fetch: async (input, options) => {
      const url = new URL(String(input));
      assert.equal(url.hostname, "example.invalid");
      if (url.pathname === "/api/frames/calendar") {
        return Response.json({ data: [{ id: "42" }] });
      }
      assert.equal(url.pathname, itemPath);
      assert.equal(options.method, "POST");
      const body = JSON.parse(options.body);
      requests.push(body);
      return respond(body, requests.length - 1);
    },
  });
  return { sdk, requests };
}

for (const status of [400, 403, 429, 500]) {
  for (const failedIndex of [0, 1, 2]) {
    await test(`batch HTTP ${status} at item ${failedIndex + 1} preserves request details`, async () => {
      const { sdk, requests } = fixture((body, index) =>
        index === failedIndex
          ? Response.json({ error: "simulated failure" }, {
            status,
            headers: { "Retry-After": "15" },
          })
          : Response.json({ data: { id: String(index), label: body.label } })
      );
      await assert.rejects(sdk.lists.itemsCreate({ listId: "7", labels }), (error) => {
        assert.ok(error instanceof SkylightRequestError);
        assert.equal(error.status, status);
        assert.equal(error.method, "POST");
        assert.equal(error.path, itemPath);
        assert.ok(error.message.startsWith(
          `Created ${failedIndex} of 3 items. Failed on item ${failedIndex + 1} (${JSON.stringify(labels[failedIndex])}): `
        ));
        assert.ok(error.message.includes(`Request failed (${status}) POST ${itemPath}`));
        if (status === 429) assert.ok(error.message.includes("Retry after 15"));
        return true;
      });
      assert.deepEqual(requests.map((body) => body.label), labels.slice(0, failedIndex + 1));
    });
  }

  await test(`single-item HTTP ${status} remains a structured request error`, async () => {
    const { sdk, requests } = fixture(() => Response.json({ error: "simulated failure" }, { status }));
    await assert.rejects(sdk.lists.itemCreate({ listId: "7", label: labels[0] }), (error) => {
      assert.ok(error instanceof SkylightRequestError);
      assert.equal(error.status, status);
      assert.equal(error.method, "POST");
      assert.equal(error.path, itemPath);
      assert.ok(!error.message.includes("Created"));
      return true;
    });
    assert.equal(requests.length, 1);
  });
}

for (const section of [undefined, "  Shopping  ", " "]) {
  await test(`successful batch preserves results and section ${JSON.stringify(section)}`, async () => {
    const { sdk, requests } = fixture((body, index) => Response.json({ data: { id: String(index), ...body } }));
    const normalizedSection = section?.trim() || null;
    const params = { listId: "7", labels, ...(section === undefined ? {} : { section }) };
    assert.deepEqual(await sdk.lists.itemsCreate(params), {
      items: labels.map((label, index) => ({ data: { id: String(index), label, section: normalizedSection } })),
    });
    assert.deepEqual(requests, labels.map((label) => ({ label, section: normalizedSection })));
  });
}

for (const failure of [new Error("connection interrupted"), "connection interrupted"]) {
  await test(`non-HTTP ${typeof failure} failure still reports progress without retrying`, async () => {
    const { sdk, requests } = fixture((body, index) => {
      if (index === 1) throw failure;
      return Response.json({ data: { id: String(index) } });
    });
    await assert.rejects(sdk.lists.itemsCreate({ listId: "7", labels }), (error) => {
      assert.ok(error instanceof Error);
      assert.ok(!(error instanceof SkylightRequestError));
      assert.ok(error.message.startsWith('Created 1 of 3 items. Failed on item 2 ("Second item"): '));
      assert.ok(error.message.includes("connection interrupted"));
      return true;
    });
    assert.deepEqual(requests.map((body) => body.label), labels.slice(0, 2));
  });
}

await test("batch rethrows the original request error, preserving its cause and additional fields", async () => {
  const original = new SkylightRequestError(503, "POST", itemPath, "temporarily unavailable");
  original.cause = new Error("upstream failed");
  original.requestId = "test-request-id";
  const originalStack = original.stack;
  const requests = [];
  const sdk = createSkylightSDK({
    services: {
      skylight: {
        resolveFrameId: async () => "42",
        request: async ({ body }) => {
          requests.push(body.label);
          if (requests.length === 2) throw original;
          return { data: { id: "first" } };
        },
      },
    },
  });
  await assert.rejects(sdk.lists.itemsCreate({ listId: "7", labels }), (error) => {
    assert.equal(error, original);
    assert.equal(error.cause, original.cause);
    assert.equal(error.requestId, "test-request-id");
    assert.equal(error.stack, originalStack);
    assert.ok(error.message.startsWith('Created 1 of 3 items. Failed on item 2 ("Second item"): '));
    return true;
  });
  assert.deepEqual(requests, labels.slice(0, 2));
});
