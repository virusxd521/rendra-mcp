// Token resolution, URL checks and the CLI entry. Own file: HOME must point
// at a temp dir before dist/credentials.js is loaded.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const INDEX = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.js");
const HOME = mkdtempSync(join(tmpdir(), "rendra-mcp-test-"));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
const { resolveTokens } = await import("../dist/server.js");
const { checkApiUrl } = await import("../dist/safety.js");
const { isSafeVerificationUrl } = await import("../dist/auth.js");

const BASE = "https://www.rendra.design";
const KEYS = ["RENDRA_API_TOKEN", "RENDRA_API_TOKEN_RO", "RENDRA_API_URL"];

function withEnv(env, fn) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
  try {
    return fn();
  } finally {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

/** Env for a child with no token and an empty HOME. */
function childEnv() {
  const env = { PATH: process.env.PATH ?? "", HOME, USERPROFILE: HOME };
  if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
  return env;
}

after(() => rmSync(HOME, { recursive: true, force: true }));

describe("resolveTokens", () => {
  it("no env and no file: no tokens", () => {
    assert.deepEqual(withEnv({}, () => resolveTokens(BASE)), { read: undefined, write: undefined });
  });

  describe("with a credentials file", () => {
    before(() => {
      mkdirSync(join(HOME, ".config", "rendra"), { recursive: true });
      writeFileSync(
        join(HOME, ".config", "rendra", "credentials.json"),
        JSON.stringify({ version: 1, tokens: { [BASE]: { access_token: "file" } } }),
      );
    });
    after(() => rmSync(join(HOME, ".config"), { recursive: true, force: true }));

    it("uses the file when no env token is set", () => {
      assert.deepEqual(withEnv({}, () => resolveTokens(BASE)), { read: "file", write: "file" });
    });

    it("env token wins over the file", () => {
      assert.deepEqual(withEnv({ RENDRA_API_TOKEN: "env" }, () => resolveTokens(BASE)), {
        read: "env",
        write: "env",
      });
    });

    it("RENDRA_API_TOKEN_RO alone is read-only mode, even with a file", () => {
      assert.deepEqual(withEnv({ RENDRA_API_TOKEN_RO: "ro" }, () => resolveTokens(BASE)), {
        read: "ro",
        write: undefined,
      });
    });

    it("both env tokens: reads use RO, writes use the full token", () => {
      const t = withEnv({ RENDRA_API_TOKEN: "rw", RENDRA_API_TOKEN_RO: "ro" }, () => resolveTokens(BASE));
      assert.deepEqual(t, { read: "ro", write: "rw" });
    });

    it("an empty string counts as unset", () => {
      const t = withEnv({ RENDRA_API_TOKEN: "", RENDRA_API_TOKEN_RO: "" }, () => resolveTokens(BASE));
      assert.deepEqual(t, { read: "file", write: "file" });
    });
  });
});

describe("checkApiUrl", () => {
  it("allows https and http on localhost only", () => {
    assert.equal(checkApiUrl("https://www.rendra.design").ok, true);
    assert.equal(checkApiUrl("http://localhost:3000").ok, true);
    assert.equal(checkApiUrl("http://app.localhost").ok, true);
    assert.equal(checkApiUrl("http://rendra.design").ok, false);
    assert.equal(checkApiUrl("not a url").ok, false);
  });
});

describe("isSafeVerificationUrl", () => {
  it("accepts the same origin", () => {
    assert.equal(isSafeVerificationUrl("https://www.rendra.design/devices?code=A", BASE), true);
    assert.equal(isSafeVerificationUrl("http://localhost:3000/devices", "http://localhost:3000"), true);
  });

  it("accepts the apex link for a www base, and the reverse", () => {
    assert.equal(isSafeVerificationUrl("https://rendra.design/devices?code=A", BASE), true);
    assert.equal(isSafeVerificationUrl("https://www.rendra.design/devices", "https://rendra.design"), true);
  });

  it("refuses a foreign host, a lookalike, http off localhost and other schemes", () => {
    assert.equal(isSafeVerificationUrl("https://evil.example/devices", BASE), false);
    assert.equal(isSafeVerificationUrl("https://rendra.design.evil.example/", BASE), false);
    assert.equal(isSafeVerificationUrl("http://rendra.design/devices", BASE), false);
    assert.equal(isSafeVerificationUrl("file:///etc/passwd", BASE), false);
    assert.equal(isSafeVerificationUrl("not a url", BASE), false);
  });
});

describe("CLI", () => {
  async function listToolsVia(args) {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [INDEX, ...args],
      env: childEnv(),
      stderr: "pipe",
    });
    const client = new Client({ name: "test", version: "1" });
    await client.connect(transport);
    try {
      return (await client.listTools()).tools;
    } finally {
      await client.close();
    }
  }

  it("starts with no token and an empty HOME, and lists 9 tools", async () => {
    assert.equal((await listToolsVia([])).length, 9);
  });

  it("an unknown option still starts the server", async () => {
    assert.equal((await listToolsVia(["--stdio"])).length, 9);
  });

  it("an unknown word prints help and exits 1", () => {
    const r = spawnSync(process.execPath, [INDEX, "lgoin"], { env: childEnv(), encoding: "utf8" });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /unknown command "lgoin"/);
    assert.match(r.stderr, /Usage:/);
  });

  it("--version prints the package version", () => {
    const r = spawnSync(process.execPath, [INDEX, "--version"], { env: childEnv(), encoding: "utf8" });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^\d+\.\d+\.\d+\n$/);
  });
});
