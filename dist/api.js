/**
 * Thin client over the Rendra REST API.
 *
 * One responsibility: turn a tool call into an HTTP request and surface a
 * useful error message. No retry logic — agents that hit a transient
 * failure can call the tool again.
 */
/** Default time a call may take before it is aborted. */
export const DEFAULT_TIMEOUT_MS = 60_000;
/** The refresh route runs a model call; the backend allows 300 s. */
export const REFRESH_TIMEOUT_MS = 310_000;
export class RendraApiError extends Error {
    status;
    details;
    constructor(status, message, details) {
        super(message);
        this.status = status;
        this.details = details;
        this.name = "RendraApiError";
    }
}
export class RendraClient {
    cfg;
    constructor(cfg) {
        this.cfg = cfg;
    }
    async req(method, path, body, timeoutMs = DEFAULT_TIMEOUT_MS) {
        const res = await fetch(`${this.cfg.baseUrl}${path}`, {
            method,
            headers: {
                authorization: `Bearer ${this.cfg.token}`,
                ...(body !== undefined ? { "content-type": "application/json" } : {}),
                accept: "application/json",
            },
            body: body !== undefined ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (res.status === 204)
            return undefined;
        const text = await res.text();
        let parsed;
        try {
            parsed = text ? JSON.parse(text) : undefined;
        }
        catch {
            parsed = text;
        }
        if (!res.ok) {
            const err = typeof parsed === "object" && parsed !== null && "error" in parsed
                ? parsed.error
                : `HTTP ${res.status}`;
            throw new RendraApiError(res.status, err, parsed);
        }
        return parsed;
    }
    getWorkspace() {
        return this.req("GET", "/api/v1/workspace");
    }
    listDocuments(params = {}) {
        const sp = new URLSearchParams();
        if (params.status)
            sp.set("status", params.status);
        if (params.type)
            sp.set("type", params.type);
        if (params.collection)
            sp.set("collection", params.collection);
        if (params.favorite)
            sp.set("favorite", "1");
        if (params.limit)
            sp.set("limit", String(params.limit));
        if (params.offset)
            sp.set("offset", String(params.offset));
        const qs = sp.toString();
        return this.req("GET", `/api/v1/documents${qs ? `?${qs}` : ""}`);
    }
    searchDocuments(query, limit = 20, status = "active") {
        const sp = new URLSearchParams({ q: query, limit: String(limit), status });
        return this.req("GET", `/api/v1/documents/search?${sp.toString()}`);
    }
    getDocument(slug) {
        return this.req("GET", `/api/v1/documents/${encodeURIComponent(slug)}`);
    }
    createDocument(input) {
        return this.req("POST", "/api/v1/documents", input);
    }
    updateDocument(slug, patch) {
        return this.req("PATCH", `/api/v1/documents/${encodeURIComponent(slug)}`, patch);
    }
    deleteDocument(slug) {
        return this.req("DELETE", `/api/v1/documents/${encodeURIComponent(slug)}`);
    }
    /**
     * Propose an update to one `<section data-rendra-refresh id="…">` of an
     * existing document. Does NOT change the live document — a human still
     * has to approve the proposal from Library → Suggested updates.
     */
    proposeDocumentUpdate(slug, input) {
        return this.req("POST", `/api/v1/documents/${encodeURIComponent(slug)}/propose-update`, input);
    }
    /**
     * Trigger a server-side refresh for one section. Counterpart to the
     * cron-driven Rendra Refresh tick — runs the same worker, generates
     * one proposal. Caller may pass `source_text` to replace the section's
     * instruction, `source_data` for data the model takes numbers from, or
     * `model` to override the section's pinned model for this run only.
     */
    triggerSectionRefresh(slug, sectionId, input = {}) {
        return this.req("POST", `/api/v1/documents/${encodeURIComponent(slug)}/sections/${encodeURIComponent(sectionId)}/refresh`, input, REFRESH_TIMEOUT_MS);
    }
    getDocumentPdfUrl(slug) {
        return `${this.cfg.baseUrl}/api/v1/documents/${encodeURIComponent(slug)}/pdf`;
    }
}
