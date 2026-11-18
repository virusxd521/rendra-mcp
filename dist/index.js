#!/usr/bin/env node
/**
 * Rendra MCP server + CLI.
 *
 *   rendra-mcp                    start the MCP server on stdio (default).
 *                                 Spawned by Claude Desktop, Cursor, etc.
 *   rendra-mcp login              OAuth device flow; saves a token to
 *                                 ~/.config/rendra/credentials.json.
 *   rendra-mcp logout             remove the saved token for the current
 *                                 RENDRA_API_URL (or default).
 *   rendra-mcp whoami             print workspace + scopes for the token.
 *   rendra-mcp --version          print the version.
 *
 * Token resolution happens per call (see server.ts), so the server starts
 * and lists its tools even before `rendra-mcp login`.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { login, logout, whoami } from "./auth.js";
import { apiBaseUrl, VERSION } from "./config.js";
import { checkApiUrl } from "./safety.js";
import { createServer, resolveTokens } from "./server.js";
const HELP = "rendra-mcp: Model Context Protocol server for Rendra docs\n\n" +
    "Usage:\n" +
    "  rendra-mcp                start the MCP server (default; usually spawned by Claude Desktop / Cursor)\n" +
    "  rendra-mcp login          authorize this device via the browser, save a token\n" +
    "  rendra-mcp logout         remove the saved token for the current API URL\n" +
    "  rendra-mcp whoami         print workspace info for the active token\n" +
    "  rendra-mcp --version      print the version\n\n" +
    "Env:\n" +
    "  RENDRA_API_URL            backend base URL (default https://www.rendra.design)\n" +
    "  RENDRA_API_TOKEN          bearer token override (skips credentials file)\n" +
    "  RENDRA_API_TOKEN_RO       read-only bearer; set only this one for read-only mode\n";
const arg = process.argv[2];
const SUBCOMMANDS = ["login", "logout", "whoami"];
if (arg === "--version" || arg === "-v" || arg === "version") {
    process.stdout.write(`${VERSION}\n`);
    process.exit(0);
}
if (arg === "--help" || arg === "-h" || arg === "help") {
    process.stderr.write(HELP);
    process.exit(0);
}
// Unknown flags still start the server (0.2.x did); an unknown word is a typo.
if (arg !== undefined && arg.startsWith("-")) {
    process.stderr.write(`rendra-mcp: ignoring unknown option "${arg}", starting the server\n`);
}
else if (arg !== undefined && !SUBCOMMANDS.includes(arg)) {
    process.stderr.write(`rendra-mcp: unknown command "${arg}"\n\n${HELP}`);
    process.exit(1);
}
const cmd = arg !== undefined && SUBCOMMANDS.includes(arg) ? arg : undefined;
// The bearer token travels to RENDRA_API_URL, so refuse plain http
// (except localhost) before any subcommand or the server can use it.
const baseUrl = apiBaseUrl();
const urlCheck = checkApiUrl(baseUrl);
if (!urlCheck.ok) {
    console.error(`rendra-mcp: ${urlCheck.error}`);
    process.exit(1);
}
if (cmd) {
    const handler = cmd === "login" ? login : cmd === "logout" ? logout : whoami;
    handler()
        .then((code) => process.exit(code))
        .catch((err) => {
        console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
        process.exit(1);
    });
}
else {
    if (!resolveTokens(baseUrl).read) {
        // stderr only: stdout carries the JSON-RPC stream.
        console.error(`rendra-mcp: not logged in to ${baseUrl}. Tools will answer "Not logged in" until you run \`npx rendra-mcp login\`.`);
    }
    createServer({ baseUrl })
        .connect(new StdioServerTransport())
        .catch((err) => {
        console.error("rendra-mcp: fatal:", err);
        process.exit(1);
    });
}
