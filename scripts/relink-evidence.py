#!/usr/bin/env python3
"""Relink stint evidence URLs to the R2 public bucket (issue #256 migration).

Rewrites, in every issue and PR body of kdbanman/stint:
  1. raw.githubusercontent.com/kdbanman/stint/refs/heads/qa-evidence/<p>  -> R2/qa-evidence/<p>
  2. raw.githubusercontent.com/kdbanman/stint/<ref-or-sha>/acceptance/evidence/<p> -> R2/acceptance/evidence/<p>
  3. repairs sanitizer damage: a plain markdown link whose target is an R2 image
     becomes an inline image embed again ([x](R2/..png) -> ![x](R2/..png)).

Only URLs under qa-evidence/ or acceptance/evidence/ are touched; doc links
(e.g. htmlpreview of context/*.html) are left alone. Idempotent: a second run
finds nothing to change. Comments are not scanned (audited: no evidence links).

Usage (local):
  export GITHUB_TOKEN=github_pat_...
  python3 relink-evidence.py             # dry run, prints a per-body diff summary
  python3 relink-evidence.py --only 126,145   # restrict to specific numbers
  python3 relink-evidence.py --apply     # actually PATCH the bodies

(The one-shot Actions workflow that dispatched this during the #256 migration has
been removed; the script remains as the manual fallback — run it locally with a
token, or re-wrap it in a workflow_dispatch workflow if it's ever needed at scale.)
"""
import json, os, re, sys, urllib.request

OWNER, REPO = "kdbanman", "stint"
R2 = "https://pub-110c939d8c384d6c9e201e5f888c1288.r2.dev"
API = f"https://api.github.com/repos/{OWNER}/{REPO}"
TOKEN = os.environ.get("GITHUB_TOKEN") or sys.exit("set GITHUB_TOKEN")
HDRS = {"Authorization": f"Bearer {TOKEN}", "Accept": "application/vnd.github+json",
        "User-Agent": "stint-relink", "X-GitHub-Api-Version": "2022-11-28"}

RE_QA   = re.compile(r'https://raw\.githubusercontent\.com/kdbanman/stint/refs/heads/qa-evidence/([^\s"\)\]>]+)')
RE_MAIN = re.compile(r'https://raw\.githubusercontent\.com/kdbanman/stint/[^/\s]+/(acceptance/evidence/[^\s"\)\]>]+)')
RE_BANG = re.compile(r'(?<!\!)\[([^\]\n]*)\]\((' + re.escape(R2) + r'/[^\s\)]+\.(?:png|gif))\)')

def req(url, data=None, method="GET"):
    r = urllib.request.Request(url, headers=HDRS, method=method,
        data=json.dumps(data).encode() if data else None)
    with urllib.request.urlopen(r) as f:
        return json.load(f), f.headers

def all_items(kind):  # kind: "issues" (includes PRs) — one enumeration covers both
    page, out = 1, []
    while True:
        items, _ = req(f"{API}/issues?state=all&per_page=100&page={page}")
        if not items: return out
        out += items; page += 1

def rewrite(body):
    b = RE_QA.sub(lambda m: f"{R2}/qa-evidence/{m.group(1)}", body)
    b = RE_MAIN.sub(lambda m: f"{R2}/{m.group(1)}", b)
    b = RE_BANG.sub(lambda m: f"![{m.group(1)}]({m.group(2)})", b)
    return b

def main():
    apply = "--apply" in sys.argv or os.environ.get("RELINK_APPLY") == "true"
    only = None
    if os.environ.get("RELINK_ONLY", "").strip():
        only = {int(x) for x in os.environ["RELINK_ONLY"].split(",")}
    for a in sys.argv[1:]:
        if a.startswith("--only"):
            only = {int(x) for x in (a.split("=",1)[1] if "=" in a else sys.argv[sys.argv.index(a)+1]).split(",")}
    changed = 0
    for it in all_items("issues"):
        n = it["number"]
        if only and n not in only: continue
        body = it.get("body") or ""
        new = rewrite(body)
        if new == body: continue
        changed += 1
        kind = "PR" if "pull_request" in it else "issue"
        urls = len(RE_QA.findall(body)) + len(RE_MAIN.findall(body))
        bangs = len(RE_BANG.findall(body))
        print(f"{kind} #{n}: {urls} url(s) rewritten, {bangs} embed(s) repaired"
              + ("" if apply else "  [dry-run]"))
        if apply:
            ep = f"{API}/issues/{n}"   # PATCH /issues/{n} sets body for PRs too
            req(ep, {"body": new}, "PATCH")
    print(f"\n{'applied' if apply else 'would change'}: {changed} bodies")

if __name__ == "__main__":
    main()
