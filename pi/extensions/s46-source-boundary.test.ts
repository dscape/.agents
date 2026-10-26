import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import installSourceBoundary from "./s46-source-boundary.ts";

type ToolCallHandler = (
  event: { toolName: string; input: unknown },
  context: { cwd: string; hasUI: boolean; ui: { notify(): void } },
) => Promise<unknown>;

function loadHandler(): ToolCallHandler {
  let handler: ToolCallHandler | undefined;
  const pi = {
    on(event: string, candidate: ToolCallHandler) {
      assert.equal(event, "tool_call");
      handler = candidate;
    },
  };
  installSourceBoundary(pi as unknown as ExtensionAPI);
  assert.ok(handler);
  return handler;
}

const context = {
  cwd: "/tmp",
  hasUI: false,
  ui: { notify() {} },
};

async function call(toolName: string, input: unknown, cwd = context.cwd) {
  return loadHandler()({ toolName, input }, { ...context, cwd });
}

function assertBlocked(result: unknown) {
  assert.equal(typeof result, "object");
  assert.equal((result as { block?: unknown }).block, true);
}

test("blocks edits and writes beneath the legacy root", async () => {
  assertBlocked(await call("write", { path: join(homedir(), ".s46", "tool.py") }));
  assertBlocked(await call("edit", { path: "tool.py" }, join(homedir(), ".s46")));
  assert.equal(await call("write", { path: join(homedir(), ".s460", "tool.py") }), undefined);
});

test("allows evidence reads but blocks likely secret material", async () => {
  assert.equal(
    await call("read", { path: join(homedir(), ".s46", "evidence", "manifest.json") }),
    undefined,
  );
  assertBlocked(await call("read", { path: join(homedir(), ".s46", "model-keys", "release") }));
  assertBlocked(
    await call("read", {
      path: join(
        homedir(),
        ".s46",
        "prelaunch-route-probes",
        "run",
        "home",
        ".pi",
        "agent",
        "models-openrouter.json",
      ),
    }),
  );
  assertBlocked(await call("read", { path: join(homedir(), ".s46", "run", "gateway.env") }));
  assertBlocked(
    await call("read", {
      path: join(
        homedir(),
        ".s46",
        "airplane-runner-provisioner",
        "production-20261026",
        "identity-signing-key",
      ),
    }),
  );
  assertBlocked(
    await call("read", { path: join(homedir(), ".s46", "production-backups", "snapshot") }),
  );
});

test("blocks shell access by command reference or working directory", async () => {
  assertBlocked(await call("bash", { command: "find ~/.s46 -type f" }));
  assertBlocked(await call("bash", { command: "find $HOME/.s46 -type f" }));
  assertBlocked(await call("bash", { command: "find .s46/evidence -type f" }));
  assertBlocked(await call("bash", { command: "pwd" }, join(homedir(), ".s46")));
  assert.equal(await call("bash", { command: "curl https://models.s46.dev" }), undefined);
  assert.equal(await call("bash", { command: `ls ${join(homedir(), ".s460")}` }), undefined);
  assert.equal(await call("bash", { command: "mktemp .s46-install.XXXXXX" }), undefined);
  assert.equal(await call("bash", { command: "pwd" }), undefined);
});
