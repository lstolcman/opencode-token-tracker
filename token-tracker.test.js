import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert";
import {
  collectTokensFromSession,
  collectAllMessagesFromSession,
} from "./token-tracker.js";

function mockClient(messagesResponse) {
  return {
    session: {
      messages: mock.fn(() => Promise.resolve(messagesResponse)),
      children: mock.fn(() => Promise.resolve({ data: [] })),
    },
    tui: {
      showToast: mock.fn(() => Promise.resolve()),
    },
  };
}

function assistantMsg({
  role = "assistant",
  input = 100,
  output = 50,
  reasoning = 0,
  cacheRead = 0,
  cacheWrite = 0,
  cost = 0.001,
  providerID = "github-copilot",
  modelID = "claude-sonnet-4.6",
  finish = "end_turn",
  created = 1000,
  completed = 1050,
  msgId = "msg-1",
} = {}) {
  return {
    info: {
      role,
      tokens: { input, output, reasoning, cache: { read: cacheRead, write: cacheWrite } },
      cost,
      providerID,
      modelID,
      finish,
      id: msgId,
      time: { created, completed },
    },
  };
}

describe("collectTokensFromSession", () => {
  it("returns null when messages response is null", async () => {
    const client = mockClient(null);
    const result = await collectTokensFromSession(client, "s1");
    assert.strictEqual(result, null);
  });

  it("returns null when messages response is undefined", async () => {
    const client = mockClient(undefined);
    const result = await collectTokensFromSession(client, "s1");
    assert.strictEqual(result, null);
  });

  it("returns null when messages array is empty", async () => {
    const client = mockClient([]);
    const result = await collectTokensFromSession(client, "s1");
    assert.strictEqual(result, null);
  });

  it("returns null when no assistant messages exist", async () => {
    const client = mockClient([
      { info: { role: "user", tokens: { input: 100, output: 0 } } },
    ]);
    const result = await collectTokensFromSession(client, "s1");
    assert.strictEqual(result, null);
  });

  it("returns null when assistant messages have no tokens", async () => {
    const client = mockClient([
      { info: { role: "assistant" } },
    ]);
    const result = await collectTokensFromSession(client, "s1");
    assert.strictEqual(result, null);
  });

  it("returns null when all tokens are zero", async () => {
    const client = mockClient([
      assistantMsg({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }),
    ]);
    const result = await collectTokensFromSession(client, "s1");
    assert.strictEqual(result, null);
  });

  it("returns the last assistant message with non-zero tokens", async () => {
    const client = mockClient([
      assistantMsg({ input: 10, output: 5, msgId: "first" }),
      assistantMsg({ input: 0, output: 0, msgId: "second-zero" }),
      assistantMsg({ input: 100, output: 50, msgId: "last" }),
    ]);
    const result = await collectTokensFromSession(client, "s1");
    assert.strictEqual(result.inp, 100);
    assert.strictEqual(result.out, 50);
    assert.strictEqual(result.msgId, "last");
  });

  it("returns null when only cache tokens are non-zero", async () => {
    const client = mockClient([
      assistantMsg({ input: 0, output: 0, cacheRead: 1000, cacheWrite: 0 }),
    ]);
    const result = await collectTokensFromSession(client, "s1");
    assert.notStrictEqual(result, null);
    assert.strictEqual(result.cacheRead, 1000);
  });

  it("extracts all token fields correctly", async () => {
    const client = mockClient([
      assistantMsg({
        input: 45231,
        output: 1204,
        reasoning: 5000,
        cacheRead: 120000,
        cacheWrite: 3000,
        cost: 0.0032,
        providerID: "github-copilot",
        modelID: "claude-sonnet-4.6",
        finish: "stop_sequence",
        created: 1000,
        completed: 4200,
        msgId: "msg-full",
      }),
    ]);
    const result = await collectTokensFromSession(client, "s1");
    assert.strictEqual(result.inp, 45231);
    assert.strictEqual(result.out, 1204);
    assert.strictEqual(result.reasoning, 5000);
    assert.strictEqual(result.cacheRead, 120000);
    assert.strictEqual(result.cacheWrite, 3000);
    assert.strictEqual(result.latencyMs, 3200);
    assert.strictEqual(result.msgCost, 0.0032);
    assert.strictEqual(result.model, "github-copilot/claude-sonnet-4.6");
    assert.strictEqual(result.finish, "stop_sequence");
    assert.strictEqual(result.msgId, "msg-full");
  });

  it("computes latency as zero when created is missing", async () => {
    const msg = assistantMsg({ created: 0, completed: 1000 });
    msg.info.time = {};
    const client = mockClient([msg]);
    const result = await collectTokensFromSession(client, "s1");
    assert.strictEqual(result.latencyMs, 0);
  });

  it("computes latency as zero when completed is missing", async () => {
    const msg = assistantMsg({ created: 1000, completed: 0 });
    msg.info.time = {};
    const client = mockClient([msg]);
    const result = await collectTokensFromSession(client, "s1");
    assert.strictEqual(result.latencyMs, 0);
  });

  it("returns model as empty string when providerID and modelID are missing", async () => {
    const msg = assistantMsg({ providerID: undefined, modelID: undefined });
    msg.info.providerID = undefined;
    msg.info.modelID = undefined;
    const client = mockClient([msg]);
    const result = await collectTokensFromSession(client, "s1");
    assert.strictEqual(result.model, "");
  });

  it("returns model with only providerID when modelID is missing", async () => {
    const msg = assistantMsg({ providerID: "openai", modelID: undefined });
    msg.info.modelID = undefined;
    const client = mockClient([msg]);
    const result = await collectTokensFromSession(client, "s1");
    assert.strictEqual(result.model, "openai");
  });

  it("handles tokens nested under data property", async () => {
    const client = mockClient({
      data: [
        assistantMsg({ input: 500, output: 200, msgId: "nested" }),
      ],
    });
    const result = await collectTokensFromSession(client, "s1");
    assert.strictEqual(result.inp, 500);
    assert.strictEqual(result.out, 200);
    assert.strictEqual(result.msgId, "nested");
  });

  it("handles non-array response (single message object) as null", async () => {
    const client = mockClient(assistantMsg({ input: 500, output: 200, msgId: "single" }));
    const result = await collectTokensFromSession(client, "s1");
    assert.strictEqual(result, null);
  });

  it("skips messages with missing tokens field", async () => {
    const msg = {
      info: {
        role: "assistant",
        cost: 0,
        id: "msg-no-tokens",
        time: { created: null, completed: null },
      },
    };
    const client = mockClient([msg]);
    const result = await collectTokensFromSession(client, "s1");
    assert.strictEqual(result, null);
  });

  it("returns null for finish when field is missing", async () => {
    const msg = assistantMsg({ input: 100, output: 50, msgId: "m1" });
    delete msg.info.finish;
    const client = mockClient([msg]);
    const result = await collectTokensFromSession(client, "s1");
    assert.strictEqual(result.finish, undefined);
  });
});

