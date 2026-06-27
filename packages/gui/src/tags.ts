/**
 * The pure tag-edit decision (PRD §07, §06 R1) — the diff between an entry's current
 * tags and the chip set the user edited to, extracted so it is unit-testable without an
 * Electron host. The renderer holds no business logic: it gathers the edited chips and
 * lets this function decide the minimal `addTags`/`removeTags` the `edit` patch carries
 * (Store.edit applies exactly those two lists). This mirrors toggle.ts — a pure decision
 * drives the IPC call.
 *
 * Tag identity is case-insensitive and whitespace-trimmed (the same shape core stores):
 * each side is normalised — trimmed, empties dropped, de-duplicated case-insensitively
 * keeping first-seen spelling — before the set difference. So re-typing an existing tag
 * in a different case is a no-op (it neither adds nor removes), and only genuinely new
 * names are added / genuinely dropped names removed.
 */
export interface TagDiff {
  addTags: string[];
  removeTags: string[];
}

/** Trim, drop empties, de-dupe case-insensitively (keeping the first spelling seen). */
function normalize(tags: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of tags) {
    const name = raw.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/**
 * Diff the entry's current tags (`original`) against the user's edited chip set (`next`)
 * into the minimal addTags/removeTags arrays the `edit` patch expects. Comparison is
 * case-insensitive: a tag present on both sides (any case) is untouched; a name only in
 * `next` is added (with its edited spelling); a name only in `original` is removed.
 */
export function tagDiff(original: string[], next: string[]): TagDiff {
  const before = normalize(original);
  const after = normalize(next);
  const beforeKeys = new Set(before.map((t) => t.toLowerCase()));
  const afterKeys = new Set(after.map((t) => t.toLowerCase()));
  const addTags = after.filter((t) => !beforeKeys.has(t.toLowerCase()));
  const removeTags = before.filter((t) => !afterKeys.has(t.toLowerCase()));
  return { addTags, removeTags };
}
