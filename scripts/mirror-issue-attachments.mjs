#!/usr/bin/env node
/**
 * Mirror drag-dropped GitHub attachments into the public R2 evidence bucket.
 *
 * A screenshot dragged into an issue lands at github.com/user-attachments/assets/<uuid>,
 * a host agent sessions cannot fetch: their GitHub proxy admits only repo-scoped API
 * paths, and GitHub exposes no repo-scoped API for attachments. So the most valuable
 * issues — the ones whose substance is an annotated screenshot — are exactly the ones
 * an agent reads blind. Actions runners have no such proxy, so this script (run by
 * mirror-issue-attachments.yml) re-hosts each attachment in the evidence bucket under
 * issue-attachments/issue-<n>/<uuid>.<ext> and rewrites the body's URLs in place.
 * The rewrite is the idempotency: a mirrored body has no user-attachments URLs left,
 * so re-running on the workflow's own `edited` event finds nothing to do.
 *
 * Reads the triggering event from GITHUB_EVENT_PATH (issue, PR, or comment — bodies
 * only; review-thread comments don't carry owner screenshots). Needs GITHUB_TOKEN plus
 * the STINT_R2_* trio upload-evidence.mjs (the upload engine, spawned) already needs.
 * An asset that cannot be fetched or exceeds upload-evidence's 5 MB Camo ceiling keeps
 * its original URL — a partial mirror beats a red run, and the log names what stayed.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIMIT = 5_000_000;
// Exactly a 36-char UUID after the fixed prefix: the char class cannot cross the `"`,
// `)`, or whitespace that ends the URL in markdown or an <img src>.
const ASSET_RE = /https:\/\/github\.com\/user-attachments\/assets\/[0-9a-fA-F-]{36}/g;

const token = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;
const eventPath = process.env.GITHUB_EVENT_PATH;
if (!token || !repo || !eventPath) {
  console.error('set GITHUB_TOKEN / GITHUB_REPOSITORY / GITHUB_EVENT_PATH (Actions provides all three)');
  process.exit(1);
}

// The comment event carries both `comment` and `issue`; check it first so the body
// patched is the comment's, not its host issue's. PRs are issues to this API, so one
// PATCH endpoint serves both, and a PR's attachments file under its shared number.
const event = JSON.parse(readFileSync(eventPath, 'utf8'));
const item = event.pull_request ?? event.issue;
const body = (event.comment ?? item)?.body ?? '';
const patchPath = event.comment
  ? `repos/${repo}/issues/comments/${event.comment.id}`
  : `repos/${repo}/issues/${item.number}`;

const assets = [...new Set(body.match(ASSET_RE) ?? [])];
if (!assets.length) {
  console.log('no user-attachments URLs in body — nothing to mirror');
  process.exit(0);
}

// Fetch each asset, following the 302 to the signed S3 URL, whose path carries the
// real extension the bare-UUID source URL lacks.
const stage = mkdtempSync(join(tmpdir(), 'mirror-attachments-'));
const staged = []; // { url, file } — files named <uuid>.<ext>, the bucket basename
for (const url of assets) {
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`SKIPPED ${url}: fetch ${res.status} — original URL kept`);
    continue;
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > LIMIT) {
    console.error(`SKIPPED ${url}: ${(bytes.length / 1e6).toFixed(1)} MB > 5 MB — original URL kept`);
    continue;
  }
  const ext = new URL(res.url).pathname.match(/\.([A-Za-z0-9]+)$/)?.[1]
    ?? res.headers.get('content-type')?.split('/')[1]?.replace(/[^a-z0-9]/gi, '')
    ?? 'bin';
  const file = join(stage, `${url.split('/').pop()}.${ext.toLowerCase()}`);
  writeFileSync(file, bytes);
  staged.push({ url, file });
}

let rewritten = body;
if (staged.length) {
  const uploader = join(dirname(fileURLToPath(import.meta.url)), 'upload-evidence.mjs');
  const prefix = `issue-attachments/issue-${item.number}`;
  const up = spawnSync('node', [uploader, prefix, ...staged.map((s) => s.file)], { encoding: 'utf8' });
  process.stderr.write(up.stderr ?? '');
  if (up.status !== 0) {
    console.error(up.stdout);
    throw new Error(`upload-evidence.mjs exited ${up.status}`);
  }
  // upload-evidence prints one public URL per file, in argument order.
  const publicUrls = up.stdout.trim().split('\n');
  staged.forEach((s, i) => {
    rewritten = rewritten.replaceAll(s.url, publicUrls[i]);
    console.log(`${s.url} -> ${publicUrls[i]}`);
  });
}

if (rewritten !== body) {
  const res = await fetch(`https://api.github.com/${patchPath}`, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'stint-mirror-issue-attachments',
    },
    body: JSON.stringify({ body: rewritten }),
  });
  if (!res.ok) throw new Error(`PATCH ${patchPath}: ${res.status} ${await res.text()}`);
  console.log(`rewrote ${patchPath}: ${staged.length} of ${assets.length} asset(s) mirrored`);
}