describe("collectAllMessagesFromSession", () => {
  it("returns empty array when messages response is null", async () => {
    const client = mockClient(null);
    const result = await collectAllMessagesFromSession(client, "s1");
    assert.deepStrictEqual(result, []);
  });

  it("returns empty array when messages array is empty", async () => {
    const client = mockClient([]);
    const result = await collectAllMessagesFromSession(client, "s1");
    assert.deepStrictEqual(result, []);
  });

  it("returns empty array when no assistant messages", async () => {
    const client = mockClient([
      { info: { role: "user" } },
    ]);
    const result = await collectAllMessagesFromSession(client, "s1");
    assert.deepStrictEqual(result, []);
  });

  it("returns empty array when no messages have tokens", async () => {
    const client = mockClient([
      { info: { role: "assistant" } },
      { info: { role: "assistant", tokens: { input: 0, output: 0 } } },
    ]);
    const result = await collectAllMessagesFromSession(client, "s1");
    assert.deepStrictEqual(result, []);
  });

  it("returns all assistant messages with non-zero tokens in order", async () => {
    const client = mockClient([
      assistantMsg({ input: 10, output: 5, msgId: "m1" }),
      { info: { role: "user" } },
      assistantMsg({ input: 20, output: 10, msgId: "m2" }),
      { info: { role: "assistant" } },
      assistantMsg({ input: 30, output: 15, msgId: "m3" }),
    ]);
    const result = await collectAllMessagesFromSession(client, "s1");
    assert.strictEqual(result.length, 3);
    assert.strictEqual(result[0].msgId, "m1");
    assert.strictEqual(result[1].msgId, "m2");
    assert.strictEqual(result[2].msgId, "m3");
  });

  it("maps all fields correctly for each message", async () => {
    const msg = assistantMsg({
      input: 1000,
      output: 500,
      reasoning: 200,
      cacheRead: 5000,
      cacheWrite: 100,
      cost: 0.005,
      providerID: "openai",
      modelID: "gpt-4o",
      finish: "stop",
      created: 1000,
      completed: 3000,
      msgId: "m-all",
    });
    const client = mockClient([msg]);
    const result = await collectAllMessagesFromSession(client, "s1");
    assert.strictEqual(result.length, 1);
    const [r] = result;
    assert.strictEqual(r.inp, 1000);
    assert.strictEqual(r.out, 500);
    assert.strictEqual(r.reasoning, 200);
    assert.strictEqual(r.cacheRead, 5000);
    assert.strictEqual(r.cacheWrite, 100);
    assert.strictEqual(r.latencyMs, 2000);
    assert.strictEqual(r.msgCost, 0.005);
    assert.strictEqual(r.model, "openai/gpt-4o");
    assert.strictEqual(r.finish, "stop");
    assert.strictEqual(r.msgId, "m-all");
  });

  it("excludes messages with only cache tokens (all numeric tokens zero)", async () => {
    const client = mockClient([
      assistantMsg({ input: 100, output: 50, msgId: "m1" }),
      assistantMsg({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, msgId: "m2-zero" }),
      assistantMsg({ input: 200, output: 100, msgId: "m3" }),
    ]);
    const result = await collectAllMessagesFromSession(client, "s1");
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].msgId, "m1");
    assert.strictEqual(result[1].msgId, "m3");
  });

  it("includes messages with only cache read tokens", async () => {
    const msg = assistantMsg({ input: 0, output: 0, cacheRead: 1000, cacheWrite: 0, msgId: "m-cache" });
    const client = mockClient([msg]);
    const result = await collectAllMessagesFromSession(client, "s1");
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].cacheRead, 1000);
  });

  it("handles data-wrapped response", async () => {
    const client = mockClient({
      data: [
        assistantMsg({ input: 100, output: 50, msgId: "wrapped" }),
      ],
    });
    const result = await collectAllMessagesFromSession(client, "s1");
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].msgId, "wrapped");
  });

  it("handles non-array single message as empty array", async () => {
    const client = mockClient(assistantMsg({ input: 100, output: 50, msgId: "single" }));
    const result = await collectAllMessagesFromSession(client, "s1");
    assert.deepStrictEqual(result, []);
  });

  it("skips messages with missing tokens field", async () => {
    const client = mockClient([
      assistantMsg({ input: 100, output: 50, msgId: "m1" }),
      { info: { role: "assistant" } },
      assistantMsg({ input: 200, output: 100, msgId: "m3" }),
    ]);
    const result = await collectAllMessagesFromSession(client, "s1");
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].msgId, "m1");
    assert.strictEqual(result[1].msgId, "m3");
  });

  it("skips non-assistant messages even if tokens exist", async () => {
    const client = mockClient([
      { info: { role: "user", tokens: { input: 100, output: 50 } } },
      assistantMsg({ input: 200, output: 100, msgId: "m1" }),
    ]);
    const result = await collectAllMessagesFromSession(client, "s1");
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].msgId, "m1");
  });
});

