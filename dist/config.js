import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const PACKAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
/** Single version source: package.json next to dist/ and src/. */
export const VERSION = JSON.parse(readFileSync(join(PACKAGE_DIR, "package.json"), "utf8")).version;
export const SKILLS_DIR = join(PACKAGE_DIR, "skills");
export const DEFAULT_BASE_URL = "https://www.rendra.design";
/** RENDRA_API_URL (or the default) without a trailing slash. */
export function apiBaseUrl() {
    return (process.env.RENDRA_API_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
}
