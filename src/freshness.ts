import type { RendraSectionFreshness } from "./api.js";

/** Section ids come from the doc author, so only plain id characters reach the agent outside the untrusted block. */
function safeId(id: string): string {
  return id.replace(/[^A-Za-z0-9_.-]/g, "?").slice(0, 64);
}

export function formatFreshness(sections?: RendraSectionFreshness[]): string {
  if (!sections || sections.length === 0) return "";
  const lines = sections.map((s) => {
    const checked = s.lastCheckedAt ? `last reviewed ${s.lastCheckedAt}` : "never reviewed";
    const waiting = s.pendingProposals
      ? `  ·  ${s.pendingProposals} update(s) wait for review`
      : "";
    return `  #${safeId(s.sectionId)}: ${s.state}  ·  ${checked}  ·  cadence ${s.cadence}${waiting}`;
  });
  return (
    `\n--- SECTION FRESHNESS ---\n` +
    `A review is an AI pass over the section or a human-approved update, not a live check against a system. ` +
    `Prefer "fresh" sections. Treat "stale", "never" and "error" sections as a guess. ` +
    `If a section is wrong, report it with propose_doc_update.\n` +
    lines.join("\n") +
    `\n`
  );
}