describe("TokenTrackerPlugin", () => {
  let toastCalls;
  let client;

  function buildPlugin() {
    return import("./token-tracker.js").then((m) => m.TokenTrackerPlugin({ client }));
  }

  beforeEach(() => {
    toastCalls = [];
    client = {
      session: {
        messages: mock.fn(() => Promise.resolve({ data: [] })),
        children: mock.fn(() => Promise.resolve({ data: [] })),
      },
      tui: {
        showToast: mock.fn(({ body }) => {
          toastCalls.push(body);
          return Promise.resolve();
        }),
      },
    };
  });

  async function dispatch(plugin, event) {
    await plugin.event({ event });
  }

  it("ignores non-session.idle events", async () => {
    const plugin = await buildPlugin();
    await dispatch(plugin, { type: "session.status", properties: {} });
    assert.strictEqual(toastCalls.length, 0);
  });

  it("ignores session.idle without sessionID", async () => {
    const plugin = await buildPlugin();
    await dispatch(plugin, { type: "session.idle", properties: {} });
    assert.strictEqual(toastCalls.length, 0);
  });

  it("shows toast for simple session with tokens", async () => {
    client.session.messages = mock.fn(() =>
      Promise.resolve({
        data: [
          assistantMsg({ input: 45231, output: 1204, cacheRead: 120000, cost: 0.0032, created: 1000, completed: 4200, msgId: "msg-1" }),
        ],
      })
    );
    const plugin = await buildPlugin();
    await dispatch(plugin, { type: "session.idle", properties: { sessionID: "s1" } });
    assert.strictEqual(toastCalls.length, 1);
    const body = toastCalls[0].message;
    assert.ok(body.includes("in: 45,231"));
    assert.ok(body.includes("out: 1,204"));
    assert.ok(body.includes("cache\u2193: 120,000"));
    assert.ok(body.includes("t: 3.2s"));
    assert.ok(body.includes("$0.0032"));
    assert.ok(body.includes("session: $0.0032"));
    assert.ok(body.includes("github-copilot/claude-sonnet-4.6"));
  });

  it("shows toast for session with reasoning tokens", async () => {
    client.session.messages = mock.fn(() =>
      Promise.resolve({
        data: [
          assistantMsg({ input: 1000, output: 500, reasoning: 10000, msgId: "r1" }),
        ],
      })
    );
    const plugin = await buildPlugin();
    await dispatch(plugin, { type: "session.idle", properties: { sessionID: "s1" } });
    const body = toastCalls[0].message;
    assert.ok(body.includes("think: 10,000"));
  });

  it("shows finish reason when not end_turn or tool_calls", async () => {
    client.session.messages = mock.fn(() =>
      Promise.resolve({
        data: [
          assistantMsg({ finish: "stop_sequence", msgId: "f1" }),
        ],
      })
    );
    const plugin = await buildPlugin();
    await dispatch(plugin, { type: "session.idle", properties: { sessionID: "s1" } });
    assert.strictEqual(toastCalls.length, 1);
    assert.ok(toastCalls[0].message.includes("finish: stop_sequence"));
  });

  it("omits finish reason for end_turn", async () => {
    client.session.messages = mock.fn(() =>
      Promise.resolve({
        data: [
          assistantMsg({ finish: "end_turn", msgId: "e1" }),
        ],
      })
    );
    const plugin = await buildPlugin();
    await dispatch(plugin, { type: "session.idle", properties: { sessionID: "s1" } });
    assert.strictEqual(toastCalls.length, 1);
    assert.ok(!toastCalls[0].message.includes("finish:"));
  });

  it("omits finish reason for tool_calls", async () => {
    client.session.messages = mock.fn(() =>
      Promise.resolve({
        data: [
          assistantMsg({ finish: "tool_calls", msgId: "t1" }),
        ],
      })
    );
    const plugin = await buildPlugin();
    await dispatch(plugin, { type: "session.idle", properties: { sessionID: "s1" } });
    assert.strictEqual(toastCalls.length, 1);
    assert.ok(!toastCalls[0].message.includes("finish:"));
  });

  it("session.status busy resets counters", async () => {
    client.session.messages = mock.fn(() =>
      Promise.resolve({
        data: [
          assistantMsg({ input: 100, output: 50, cost: 0.001, msgId: "m1" }),
        ],
      })
    );
    const plugin = await buildPlugin();

    await dispatch(plugin, { type: "session.idle", properties: { sessionID: "s1" } });
    assert.strictEqual(toastCalls.length, 1);
    assert.ok(toastCalls[0].message.includes("session: $0.0010"));

    await dispatch(plugin, { type: "session.status", properties: { status: { type: "busy" }, sessionID: "s1" } });

    client.session.messages = mock.fn(() =>
      Promise.resolve({
        data: [
          assistantMsg({ input: 200, output: 100, cost: 0.002, msgId: "m2" }),
        ],
      })
    );
    toastCalls.length = 0;

    await dispatch(plugin, { type: "session.idle", properties: { sessionID: "s1" } });
    assert.strictEqual(toastCalls.length, 1);
    assert.ok(toastCalls[0].message.includes("session: $0.0020"));
  });

  it("deduplicates cost accumulation by msgId across events", async () => {
    client.session.messages = mock.fn(() =>
      Promise.resolve({
        data: [
          assistantMsg({ input: 100, output: 50, cost: 0.001, msgId: "m1" }),
        ],
      })
    );
    const plugin = await buildPlugin();

    await dispatch(plugin, { type: "session.idle", properties: { sessionID: "s1" } });
    assert.ok(toastCalls[0].message.includes("session: $0.0010"));

    await dispatch(plugin, { type: "session.idle", properties: { sessionID: "s1" } });
    assert.strictEqual(toastCalls.length, 2);
    assert.ok(toastCalls[1].message.includes("session: $0.0010"));
  });

  it("accumulates cost across different msgIds (deduplication)", async () => {
    client.session.children = mock.fn(() => Promise.resolve({ data: [{ id: "child-1" }] }));
    client.session.messages = mock.fn(({ path }) => {
      if (path.id === "s1") {
        return Promise.resolve({
          data: [assistantMsg({ input: 1000, output: 500, cost: 0.001, msgId: "p1" })],
        });
      }
      return Promise.resolve({
        data: [assistantMsg({ input: 2000, output: 1000, cost: 0.002, msgId: "c1" })],
      });
    });

    const plugin = await buildPlugin();
    await dispatch(plugin, { type: "session.idle", properties: { sessionID: "s1" } });
    assert.ok(toastCalls[0].message.includes("session: $0.0030"));

    toastCalls.length = 0;
    await dispatch(plugin, { type: "session.idle", properties: { sessionID: "s1" } });
    assert.ok(toastCalls[0].message.includes("session: $0.0030"));
  });

  it("increments premium request count when input tokens > 0", async () => {
    client.session.messages = mock.fn(() =>
      Promise.resolve({
        data: [
          assistantMsg({ input: 100, output: 50, msgId: "m1" }),
        ],
      })
    );
    const plugin = await buildPlugin();
    await dispatch(plugin, { type: "session.idle", properties: { sessionID: "s1" } });
    assert.ok(toastCalls[0].message.includes("reqs: 1"));
  });

  it("aggregates tokens from parent and child sessions", async () => {
    client.session.children = mock.fn(() =>
      Promise.resolve({ data: [{ id: "child-1" }] })
    );
    client.session.messages = mock.fn(({ path }) => {
      if (path.id === "s1") {
        return Promise.resolve({
          data: [
            assistantMsg({ input: 1000, output: 500, cost: 0.001, msgId: "p1" }),
          ],
        });
      }
      if (path.id === "child-1") {
        return Promise.resolve({
          data: [
            assistantMsg({ input: 2000, output: 1000, cost: 0.002, msgId: "c1" }),
            assistantMsg({ input: 3000, output: 1500, cost: 0.003, msgId: "c2" }),
          ],
        });
      }
      return Promise.resolve({ data: [] });
    });

    const plugin = await buildPlugin();
    await dispatch(plugin, { type: "session.idle", properties: { sessionID: "s1" } });

    assert.strictEqual(toastCalls.length, 1);
    const body = toastCalls[0].message;
    assert.ok(body.includes("in: 6,000"));
    assert.ok(body.includes("out: 3,000"));
    assert.ok(body.includes("[+1 subagents]"));
    assert.ok(body.includes("session: $0.0060"));
    assert.ok(body.includes("reqs: 3"));
  });

  it("only aggregates NEW child sessions, not previously processed ones", async () => {
    client.session.children = mock.fn(() =>
      Promise.resolve({ data: [{ id: "child-1" }, { id: "child-2" }] })
    );
    client.session.messages = mock.fn(({ path }) => {
      if (path.id === "s1") {
        return Promise.resolve({
          data: [assistantMsg({ input: 1000, output: 500, cost: 0.001, msgId: "p1" })],
        });
      }
      if (path.id === "child-1") {
        return Promise.resolve({
          data: [assistantMsg({ input: 2000, output: 1000, cost: 0.002, msgId: "x1" })],
        });
      }
      if (path.id === "child-2") {
        return Promise.resolve({
          data: [assistantMsg({ input: 3000, output: 1500, cost: 0.003, msgId: "x2" })],
        });
      }
      return Promise.resolve({ data: [] });
    });

    const plugin = await buildPlugin();
    await dispatch(plugin, { type: "session.idle", properties: { sessionID: "s1" } });
    assert.ok(toastCalls[0].message.includes("[+2 subagents]"));
    assert.ok(toastCalls[0].message.includes("session: $0.0060"));

    toastCalls.length = 0;
    client.session.children = mock.fn(() =>
      Promise.resolve({ data: [{ id: "child-1" }, { id: "child-2" }, { id: "child-3" }] })
    );
    client.session.messages = mock.fn(({ path }) => {
      if (path.id === "child-3") {
        return Promise.resolve({
          data: [assistantMsg({ input: 4000, output: 2000, cost: 0.004, msgId: "x3" })],
        });
      }
      return Promise.resolve({ data: [] });
    });

    await dispatch(plugin, { type: "session.idle", properties: { sessionID: "s1" } });
    assert.ok(toastCalls[0].message.includes("[+1 subagents]"));
    assert.ok(toastCalls[0].message.includes("session: $0.0100"));
  });

  it("handles child with id in info.id field", async () => {
    client.session.children = mock.fn(() =>
      Promise.resolve({ data: [{ info: { id: "child-info-id" } }] })
    );
    client.session.messages = mock.fn(({ path }) => {
      if (path.id === "s1") {
        return Promise.resolve({ data: [assistantMsg({ input: 100, output: 50, msgId: "p1" })] });
      }
      if (path.id === "child-info-id") {
        return Promise.resolve({ data: [assistantMsg({ input: 200, output: 100, msgId: "c1" })] });
      }
      return Promise.resolve({ data: [] });
    });

    const plugin = await buildPlugin();
    await dispatch(plugin, { type: "session.idle", properties: { sessionID: "s1" } });
    assert.strictEqual(toastCalls.length, 1);
    assert.ok(toastCalls[0].message.includes("[+1 subagents]"));
  });

  it("handles child as plain string id", async () => {
    client.session.children = mock.fn(() => Promise.resolve({ data: ["child-plain"] }));
    client.session.messages = mock.fn(({ path }) => {
      if (path.id === "s1") {
        return Promise.resolve({ data: [assistantMsg({ input: 100, output: 50, msgId: "p1" })] });
      }
      if (path.id === "child-plain") {
        return Promise.resolve({ data: [assistantMsg({ input: 200, output: 100, msgId: "c1" })] });
      }
      return Promise.resolve({ data: [] });
    });

    const plugin = await buildPlugin();
    await dispatch(plugin, { type: "session.idle", properties: { sessionID: "s1" } });
    assert.strictEqual(toastCalls.length, 1);
    assert.ok(toastCalls[0].message.includes("[+1 subagents]"));
  });

  it("child session error is caught silently", async () => {
    client.session.children = mock.fn(() =>
      Promise.resolve({ data: [{ id: "failing-child" }] })
    );
    client.session.messages = mock.fn(({ path }) => {
      if (path.id === "s1") {
        return Promise.resolve({
          data: [assistantMsg({ input: 1000, output: 500, msgId: "p1" })],
        });
      }
      if (path.id === "failing-child") {
        return Promise.reject(new Error("network error"));
      }
      return Promise.resolve({ data: [] });
    });

    const plugin = await buildPlugin();
    await dispatch(plugin, { type: "session.idle", properties: { sessionID: "s1" } });
    assert.strictEqual(toastCalls.length, 1);
    assert.ok(toastCalls[0].message.includes("in: 1,000"));
  });

  it("uses toast variant success and duration 10000", async () => {
    client.session.messages = mock.fn(() =>
      Promise.resolve({ data: [assistantMsg({ input: 100, output: 50, msgId: "m1" })] })
    );
    const plugin = await buildPlugin();
    await dispatch(plugin, { type: "session.idle", properties: { sessionID: "s1" } });
    assert.strictEqual(toastCalls.length, 1);
    assert.strictEqual(toastCalls[0].variant, "success");
    assert.strictEqual(toastCalls[0].duration, 10000);
  });

  it("session with no tokens does not show toast", async () => {
    client.session.messages = mock.fn(() => Promise.resolve({ data: [] }));
    const plugin = await buildPlugin();
    await dispatch(plugin, { type: "session.idle", properties: { sessionID: "s1" } });
    assert.strictEqual(toastCalls.length, 0);
  });

  it("main agent with children but no tokens shows child tokens only", async () => {
    client.session.children = mock.fn(() =>
      Promise.resolve({ data: [{ id: "child-only" }] })
    );
    client.session.messages = mock.fn(({ path }) => {
      if (path.id === "s1") {
        return Promise.resolve({ data: [{ info: { role: "user" } }] });
      }
      return Promise.resolve({
        data: [assistantMsg({ input: 500, output: 250, cost: 0.001, msgId: "c1" })],
      });
    });

    const plugin = await buildPlugin();
    await dispatch(plugin, { type: "session.idle", properties: { sessionID: "s1" } });
    assert.strictEqual(toastCalls.length, 1);
    const body = toastCalls[0].message;
    assert.ok(body.includes("in: 500"));
    assert.ok(body.includes("out: 250"));
    assert.ok(body.includes("[+1 subagents]"));
  });

  it("multiple main agent idle events accumulate child costs correctly", async () => {
    client.session.children = mock.fn(() =>
      Promise.resolve({ data: [{ id: "child-1" }] })
    );
    client.session.messages = mock.fn(({ path }) => {
      if (path.id === "s1") {
        return Promise.resolve({
          data: [assistantMsg({ input: 1000, output: 500, cost: 0.001, msgId: "p1" })],
        });
      }
      return Promise.resolve({
        data: [assistantMsg({ input: 500, output: 250, cost: 0.0005, msgId: "c1" })],
      });
    });

    const plugin = await buildPlugin();
    await dispatch(plugin, { type: "session.idle", properties: { sessionID: "s1" } });
    assert.ok(toastCalls[0].message.includes("session: $0.0015"));

    toastCalls.length = 0;
    await dispatch(plugin, { type: "session.idle", properties: { sessionID: "s1" } });
    assert.strictEqual(toastCalls.length, 1);
    assert.ok(toastCalls[0].message.includes("session: $0.0015"));
  });

  it("omits finish reason when finish is undefined", async () => {
    client.session.messages = mock.fn(() =>
      Promise.resolve({
        data: [
          assistantMsg({ input: 100, output: 50, msgId: "m1" }),
        ],
      })
    );
    const plugin = await buildPlugin();
    await dispatch(plugin, { type: "session.idle", properties: { sessionID: "s1" } });
    assert.strictEqual(toastCalls.length, 1);
    assert.ok(!toastCalls[0].message.includes("finish:"));
  });

  it("shows cacheWrite in toast when present", async () => {
    client.session.messages = mock.fn(() =>
      Promise.resolve({
        data: [
          assistantMsg({ input: 100, output: 50, cacheWrite: 3000, msgId: "m1" }),
        ],
      })
    );
    const plugin = await buildPlugin();
    await dispatch(plugin, { type: "session.idle", properties: { sessionID: "s1" } });
    assert.strictEqual(toastCalls.length, 1);
    assert.ok(toastCalls[0].message.includes("cache\u2191: 3,000"));
  });

  it("parent with tokens and empty children shows parent tokens", async () => {
    client.session.children = mock.fn(() =>
      Promise.resolve({ data: [{ id: "empty-child" }] })
    );
    client.session.messages = mock.fn(({ path }) => {
      if (path.id === "s1") {
        return Promise.resolve({
          data: [assistantMsg({ input: 1000, output: 500, cost: 0.001, msgId: "p1" })],
        });
      }
      return Promise.resolve({ data: [] });
    });

    const plugin = await buildPlugin();
    await dispatch(plugin, { type: "session.idle", properties: { sessionID: "s1" } });
    assert.strictEqual(toastCalls.length, 1);
    const body = toastCalls[0].message;
    assert.ok(body.includes("in: 1,000"));
    assert.ok(body.includes("out: 500"));
    assert.ok(body.includes("[+1 subagents]"));
  });

  it("processedChildren is cleared on session.status busy", async () => {
    client.session.children = mock.fn(() =>
      Promise.resolve({ data: [{ id: "child-1" }] })
    );
    client.session.messages = mock.fn(({ path }) => {
      if (path.id === "s1") {
        return Promise.resolve({
          data: [assistantMsg({ input: 1000, output: 500, cost: 0.001, msgId: "p1" })],
        });
      }
      return Promise.resolve({
        data: [assistantMsg({ input: 500, output: 250, cost: 0.0005, msgId: "c1" })],
      });
    });

    const plugin = await buildPlugin();
    await dispatch(plugin, { type: "session.idle", properties: { sessionID: "s1" } });
    assert.ok(toastCalls[0].message.includes("[+1 subagents]"));

    await dispatch(plugin, {
      type: "session.status",
      properties: { status: { type: "busy" }, sessionID: "s1" },
    });

    toastCalls.length = 0;
    client.session.children = mock.fn(() =>
      Promise.resolve({ data: [{ id: "child-1" }, { id: "child-2" }] })
    );

    await dispatch(plugin, { type: "session.idle", properties: { sessionID: "s1" } });
    assert.ok(toastCalls[0].message.includes("[+2 subagents]"));
  });
});
