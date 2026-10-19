#!/usr/bin/env python3
"""Record periph's public download counts in history.json, for the stats page's charts.

GitHub only reports running totals, so this keeps the history. The "stats snapshot"
workflow runs it hourly and commits the file to the orphan branch `stats-data`, not
main, so GitHub Pages doesn't rebuild for every snapshot. The stats page reads it from
https://raw.githubusercontent.com/hiuih/periph-site/stats-data/history.json.

What is recorded, and nothing else (all of it public through the GitHub API):
  - each release asset's download_count, plus its name, size, release and upload time;
  - the repo's stars, forks and watchers;
  - which release is the latest one, and when each release was published;
  - when the website (the repo's default branch) last got a commit.

File format (v 1), kept small:
  first     unix time of the first snapshot
  checked   unix time of the last run, even when nothing changed
  releases  {tag: [published_unix, prerelease 0|1]}
  assets    [[asset_id, tag, name, size, created_unix], ...]   append-only; points use the
            position in this list as the key
  points    [[unix, {"<asset pos>": count, ...}, {"s": stars, "f": forks, "w": watchers,
            "l": latest_tag, "c": last site commit unix}], ...]
            Each point holds only the values that changed since the point before it, as
            new totals (the first point holds everything that wasn't 0). The repo dict is
            left out when none of its values changed. A run where nothing changed adds no
            point and only moves "checked".
  Points older than --hourly-days are merged into one per UTC day (that day's final
  values), so the file grows by about one small point a day in the long run.

Run it locally against the live public API (4+ requests; a token is optional):
    python3 .github/scripts/stats_snapshot.py --history /tmp/history.json
    python3 .github/scripts/stats_snapshot.py --dry-run
"""
import argparse
import datetime
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

FORMAT = 1
ABOUT = ("periph download history: snapshots of the public GitHub release download counts, "
         "written by .github/workflows/stats-snapshot.yml on main. Format: "
         ".github/scripts/stats_snapshot.py")


def say(*a):
    print(*a, flush=True)


class Api:
    def __init__(self, base, token):
        self.base, self.token, self.calls = base.rstrip("/"), token, 0

    def get(self, url):
        """GET a JSON document. Returns (data, Link header); data is None on 404."""
        if not url.startswith("http"):
            url = self.base + url
        req = urllib.request.Request(url, headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "periph-stats-snapshot",
            "X-GitHub-Api-Version": "2022-11-28",
        })
        if self.token:
            req.add_header("Authorization", "Bearer " + self.token)
        for attempt in range(3):
            self.calls += 1
            try:
                with urllib.request.urlopen(req, timeout=30) as r:
                    return json.load(r), r.headers.get("Link", "")
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    return None, ""
                if e.code >= 500 and attempt < 2:
                    time.sleep(5 * (attempt + 1))
                    continue
                body = e.read(400).decode("utf-8", "replace")
                raise SystemExit(f"GitHub API answered {e.code} for {url}: {body}")
            except (urllib.error.URLError, TimeoutError) as e:
                if attempt < 2:
                    time.sleep(5 * (attempt + 1))
                    continue
                raise SystemExit(f"can't reach {url}: {getattr(e, 'reason', e)}")

    def pages(self, url):
        out = []
        while url:
            data, link = self.get(url)
            out += data or []
            m = re.search(r'<([^>]+)>;\s*rel="next"', link or "")
            url = m.group(1) if m else None
        return out


def unix(iso):
    if not iso:
        return 0
    return int(datetime.datetime.strptime(iso, "%Y-%m-%dT%H:%M:%SZ")
               .replace(tzinfo=datetime.timezone.utc).timestamp())


def fetch(api, repo):
    """Everything one snapshot records, straight from the public API."""
    info, _ = api.get(f"/repos/{repo}")
    if info is None:
        raise SystemExit(f"repo {repo} not found")
    releases, assets = {}, {}
    for rel in api.pages(f"/repos/{repo}/releases?per_page=100"):
        if rel.get("draft"):          # the workflow token can see drafts; the public can't
            continue
        tag = rel["tag_name"]
        releases[tag] = [unix(rel.get("published_at") or rel.get("created_at")), int(bool(rel.get("prerelease")))]
        items = rel.get("assets") or []
        if len(items) >= 100:         # make sure the asset list is complete for big releases
            items = api.pages(f"/repos/{repo}/releases/{rel['id']}/assets?per_page=100")
        for a in items:
            if a.get("state", "uploaded") != "uploaded":
                continue
            assets[a["id"]] = (tag, a["name"], a["size"], unix(a.get("created_at")), a["download_count"])
    latest, _ = api.get(f"/repos/{repo}/releases/latest")
    branch = info.get("default_branch") or "main"
    head, _ = api.get(f"/repos/{repo}/commits/{branch}")   # when the website itself last changed
    committed = unix(((head or {}).get("commit") or {}).get("committer", {}).get("date"))
    meta = {"s": info.get("stargazers_count", 0), "f": info.get("forks_count", 0),
            "w": info.get("subscribers_count", 0), "l": (latest or {}).get("tag_name", ""),
            "c": committed}
    return releases, assets, meta


def empty(repo):
    return {"v": FORMAT, "about": ABOUT, "repo": repo, "first": 0, "checked": 0,
            "releases": {}, "assets": [], "points": []}


