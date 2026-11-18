/**
 * `rendra-mcp` CLI auth subcommands: login / logout / whoami.
 *
 * Implements the client side of the OAuth 2.0 device authorization
 * grant (RFC 8628) against the Rendra backend's /api/v1/oauth/device/*
 * endpoints. End user runs `rendra-mcp login`, browser opens, they
 * click Authorize, the CLI polls until a token comes back, writes it
 * to `~/.config/rendra/credentials.json`. Subsequent `rendra-mcp`
 * invocations (the MCP server itself) read the credentials file so
 * the user never has to paste a token into a config file again.
 *
 * All console output goes to stderr — stdout is reserved for the MCP
 * JSON-RPC stream when the server runs. Subcommands print their own
 * messages via stderr so we don't accidentally pollute stdout if a
 * user pipes the binary somewhere.
 */
import { spawn } from "node:child_process";
import { hostname, platform, arch } from "node:os";
import { setTimeout as wait } from "node:timers/promises";
import { RendraClient, RendraApiError } from "./api.js";
import { clearToken, getCredentialsPath, getTokenForUrl, writeToken, } from "./credentials.js";
/** Keep in sync with package.json. Reported in client_meta. */
const CLI_VERSION = "0.2.0";
/** Default backend if RENDRA_API_URL is unset. */
const DEFAULT_BASE_URL = "https://www.rendra.design";
function defaultUrl() {
    return process.env.RENDRA_API_URL ?? DEFAULT_BASE_URL;
}
/** Self-reported identity shown verbatim on the authorize page. */
function clientIdentity() {
    return {
        name: `rendra-mcp on ${hostname()}`,
        meta: {
            platform: platform(),
            arch: arch(),
            version: CLI_VERSION,
        },
    };
}
/**
 * Best-effort browser open. We don't fail if `open`/`xdg-open`/`start`
 * aren't on PATH — the URL is also printed to stderr for the user to
 * click manually, which is the only path that works for SSH sessions.
 */
function openBrowser(url) {
    const cmd = process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
            ? "start"
            : "xdg-open";
    try {
        const child = spawn(cmd, [url], { detached: true, stdio: "ignore" });
        child.on("error", () => {
            // Swallow — the URL was already printed for manual use.
        });
        child.unref();
    }
    catch {
        // Same — non-fatal.
    }
}
export async function login() {
    const baseUrl = defaultUrl();
    const identity = clientIdentity();
    process.stderr.write(`rendra-mcp login (${baseUrl})\n\n`);
    // 1. Request a device_code.
    let initRes;
    try {
        initRes = await fetch(`${baseUrl}/api/v1/oauth/device/code`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                client_name: identity.name,
                client_meta: identity.meta,
            }),
        });
    }
    catch (err) {
        process.stderr.write(`Could not reach ${baseUrl}: ${err instanceof Error ? err.message : String(err)}\n`);
        return 1;
    }
    if (!initRes.ok) {
        const body = await initRes.json().catch(() => ({}));
        process.stderr.write(`Device-code request failed (${initRes.status}): ${body.error ?? "unknown"}\n`);
        return 1;
    }
    const init = (await initRes.json());
    process.stderr.write(`→ Opening ${init.verification_uri_complete}\n`);
    process.stderr.write(`  (or visit ${init.verification_uri} and enter code: ${init.user_code})\n\n`);
    process.stderr.write(`Waiting for approval (Ctrl-C to cancel)…\n`);
    openBrowser(init.verification_uri_complete);
    // 2. Poll until approved / denied / expired.
    const intervalMs = init.interval * 1000;
    const expireAt = Date.now() + init.expires_in * 1000;
    while (Date.now() < expireAt) {
        await wait(intervalMs);
        let pollRes;
        try {
            pollRes = await fetch(`${baseUrl}/api/v1/oauth/device/token`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ device_code: init.device_code }),
            });
        }
        catch {
            // Transient network error — keep trying. The TTL bounds the loop.
            continue;
        }
        if (pollRes.ok) {
            const result = (await pollRes.json());
            writeToken(baseUrl, {
                access_token: result.access_token,
                scope: result.scope,
                workspace_slug: result.workspace.slug,
                workspace_name: result.workspace.name,
                issued_at: new Date().toISOString(),
            });
            process.stderr.write(`\n✓ Authorized as workspace "${result.workspace.name}" (${result.workspace.slug})\n` +
                `  Scope: ${result.scope}\n` +
                `  Token saved to ${getCredentialsPath()} (mode 0600)\n`);
            return 0;
        }
        const body = await pollRes.json().catch(() => ({}));
        const error = body.error;
        if (error === "authorization_pending")
            continue;
        if (error === "slow_down") {
            // Spec says to bump the interval by 5s on slow_down, but a
            // simple double-sleep on the next iteration is enough.
            await wait(intervalMs);
            continue;
        }
        if (error === "access_denied") {
            process.stderr.write(`\nRequest denied. No token written.\n`);
            return 1;
        }
        if (error === "expired_token") {
            process.stderr.write(`\nDevice code expired. Run rendra-mcp login again.\n`);
            return 1;
        }
        process.stderr.write(`\nUnexpected error: ${error ?? `status ${pollRes.status}`}\n`);
        return 1;
    }
    process.stderr.write(`\nDevice code expired before approval.\n`);
    return 1;
}
export async function logout() {
    const baseUrl = defaultUrl();
    if (clearToken(baseUrl)) {
        process.stderr.write(`Removed credentials for ${baseUrl}\n`);
    }
    else {
        process.stderr.write(`No credentials found for ${baseUrl}\n`);
    }
    return 0;
}
export async function whoami() {
    const baseUrl = defaultUrl();
    // Prefer env var (matches what the MCP server does at startup).
    const envToken = process.env.RENDRA_API_TOKEN ?? process.env.RENDRA_API_TOKEN_RO;
    const fileEntry = getTokenForUrl(baseUrl);
    const token = envToken ?? fileEntry?.access_token;
    if (!token) {
        process.stderr.write(`Not logged in (no RENDRA_API_TOKEN env var and no credentials for ${baseUrl}).\n` +
            `Run 'rendra-mcp login' to authorize.\n`);
        return 1;
    }
    const api = new RendraClient({ baseUrl, token });
    try {
        const r = await api.getWorkspace();
        const source = envToken ? "env var" : `${getCredentialsPath()}`;
        process.stdout.write(JSON.stringify({
            base_url: baseUrl,
            workspace: r.workspace,
            docs: r.docs,
            auth: r.auth,
            token_source: source,
            issued_at: fileEntry?.issued_at ?? null,
        }, null, 2) + "\n");
        return 0;
    }
    catch (err) {
        if (err instanceof RendraApiError) {
            process.stderr.write(`Error: ${err.status} ${err.message}\n`);
        }
        else {
            process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
        }
        return 1;
    }
}
