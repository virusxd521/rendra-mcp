/**
 * Thin client over the Rendra REST API.
 *
 * One responsibility: turn a tool call into an HTTP request and surface a
 * useful error message. No retry logic — agents that hit a transient
 * failure can call the tool again.
 */

export type Config = {
  baseUrl: string;
  token: string;
};

/** Default time a call may take before it is aborted. */
export const DEFAULT_TIMEOUT_MS = 60_000;
/** The refresh route runs a model call; the backend allows 300 s. */
export const REFRESH_TIMEOUT_MS = 310_000;

export type RendraDocSummary = {
  slug: string;
  title: string;
  subtitle: string;
  status: string;
  docType: string;
  collection: string;
  audience: string;
  ownerName: string;
  tags: string[];
  favorite: boolean;
  summary: string;
  stats: { words: number; tables: number; panels: number; readingMinutes?: number };
  lastReviewedAt: string;
  reviewDueAt: string;
  shareUrl: string;
  updatedAt: string | null;
  createdAt: string | null;
};

export type RendraSectionFreshness = {
  sectionId: string;
  cadence: string;
  lastCheckedAt: string | null;
  state: "fresh" | "stale" | "never" | "error";
  pendingProposals: number;
  proof?: {
    found: number;
    notFound: number;
    notFoundValues: string[];
    truncated?: boolean;
    label: string | null;
    fetchedAt: string | null;
  };
};

export type RendraDoc = RendraDocSummary & {
  html: string;
  sections?: RendraSectionFreshness[];
};

export class RendraApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "RendraApiError";
  }
}

export class RendraClient {
  constructor(private cfg: Config) {}

  private async req<T>(
    method: string,
    path: string,
    body?: unknown,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<T> {
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
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = text;
    }
    if (!res.ok) {
      const err =
        typeof parsed === "object" && parsed !== null && "error" in parsed
          ? (parsed as { error: string }).error
          : `HTTP ${res.status}`;
      throw new RendraApiError(res.status, err, parsed);
    }
    return parsed as T;
  }

  getWorkspace() {
    return this.req<{
      workspace: { slug: string; name: string; plan: string; createdAt: string | null };
      docs: { total: number; published: number };
      auth: { kind: string; scopes: string[] };
    }>("GET", "/api/v1/workspace");
  }

  listDocuments(params: {
    status?: string;
    type?: string;
    collection?: string;
    favorite?: boolean;
    limit?: number;
    offset?: number;
  } = {}) {
    const sp = new URLSearchParams();
    if (params.status) sp.set("status", params.status);
    if (params.type) sp.set("type", params.type);
    if (params.collection) sp.set("collection", params.collection);
    if (params.favorite) sp.set("favorite", "1");
    if (params.limit) sp.set("limit", String(params.limit));
    if (params.offset) sp.set("offset", String(params.offset));
    const qs = sp.toString();
    return this.req<{
      documents: RendraDocSummary[];
      pagination: { limit: number; offset: number; returned: number };
    }>("GET", `/api/v1/documents${qs ? `?${qs}` : ""}`);
  }

  searchDocuments(query: string, limit = 20, status = "active") {
    const sp = new URLSearchParams({ q: query, limit: String(limit), status });
    return this.req<{
      query: string;
      documents: RendraDocSummary[];
      pagination: { limit: number; returned: number };
    }>("GET", `/api/v1/documents/search?${sp.toString()}`);
  }

  getDocument(slug: string) {
    return this.req<{ document: RendraDoc }>("GET", `/api/v1/documents/${encodeURIComponent(slug)}`);
  }

  createDocument(input: {
    title: string;
    html?: string;
    subtitle?: string;
    status?: "draft" | "review" | "published" | "archived";
    docType?: "guide" | "playbook" | "policy" | "runbook" | "brief" | "spec";
    audience?: "internal" | "cross_functional" | "leadership" | "customer_facing";
    collection?: string;
    ownerName?: string;
    tags?: string[];
    accent?: "moss" | "berry" | "slate" | "ink";
  }) {
    return this.req<{ document: RendraDoc }>("POST", "/api/v1/documents", input);
  }

  updateDocument(slug: string, patch: Record<string, unknown>) {
    return this.req<{ document: RendraDoc }>(
      "PATCH",
      `/api/v1/documents/${encodeURIComponent(slug)}`,
      patch,
    );
  }

  deleteDocument(slug: string) {
    return this.req<void>("DELETE", `/api/v1/documents/${encodeURIComponent(slug)}`);
  }

  /**
   * Propose an update to one `<section data-rendra-refresh id="…">` of an
   * existing document. Does NOT change the live document — a human still
   * has to approve the proposal from Library → Suggested updates.
   */
  proposeDocumentUpdate(
    slug: string,
    input: { section_id: string; proposed_html: string; diff_summary?: string },
  ) {
    return this.req<{ ok: true; proposal_id: number }>(
      "POST",
      `/api/v1/documents/${encodeURIComponent(slug)}/propose-update`,
      input,
    );
  }

  /**
   * Trigger a server-side refresh for one section. Counterpart to the
   * cron-driven Rendra Refresh tick — runs the same worker, generates
   * one proposal. Caller may pass `source_text` to replace the section's
   * instruction, `source_data` for data the model takes numbers from, or
   * `model` to override the section's pinned model for this run only.
   */
  triggerSectionRefresh(
    slug: string,
    sectionId: string,
    input: {
      source_text?: string;
      source_title?: string;
      source_data?: string;
      source_label?: string;
      source_fetched_at?: string;
      model?: string;
    } = {},
  ) {
    return this.req<{ ok: true; proposal_id: number | null; summary: string }>(
      "POST",
      `/api/v1/documents/${encodeURIComponent(slug)}/sections/${encodeURIComponent(
        sectionId,
      )}/refresh`,
      input,
      REFRESH_TIMEOUT_MS,
    );
  }

  getDocumentPdfUrl(slug: string) {
    return `${this.cfg.baseUrl}/api/v1/documents/${encodeURIComponent(slug)}/pdf`;
  }
}