def load(path, repo):
    try:
        with open(path, encoding="utf-8") as f:
            text = f.read()
    except FileNotFoundError:
        return empty(repo)
    if not text.strip():
        return empty(repo)
    h = json.loads(text)
    if h.get("v") != FORMAT:
        raise SystemExit(f"{path}: unknown history format {h.get('v')!r}; refusing to touch it")
    for k, v in empty(repo).items():
        h.setdefault(k, v)
    return h


def current(h):
    """The latest recorded values: ({asset pos: count}, {repo stat: value})."""
    counts, meta = {}, {}
    for p in h["points"]:
        for k, v in p[1].items():
            counts[int(k)] = v
        if len(p) > 2:
            meta.update(p[2])
    return counts, meta


def downsample(points, cutoff):
    """Merge the points before `cutoff` into one per UTC day, keeping each day's final values."""
    out, day, merged = [], None, None

    def flush():
        if merged:
            out.append([merged[0], merged[1]] + ([merged[2]] if merged[2] else []))

    for p in points:
        if p[0] >= cutoff:
            flush()
            merged, day = None, None
            out.append(p)
            continue
        d = datetime.datetime.fromtimestamp(p[0], datetime.timezone.utc).date()
        if d != day:
            flush()
            merged, day = [p[0], dict(p[1]), dict(p[2]) if len(p) > 2 else {}], d
        else:
            merged[0] = p[0]
            merged[1].update(p[1])
            if len(p) > 2:
                merged[2].update(p[2])
    flush()
    return out


def record(h, releases, assets, meta, now, hourly_days):
    """Add one snapshot to the history in place. Returns a short description of what changed."""
    h["releases"].update(releases)
    pos = {a[0]: i for i, a in enumerate(h["assets"])}
    for aid, (tag, name, size, created, _) in sorted(assets.items()):
        entry = [aid, tag, name, size, created]
        if aid in pos:
            h["assets"][pos[aid]] = entry          # renamed / resized: metadata isn't history
        else:
            pos[aid] = len(h["assets"])
            h["assets"].append(entry)
    counts, last_meta = current(h)
    changes = {}
    for aid, a in assets.items():
        i, n = pos[aid], a[4]
        if counts.get(i, 0) != n:
            changes[str(i)] = n
    meta_changes = {k: v for k, v in meta.items() if last_meta.get(k) != v}
    first = not h["points"]
    if changes or meta_changes or first:
        h["points"].append([now, dict(sorted(changes.items(), key=lambda kv: int(kv[0])))]
                           + ([meta_changes] if meta_changes else []))
    if not h["first"]:
        h["first"] = now
    h["checked"] = now
    h["points"] = downsample(h["points"], now - hourly_days * 86400)
    rose = sum(max(0, assets[aid][4] - counts.get(pos[aid], 0)) for aid in assets)
    return (f"{len(changes)} asset count(s) changed (+{rose} downloads), "
            f"repo stats changed: {', '.join(sorted(meta_changes)) or 'none'}")


def save(h, path):
    text = json.dumps(h, separators=(",", ":"), ensure_ascii=True) + "\n"
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    os.replace(tmp, path)
    return len(text)


def main():
    ap = argparse.ArgumentParser(description="Snapshot public release download counts into history.json.")
    ap.add_argument("--repo", default=os.environ.get("GITHUB_REPOSITORY") or "hiuih/periph-site")
    ap.add_argument("--history", default="history.json", help="file to update (created if missing)")
    ap.add_argument("--api", default=os.environ.get("GITHUB_API_URL") or "https://api.github.com")
    ap.add_argument("--hourly-days", type=float, default=14,
                    help="keep every snapshot this many days; older ones become one per day")
    ap.add_argument("--now", type=int, help="pretend it is this unix time (tests)")
    ap.add_argument("--dry-run", action="store_true", help="fetch and report, don't write")
    o = ap.parse_args()

    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN") or ""
    api = Api(o.api, token)
    releases, assets, meta = fetch(api, o.repo)
    now = o.now or int(time.time())

    by_kind = {}
    for tag, name, size, created, n in assets.values():
        kind = ("installers" if name.endswith((".exe", ".dmg")) else
                "manifests" if name.startswith("manifest-") else
                "update files" if name.endswith(".z") else "other")
        by_kind[kind] = by_kind.get(kind, 0) + n
    say(f"{o.repo}: {len(releases)} release(s), {len(assets)} asset(s), latest {meta['l'] or '-'}, "
        f"stars {meta['s']} forks {meta['f']} watchers {meta['w']} ({api.calls} API call(s), "
        f"{'token' if token else 'no token'})")
    say("downloads: " + (", ".join(f"{k} {v}" for k, v in sorted(by_kind.items())) or "none"))

    h = load(o.history, o.repo)
    what = record(h, releases, assets, meta, now, o.hourly_days)
    if o.dry_run:
        say(f"dry run: would record {what}; {len(h['points'])} point(s); nothing written")
        return
    size = save(h, o.history)
    say(f"{o.history}: {what}; {len(h['points'])} point(s), {len(h['assets'])} asset(s), {size:,} bytes")


if __name__ == "__main__":
    sys.exit(main())
