import { safeLine } from "./safety.js";
/** Section ids come from the doc author, so only plain id characters reach the agent outside the untrusted block. */
function safeId(id) {
    return id.replace(/[^A-Za-z0-9_.-]/g, "?").slice(0, 64);
}
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
/** Counts only: the label and the values come from the agent or the doc, so they stay out of the trusted text. */
function proofText(proof) {
    if (!proof)
        return "";
    const n = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : 0);
    const found = n(proof.found);
    const missing = n(proof.notFound);
    if (found + missing === 0)
        return "";
    const rest = proof.truncated === true ? ", more numbers not checked" : "";
    if (missing > 0)
        return `  ·  ${plural(missing, "number")} not found in source${rest}`;
    if (rest)
        return `  ·  first ${plural(found, "number")} found in source${rest}`;
    return `  ·  ${found === 1 ? "1 number" : `all ${found} numbers`} found in source`;
}
export function formatFreshness(sections) {
    if (!sections || sections.length === 0)
        return "";
    const lines = sections.map((s) => {
        const checked = s.lastCheckedAt ? `last reviewed ${safeLine(s.lastCheckedAt, 40)}` : "never reviewed";
        const waiting = s.pendingProposals
            ? `  ·  ${s.pendingProposals} update(s) wait for review`
            : "";
        return `  #${safeId(s.sectionId)}: ${safeLine(s.state, 20)}  ·  ${checked}  ·  cadence ${safeLine(s.cadence, 40)}${waiting}${proofText(s.proof)}`;
    });
    return (`\n--- SECTION FRESHNESS ---\n` +
        `A review is an AI pass over the section or a human-approved update, not a live check against a system. ` +
        `Prefer "fresh" sections. Treat "stale", "never" and "error" sections as a guess. ` +
        `"Found in source" means the number appears in the data an agent sent with the update, not that it is true; ` +
        `treat numbers "not found in source" as unchecked. Only numbers an update added or changed are checked. ` +
        `If a section is wrong, report it with propose_doc_update.\n` +
        lines.join("\n") +
        `\n`);
}
