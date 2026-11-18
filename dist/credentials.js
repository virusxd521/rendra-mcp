/**
 * Credentials file for `rendra-mcp` — keeps device-flow tokens off the
 * MCP-client config file (no more pasting `rendra_…` into a JSON env
 * block) and out of process env vars (no leak via `ps -e` or shell
 * history).
 *
 * File layout (versioned in case we need to migrate):
 *
 *   ~/.config/rendra/credentials.json   (mode 0600)
 *   {
 *     "version": 1,
 *     "tokens": {
 *       "https://www.rendra.design":   { ...TokenEntry },
 *       "http://localhost:3000":       { ...TokenEntry }
 *     }
 *   }
 *
 * Keying by base URL means a developer can be logged into prod and
 * local dev simultaneously — `RENDRA_API_URL` selects which entry the
 * server reads at startup.
 *
 * Permissions: dir 0700, file 0600. Same default as `gh`, `vercel`,
 * `aws`. Threat model = "another user on the same machine reads
 * the file"; we don't pretend to defend against malware running as
 * the same uid (that requires OS keychain — flagged for v2).
 */
import { chmodSync, mkdirSync, readFileSync, writeFileSync, } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
const CONFIG_DIR = join(homedir(), ".config", "rendra");
const CREDENTIALS_PATH = join(CONFIG_DIR, "credentials.json");
export function getCredentialsPath() {
    return CREDENTIALS_PATH;
}
/**
 * Look up the saved token for a given base URL. Returns null if no
 * credentials file exists, the version is unknown, or no entry matches.
 * Never throws — callers fall back to env-var auth on null.
 */
export function getTokenForUrl(baseUrl) {
    const file = readCredentials();
    if (!file)
        return null;
    return file.tokens[normalizeUrl(baseUrl)] ?? null;
}
/**
 * Persist a token entry. Creates ~/.config/rendra/ at mode 0700 and
 * the file at 0600 — re-applies on every write so a previously
 * world-readable file gets locked down on next save.
 */
export function writeToken(baseUrl, entry) {
    const existing = readCredentials() ?? { version: 1, tokens: {} };
    const next = {
        version: 1,
        tokens: { ...existing.tokens, [normalizeUrl(baseUrl)]: entry },
    };
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    writeFileSync(CREDENTIALS_PATH, JSON.stringify(next, null, 2) + "\n", {
        mode: 0o600,
    });
    // mkdir/writeFileSync `mode` is masked by umask; chmod after to
    // guarantee the actual perms regardless of the user's umask.
    try {
        chmodSync(CREDENTIALS_PATH, 0o600);
    }
    catch {
        // Non-fatal — filesystems like exFAT don't support chmod.
    }
}
/**
 * Remove a token entry. Returns true if something was removed, false
 * if there was nothing to remove (so `logout` can surface the right
 * message).
 */
export function clearToken(baseUrl) {
    const existing = readCredentials();
    if (!existing)
        return false;
    const key = normalizeUrl(baseUrl);
    if (!(key in existing.tokens))
        return false;
    const { [key]: _removed, ...rest } = existing.tokens;
    void _removed;
    const next = { version: 1, tokens: rest };
    writeFileSync(CREDENTIALS_PATH, JSON.stringify(next, null, 2) + "\n", {
        mode: 0o600,
    });
    try {
        chmodSync(CREDENTIALS_PATH, 0o600);
    }
    catch { }
    return true;
}
function readCredentials() {
    let raw;
    try {
        raw = readFileSync(CREDENTIALS_PATH, "utf8");
    }
    catch {
        return null;
    }
    try {
        const parsed = JSON.parse(raw);
        if (typeof parsed !== "object" ||
            parsed === null ||
            parsed.version !== 1 ||
            typeof parsed.tokens !== "object") {
            return null;
        }
        return parsed;
    }
    catch {
        return null;
    }
}
function normalizeUrl(baseUrl) {
    return baseUrl.replace(/\/+$/, "");
}
