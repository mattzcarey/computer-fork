import { describe, expect, it } from "vitest";

import { WorkspaceRuntimeBridge } from "./bridge.js";
import type { WorkspaceRuntimeCapability } from "./capability.js";
import { defineModule } from "./module.js";

const encoder = new TextEncoder();
const args = JSON.stringify(["run", "value"]);

function bridge(limits: {
  maxCalls?: number;
  maxTotalRequestBytes?: number;
  maxTotalResponseBytes?: number;
}) {
  return new WorkspaceRuntimeBridge({} as WorkspaceRuntimeCapability, {
    ...limits,
    trustedModules: {
      "ws:test": {
        async call() {
          return "ok";
        },
      },
    },
  });
}

async function message(response: Promise<string>) {
  return (JSON.parse(await response) as { error?: { message?: string } }).error?.message;
}

describe("WorkspaceRuntimeBridge cumulative limits", () => {
  it("accepts the configured call count and rejects the next call", async () => {
    const target = bridge({ maxCalls: 2 });
    await expect(message(target.call("trusted/ws:test.call", args))).resolves.toBeUndefined();
    await expect(message(target.call("trusted/ws:test.call", args))).resolves.toBeUndefined();
    await expect(message(target.call("trusted/ws:test.call", args))).resolves.toContain(
      "exceeds 2 capability calls",
    );
  });

  it("accepts requests at the cumulative byte boundary and rejects the next request", async () => {
    const bytes = encoder.encode(args).byteLength;
    const target = bridge({ maxTotalRequestBytes: bytes * 2 });
    await expect(message(target.call("trusted/ws:test.call", args))).resolves.toBeUndefined();
    await expect(message(target.call("trusted/ws:test.call", args))).resolves.toBeUndefined();
    await expect(message(target.call("trusted/ws:test.call", args))).resolves.toContain(
      `requests exceed ${bytes * 2} bytes`,
    );
  });

  it("accepts responses at the cumulative byte boundary and rejects the next response", async () => {
    const sample = await bridge({}).call("trusted/ws:test.call", args);
    const bytes = encoder.encode(sample).byteLength;
    const target = bridge({ maxTotalResponseBytes: bytes * 2 });
    await expect(message(target.call("trusted/ws:test.call", args))).resolves.toBeUndefined();
    await expect(message(target.call("trusted/ws:test.call", args))).resolves.toBeUndefined();
    await expect(message(target.call("trusted/ws:test.call", args))).resolves.toContain(
      `responses exceed ${bytes * 2} bytes`,
    );
  });
});

describe("WorkspaceRuntimeBridge assertResult", () => {
  function resultBridge(maxResultBytes?: number) {
    return new WorkspaceRuntimeBridge({} as WorkspaceRuntimeCapability, { maxResultBytes });
  }

  it("accepts a JSON-compatible value", async () => {
    await expect(
      resultBridge().assertResult({ a: [1, 2, null], b: "ok" }),
    ).resolves.toBeUndefined();
  });

  it("rejects a value that is not JSON-compatible", async () => {
    await expect(resultBridge().assertResult(new Date())).rejects.toThrow(/plain objects/);
  });

  it("rejects a value that exceeds the result byte ceiling", async () => {
    await expect(resultBridge(8).assertResult("x".repeat(64))).rejects.toThrow(
      /result exceeds 8 bytes/,
    );
  });
});

describe("WorkspaceRuntimeBridge defined modules", () => {
  function moduleBridge(execute: (input: unknown, context: unknown) => unknown) {
    return new WorkspaceRuntimeBridge({} as WorkspaceRuntimeCapability, {
      executionId: "exec-1",
      trustedModules: {
        "ws:issues": defineModule({ exports: { create: { execute } } }),
        "ws:legacy": { call: async (method, callArgs) => ({ method, callArgs }) },
      },
    });
  }

  async function result(response: Promise<string>) {
    return JSON.parse(await response) as { result?: unknown; error?: { message?: string } };
  }

  it("dispatches to the named export with the execution identifier", async () => {
    let seen: unknown;
    const target = moduleBridge((input, context) => {
      seen = { input, executionId: (context as { executionId: string }).executionId };
      return { ok: true };
    });
    const response = await result(
      target.call(
        "trusted/ws:issues.create",
        // Objects cross the bridge in the codec envelope the isolate writes.
        JSON.stringify([
          { __workspace_codec__: { version: 1, type: "object", entries: [["title", "Bug"]] } },
        ]),
      ),
    );
    expect(response.error).toBeUndefined();
    expect(seen).toEqual({ input: { title: "Bug" }, executionId: "exec-1" });
  });

  it("passes undefined when the export is called without input and maps undefined to null", async () => {
    let seen: unknown = "unset";
    const target = moduleBridge((input) => {
      seen = input;
      return undefined;
    });
    const response = await result(target.call("trusted/ws:issues.create", "[]"));
    expect(seen).toBeUndefined();
    expect(response).toEqual({ result: null });
  });

  it("rejects calls to names the module does not export", async () => {
    const target = moduleBridge(() => null);
    const response = await result(target.call("trusted/ws:issues.missing", "[]"));
    expect(response.error?.message).toContain('has no export "missing"');
  });

  it("rejects results that are not plain values", async () => {
    const target = moduleBridge(() => new Date());
    const response = await result(target.call("trusted/ws:issues.create", "[]"));
    expect(response.error?.message).toContain("plain objects");
  });

  it("keeps call-style modules working and gives them the execution identifier", async () => {
    let executionId: string | undefined;
    const target = new WorkspaceRuntimeBridge({} as WorkspaceRuntimeCapability, {
      executionId: "exec-2",
      trustedModules: {
        "ws:legacy": {
          async call(_method, _args, context) {
            executionId = context?.executionId;
            return null;
          },
        },
      },
    });
    const response = await result(target.call("trusted/ws:legacy.call", args));
    expect(response.error).toBeUndefined();
    expect(executionId).toBe("exec-2");
  });
});
