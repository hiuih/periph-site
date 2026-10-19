/* periph stats: download and update numbers for periph, straight from GitHub.

   Data, per refresh:
     1. ONE GitHub REST call: the releases list for hiuih/periph-site, sent with If-None-Match,
        so an unchanged answer is a tiny 304 (GitHub documents 304s as not counting against the
        rate limit; the footer shows GitHub's own remaining count, so it can be checked).
     2. history.json from raw.githubusercontent.com (branch stats-data), written hourly by
        .github/workflows/stats-snapshot.yml. raw isn't rate limited like the API.
   Both are kept on this device (session + local storage), so a reload within a minute costs
   nothing and the last known numbers still show offline.

   Unlisted page behind a one-time password (remembered on this device). The counts are public
   on GitHub anyway; the password just keeps this page to yourself. */
"use strict";
(() => {
  const REPO = "hiuih/periph-site";
  const API_URL = `https://api.github.com/repos/${REPO}/releases?per_page=100`;
  const HIST_URL = `https://raw.githubusercontent.com/${REPO}/stats-data/history.json`;
  const SALT = "92f8cba20e7553cda4617f34d955efaf";
  const HASH = "a53c291ce0e419f7f54f3f09483b727eef7da0b91361dd93889cdc73a23b18ae";
  const KEY = "periph-stats-unlock";
  const K = { rel: "periph-stats-releases", hist: "periph-stats-history", seen: "periph-stats-seen", ui: "periph-stats-ui" };
  const REFRESH_MS = 120000;           // auto refresh while visible
  const FRESH_MS = 60000;              // a cached answer younger than this is used without asking again
  const GAP_MS = 20000;                // automatic refreshes (resume, focus, online) at most this often
  const HOUR = 3600e3, DAY = 86400e3;
  const TABS = ["overview", "downloads", "updates", "releases"];
  const MILESTONES = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1e6];
  const C = { win: "#d4ff3a", winU: "#8a9f2e", mac: "#8fb3ff", macU: "#4d6fbf", surface: "#121418" };

  const $ = (id) => document.getElementById(id);
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------------------------------------------------------------- storage (never trusted to work)
  const store = {
    get(k, session) { try { const v = (session ? sessionStorage : localStorage).getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
    set(k, v, session) { try { (session ? sessionStorage : localStorage).setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k, session) { try { (session ? sessionStorage : localStorage).removeItem(k); } catch (e) { /* ignore */ } },
  };

  // ---------------------------------------------------------------- formatting
  const nf = new Intl.NumberFormat("en");
  const cf = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
  const num = (x) => nf.format(Math.round(x));
  const compact = (x) => (Math.abs(x) < 10000 ? nf.format(Math.round(x)) : cf.format(x));
  const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : (many || one + "s")}`;
  function bytes(b) {
    const u = ["B", "KB", "MB", "GB", "TB", "PB"];
    let i = 0;
    b = Math.max(0, b || 0);
    while (b >= 1000 && i < u.length - 1) { b /= 1000; i++; }
    return `${i === 0 ? Math.round(b) : b < 10 ? b.toFixed(1) : Math.round(b)} ${u[i]}`;
  }
  const fDay = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });
  const fDate = new Intl.DateTimeFormat("en", { year: "numeric", month: "short", day: "numeric" });
  const fDayTime = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const fTime = new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" });
  const fMonth = new Intl.DateTimeFormat("en", { month: "short" });
  const fWeekday = new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric" });
  function ago(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 45) return "just now";
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 36) return `${h} h ago`;
    return `${Math.round(h / 24)} d ago`;
  }
  const midnight = (t) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
  const addDays = (t, n) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime(); };
  const calDays = (a, b) => Math.round((midnight(b) - midnight(a)) / DAY);
  // GitHub counts only drop if an asset is deleted, but say so honestly when they do.
  const signed = (v) => (v < 0 ? "−" : "+") + num(Math.abs(v));
  function daysAgoText(t, now) {
    const d = calDays(t, now);
    return d <= 0 ? "today" : d === 1 ? "yesterday" : `${num(d)} days ago`;
  }

  // ---------------------------------------------------------------- tiny DOM helpers
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) for (const k in props) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k === "style") el.style.cssText = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
    return el;
  }
  const SVG = "http://www.w3.org/2000/svg";
  function s(tag, attrs, parent) {
    const el = document.createElementNS(SVG, tag);
    if (attrs) for (const k in attrs) if (attrs[k] != null) el.setAttribute(k, attrs[k]);
    if (parent) parent.append(el);
    return el;
  }
  const text = (id, v) => { const el = $(id); if (el && el.textContent !== v) el.textContent = v; };

  const shown = new Map();
  function tick(el, to, fmt = num) {
    if (typeof el === "string") el = $(el);
    if (!el) return;
    const from = shown.has(el) ? shown.get(el) : 0;
    shown.set(el, to);
    if (reduce || from === to || document.hidden) { el.textContent = fmt(to); return; }
    const t0 = performance.now(), dur = Math.min(1400, 700 + Math.abs(to - from) * 4);
    const step = (t) => {
      if (shown.get(el) !== to) return;               // a newer value took over
      const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 4);
      el.textContent = fmt(from + (to - from) * e);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // ---------------------------------------------------------------- crypto
  const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const unhex = (x) => new Uint8Array(x.match(/../g).map((p) => parseInt(p, 16)));
  async function derive(pw) {
    const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
    return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: unhex(SALT), iterations: 200000 }, k, 256));
  }
  const sha256 = async (str) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str)));
  const remembered = () => { try { return localStorage.getItem(KEY) === HASH; } catch (e) { return false; } };

  // ================================================================ DATA
  const S = {
    rel: null,      // { at, etag, data: [{tag,name,pub,pre,body,url,assets:[[id,name,size,count,created]]}] }
    hist: null,     // { at, none, data: history.json }
    rate: null,     // { left, limit, reset }
    status: "loading", error: "", offline: false, model: null,
    range: 30, gran: "day", tab: "overview", boardAll: false,
  };

  function slim(rels) {
    return (Array.isArray(rels) ? rels : []).filter((r) => !r.draft).map((r) => ({
      tag: r.tag_name, name: r.name || r.tag_name, pub: Date.parse(r.published_at || r.created_at) || 0, pre: !!r.prerelease,
      body: String(r.body || "").slice(0, 3000), url: r.html_url || "",
      assets: (r.assets || []).map((a) => [a.id, a.name, a.size, a.download_count, Date.parse(a.created_at) || 0]),
    }));
  }

  function readRate(res) {
    const left = res.headers.get("x-ratelimit-remaining"), limit = res.headers.get("x-ratelimit-limit"), reset = res.headers.get("x-ratelimit-reset");
    if (left != null) S.rate = { left: +left, limit: +(limit || 60), reset: reset ? +reset * 1000 : 0 };
  }

  async function fetchReleases() {
    const cached = S.rel || store.get(K.rel, true) || store.get(K.rel);
    const headers = { Accept: "application/vnd.github+json" };
    if (cached && cached.etag && cached.data && !S.noCond) headers["If-None-Match"] = cached.etag;
    if (S.rate && S.rate.left === 0 && Date.now() < S.rate.reset) {
      const e = new Error("rate"); e.rate = true; throw e;
    }
    const opts = { headers, cache: "no-store", referrerPolicy: "no-referrer" };
    let res;
    try { res = await fetch(API_URL, opts); }
    catch (e) {
      // If-None-Match makes this a CORS preflighted request. Should that ever fail, ask once more
      // without it (a plain request, like before) and stop sending it for this visit.
      if (!headers["If-None-Match"] || navigator.onLine === false) throw e;
      delete headers["If-None-Match"];
      res = await fetch(API_URL, opts);
      S.noCond = true;
    }
    readRate(res);
    if (res.status === 304 && cached) {
      const next = { ...cached, at: Date.now() };
      saveRel(next);
      return next;
    }
    if (res.status === 403 || res.status === 429) {
      const e = new Error(`GitHub said ${res.status}`);
      e.rate = !S.rate || S.rate.left === 0 || res.status === 429;
      throw e;
    }
    if (!res.ok) throw new Error(`GitHub said ${res.status}`);
    const data = slim(await res.json());
    const next = { at: Date.now(), etag: res.headers.get("etag") || "", data };
    saveRel(next);
    return next;
  }
  function saveRel(v) {
    store.set(K.rel, v, true);
    if (!store.set(K.rel, v)) store.del(K.rel);
  }

  async function fetchHistory(force) {
    // Before the first snapshot the file doesn't exist (404). Check for it again every 10 minutes,
    // not on every refresh: the collector only runs hourly anyway.
    if (!force && S.hist && S.hist.none && Date.now() - S.hist.at < 10 * 60e3) return S.hist;
    const res = await fetch(HIST_URL, { cache: "no-cache", referrerPolicy: "no-referrer" });
    if (res.status === 404) {                         // no snapshot yet: the branch or file doesn't exist
      const v = { at: Date.now(), none: true, data: null };
      store.set(K.hist, v);
      return v;
    }
    if (!res.ok) throw new Error(`history: ${res.status}`);
    let data;
    try { data = JSON.parse(await res.text()); } catch (e) { throw new Error("history.json isn't valid JSON"); }
    if (!data || data.v !== 1 || !Array.isArray(data.points) || !Array.isArray(data.assets)) throw new Error("history.json has an unknown format");
    const v = { at: Date.now(), none: false, data };
    if (!store.set(K.hist, v)) store.del(K.hist);
    return v;
  }

  // ---------------------------------------------------------------- the model
  const verCache = new Map();
  async function versionBlobs(tags) {
    // Every release's VERSION file ("1.2.3" + CRLF on Windows, LF on macOS) is a tiny, unique blob
    // that every in-app update downloads once, so its download count is that version's update installs.
    const out = {};
    for (const tag of tags) {
      const v = String(tag).replace(/^v/i, "");
      if (!/^\d+(\.\d+)+$/.test(v)) continue;
      if (!verCache.has(tag)) {
        verCache.set(tag, await Promise.all([sha256(v + "\r\n"), sha256(v + "\n")]));
      }
      const [w, m] = verCache.get(tag);
      out[w + ".z"] = { tag, os: "win" };
      out[m + ".z"] = { tag, os: "mac" };
    }
    return out;
  }

  function classify(name, tag, vb) {
    if (/\.exe$/i.test(name)) return ["inst", "win"];
    if (/\.dmg$/i.test(name)) return ["inst", "mac"];
    if (/^manifest-win\.json$/i.test(name)) return ["man", "win"];
    if (/^manifest-mac\.json$/i.test(name)) return ["man", "mac"];
    if (/^[0-9a-f]{64}\.z$/.test(name)) { const v = vb[name]; return v && v.tag === tag ? ["ver", v.os] : ["blob", ""]; }
    if (/^p-[0-9a-f]+-[0-9a-f]+\.z$/.test(name)) return ["patch", ""];
    return ["other", ""];
  }
  function catsOf(a) {
    if (a.kind === "inst") return [[a.os === "win" ? "iw" : "im", 1], ["bi", a.size], ["r:" + a.tag, 1]];
    if (a.kind === "man") return [[a.os === "win" ? "cw" : "cm", 1], ["bm", a.size]];
    if (a.kind === "ver") return [[a.os === "win" ? "uw" : "um", 1], ["bz", a.size]];
    if (a.kind === "blob" || a.kind === "patch") return [["bz", a.size]];
    return [["bo", a.size]];
  }
  const KEYS = ["iw", "im", "cw", "cm", "uw", "um", "bi", "bm", "bz", "bo"];

  function buildAssets(rels, hist, vb) {
    const map = new Map();
    if (hist) for (const [id, tag, name, size, created] of hist.assets) map.set(id, { id, tag, name, size, created: created * 1000, live: null });
    if (rels) for (const r of rels) for (const [id, name, size, count, created] of r.assets) {
      const a = map.get(id) || { id };
      Object.assign(a, { tag: r.tag, name, size, created, live: count });
      map.set(id, a);
    }
    for (const a of map.values()) { [a.kind, a.os] = classify(a.name, a.tag, vb); a.cats = catsOf(a); a.count = 0; }
    return map;
  }

  // One step series per category: T[i] (ms) with V[key][i] = that category's running total.
  // History points first, then GitHub's live answer as the newest point.
  function buildTimeline(hist, assets, liveAt) {
    const T = [], V = {}, M = [];
    const keys = [...new Set([...KEYS, ...[...assets.values()].flatMap((a) => a.cats.map((c) => c[0]))])];
    for (const k of keys) V[k] = [];
    const cur = {}; for (const k of keys) cur[k] = 0;
    let meta = {};
    const apply = (id, n) => {
      const a = assets.get(id);
      if (!a || a.count === n) return;
      for (const [k, w] of a.cats) cur[k] += (n - a.count) * w;
      a.count = n;
    };
    const push = (t) => { T.push(t); for (const k of keys) V[k].push(cur[k]); M.push(meta); };
    const hasHist = !!(hist && hist.points.length);
    let lastHist = 0;
    if (hasHist) {
      const ids = hist.assets.map((a) => a[0]);
      for (const p of hist.points) {
        for (const k in p[1]) apply(ids[+k], p[1][k]);
        if (p[2]) meta = { ...meta, ...p[2] };
        push(p[0] * 1000);
      }
      lastHist = T[T.length - 1];
    }
    let live = false;
    if (liveAt && liveAt > lastHist) {
      for (const a of assets.values()) if (a.live != null) apply(a.id, a.live);
      live = true;
      if (T.length && liveAt - T[T.length - 1] < 60e3) { T.pop(); for (const k of keys) V[k].pop(); M.pop(); }
      push(liveAt);
    }
    return { T, V, M, hasHist, live, first: hasHist ? hist.points[0][0] * 1000 : 0, firstTracked: hasHist ? (hist.first || hist.points[0][0]) * 1000 : 0,
      checked: hasHist ? (hist.checked || 0) * 1000 : 0, end: T.length ? T[T.length - 1] : 0, nHist: hasHist ? hist.points.length : 0 };
  }
  function idxAt(tl, t) {
    let lo = 0, hi = tl.T.length - 1, ans = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (tl.T[mid] <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    return ans;
  }
  const sumAt = (tl, keys, i) => keys.reduce((s0, k) => s0 + (tl.V[k] ? tl.V[k][i] : 0), 0);
  function valueAt(tl, keys, t) { const i = idxAt(tl, t); return i < 0 ? null : sumAt(tl, keys, i); }
  const nowVal = (tl, keys) => (tl.T.length ? sumAt(tl, keys, tl.T.length - 1) : 0);

  // Change of `keys` over [from, to]. Needs history; clips to the first snapshot and says so.
  function change(tl, keys, from, to) {
    if (!tl.hasHist || to <= tl.first) return null;
    const partial = from < tl.first;
    const f = Math.max(from, tl.first);
    const a = valueAt(tl, keys, f), b = valueAt(tl, keys, Math.min(to, tl.end));
    if (a == null || b == null) return null;
    return { v: b - a, partial, from: f };
  }
  function periods(tl, keys, now) {
    const today0 = midnight(now);
    const out = {};
    out.today = change(tl, keys, today0, now);
    const yd = change(tl, keys, addDays(today0, -1), now - DAY);
    out.todayPrev = yd && !yd.partial ? yd : null;
    for (const [name, days] of [["week", 7], ["month", 30]]) {
      out[name] = change(tl, keys, now - days * DAY, now);
      const p = change(tl, keys, now - 2 * days * DAY, now - days * DAY);
      out[name + "Prev"] = p && !p.partial ? p : null;
    }
    return out;
  }

  function buckets(tl, keyGroups, gran, rangeDays, now) {
    if (!tl.hasHist) return [];
    const startAll = midnight(tl.first);
    let start = rangeDays ? addDays(midnight(now), -(rangeDays - 1)) : startAll;
    if (gran === "week") { const d = new Date(start); start = addDays(start, -((d.getDay() + 6) % 7)); }
    start = Math.max(start, gran === "week" ? addDays(startAll, -((new Date(startAll).getDay() + 6) % 7)) : startAll);
    const out = [];
    for (let b0 = start; b0 <= now; b0 = addDays(b0, gran === "week" ? 7 : 1)) {
      const b1 = addDays(b0, gran === "week" ? 7 : 1);
      if (b1 <= tl.first) continue;
      const f = Math.max(b0, tl.first), z = Math.min(b1, tl.end);
      const vals = keyGroups.map((keys) => {
        const a = valueAt(tl, keys, f), b = valueAt(tl, keys, z);
        return a == null || b == null ? 0 : Math.max(0, b - a);
      });
      out.push({ t0: b0, t1: b1, vals, partialStart: b0 < tl.first, inProgress: b1 > now });
    }
    return out;
  }

  function cumulative(tl, keyGroups, rangeDays, now) {
    if (!tl.hasHist || tl.T.length < 2) return null;
    const from = rangeDays ? Math.max(tl.first, now - rangeDays * DAY) : tl.first;
    const t = [], vs = keyGroups.map(() => []);
    const i0 = idxAt(tl, from);
    if (i0 >= 0 && tl.T[i0] < from) { t.push(from); keyGroups.forEach((k, j) => vs[j].push(sumAt(tl, k, i0))); }
    for (let i = Math.max(0, i0); i < tl.T.length; i++) {
      if (tl.T[i] < from) continue;
      t.push(tl.T[i]); keyGroups.forEach((k, j) => vs[j].push(sumAt(tl, k, i)));
    }
    if (t.length < 2) return null;
    // thin very long series to about one point per 2px of a wide chart
    const MAX = 600;
    if (t.length > MAX) {
      const step = t.length / MAX, keep = [];
      for (let i = 0; i < MAX; i++) keep.push(Math.floor(i * step));
      keep.push(t.length - 1);
      const uniq = [...new Set(keep)];
      return { t: uniq.map((i) => t[i]), vs: vs.map((v) => uniq.map((i) => v[i])) };
    }
    return { t, vs };
  }

  function releaseModel(rels, hist, assets) {
    const list = new Map();
    if (hist) for (const tag in hist.releases) list.set(tag, { tag, name: tag, pub: hist.releases[tag][0] * 1000, pre: !!hist.releases[tag][1], body: "", url: "" });
    if (rels) for (const r of rels) list.set(r.tag, { ...(list.get(r.tag) || {}), ...r });
    const out = [];
    for (const r of list.values()) {
      const m = { ...r, inst: { win: 0, mac: 0 }, instSize: { win: 0, mac: 0 }, checks: { win: 0, mac: 0 }, upd: { win: null, mac: null },
        zFiles: 0, zBytes: 0, zServed: 0, patches: 0, blobs: 0, zMax: 0, files: 0, hasUpdater: false };
      for (const a of assets.values()) {
        if (a.tag !== r.tag) continue;
        m.files++;
        if (a.kind === "inst") { m.inst[a.os] += a.count; m.instSize[a.os] = Math.max(m.instSize[a.os], a.size); }
        else if (a.kind === "man") { m.checks[a.os] += a.count; m.hasUpdater = true; }
        else if (a.kind === "ver" || a.kind === "blob" || a.kind === "patch") {
          m.zFiles++; m.zBytes += a.size; m.zServed += a.count * a.size; m.zMax = Math.max(m.zMax, a.count);
          if (a.kind === "patch") m.patches++; else m.blobs++;
          if (a.kind === "ver") m.upd[a.os] = (m.upd[a.os] || 0) + a.count;
        }
      }
      m.updKnown = m.upd.win != null || m.upd.mac != null;
      m.updEst = !m.updKnown && m.zFiles ? m.zMax : 0;     // fallback: the most-downloaded update file
      m.updTotal = (m.upd.win || 0) + (m.upd.mac || 0) + m.updEst;
      m.installs = m.inst.win + m.inst.mac;
      out.push(m);
    }
    out.sort((a, b) => a.pub - b.pub || a.tag.localeCompare(b.tag, "en", { numeric: true }));
    return out;
  }
  function launchStats(tl, r, now) {
    // A new release's installers start at 0 when it's published, so its count a day (a week) later is
    // its first-day (first-week) number, provided the history reaches that far back.
    const out = {};
    if (!r.pub) return out;
    out.perDay = r.installs / Math.max(1, (now - r.pub) / DAY);
    if (!tl.hasHist) return out;
    for (const [name, span] of [["day", DAY], ["week", 7 * DAY]]) {
      const at = r.pub + span;
      if (at < tl.first) continue;
      const v = valueAt(tl, ["r:" + r.tag], Math.min(at, tl.end));
      if (v != null) out[name] = { v, sofar: at > tl.end };
    }
    return out;
  }
  function hourOfDay(tl, keys, days, now) {
    // Each snapshot's change happened within the hour before it (the snapshot runs hourly and only
    // records a point when something changed), so file it under that hour, in local time.
    if (!tl.hasHist || tl.nHist < 2) return null;
    const from = now - days * DAY, sums = new Array(24).fill(0);
    let any = false;
    for (let i = 1; i < tl.nHist; i++) {
      const t1 = tl.T[i];
      if (t1 < from || tl.T[i - 1] < now - 14 * DAY) continue;     // older points are daily
      const d = sumAt(tl, keys, i) - sumAt(tl, keys, i - 1);
      if (d <= 0) continue;
      sums[new Date(t1 - 30 * 60e3).getHours()] += d;
      any = true;
    }
    return any ? sums : null;
  }

  async function buildModel() {
    const rels = S.rel && S.rel.data, hist = S.hist && S.hist.data;
    const tags = new Set([...(rels || []).map((r) => r.tag), ...Object.keys((hist && hist.releases) || {})]);
    const vb = await versionBlobs(tags);
    const assets = buildAssets(rels, hist, vb);
    const now = Date.now();
    const tl = buildTimeline(hist, assets, rels ? S.rel.at : 0);
    const releases = releaseModel(rels, hist, assets);
    const tot = (keys) => nowVal(tl, keys);
    const m = {
      now, tl, assets, releases, hist, rels,
      dl: tot(["iw", "im"]), win: tot(["iw"]), mac: tot(["im"]),
      checks: tot(["cw", "cm"]), checksWin: tot(["cw"]), checksMac: tot(["cm"]),
      upd: tot(["uw", "um"]), updWin: tot(["uw"]), updMac: tot(["um"]),
      bytes: { inst: tot(["bi"]), man: tot(["bm"]), z: tot(["bz"]), other: tot(["bo"]) },
      meta: tl.M.length ? tl.M[tl.M.length - 1] : null,
      latest: null,
    };
    m.updEst = releases.reduce((s0, r) => s0 + r.updEst, 0);
    m.bytes.total = m.bytes.inst + m.bytes.man + m.bytes.z + m.bytes.other;
    const pub = releases.filter((r) => !r.pre);
    m.latest = (m.meta && m.meta.l && releases.find((r) => r.tag === m.meta.l)) || pub[pub.length - 1] || releases[releases.length - 1] || null;
    m.firstUpdater = releases.find((r) => r.hasUpdater) || null;
    m.p = { dl: periods(tl, ["iw", "im"], now), ck: periods(tl, ["cw", "cm"], now), up: periods(tl, ["uw", "um"], now) };
    for (const r of releases) r.launch = launchStats(tl, r, now);
    const days = buckets(tl, [["iw", "im"]], "day", 0, now);
    m.bestDay = days.reduce((best, b) => (b.vals[0] > (best ? best.vals[0] : 0) ? b : best), null);
    return m;
  }

  // ================================================================ CHARTS
  const tip = { el: null, owner: null };
  function tipShow(owner, title, rows, total, note, x, y) {
    const el = tip.el;
    tip.owner = owner;
    el.replaceChildren();
    el.append(h("div", { class: "tt", text: title }));
    for (const r of rows) el.append(h("div", { class: "row" }, h("i", { style: `background:${r.color}` }), h("span", { text: r.name }), h("b", { text: r.value })));
    if (total) el.append(h("div", { class: "row tot" }, h("i", { style: "background:transparent" }), h("span", { text: total.name }), h("b", { text: total.value })));
    if (note) el.append(h("div", { class: "note", text: note }));
    el.hidden = false;
    const w = el.offsetWidth, hh = el.offsetHeight, vw = innerWidth;
    let left = Math.min(Math.max(10, x - w / 2), vw - w - 10);
    const minTop = $("top").getBoundingClientRect().bottom + 6;
    let top = y - hh - 14;
    if (top < minTop) top = Math.min(y + 22, innerHeight - hh - 10);
    el.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
    el.classList.add("on");
  }
  function tipHide(owner) {
    if (owner && tip.owner !== owner) return;
    tip.owner = null;
    if (tip.el) tip.el.classList.remove("on");
    document.querySelectorAll(".chart.hovering").forEach((c) => c.classList.remove("hovering"));
    document.querySelectorAll(".col-g.on").forEach((c) => c.classList.remove("on"));
    document.querySelectorAll(".chart .xh, .chart .hdot").forEach((c) => c.setAttribute("opacity", "0"));
    document.querySelectorAll(".hb-row.on").forEach((c) => c.classList.remove("on"));
  }

  function niceTicks(lo, hi, n, integer) {
    if (!(hi > lo)) hi = lo + (integer ? 1 : 1);
    const span = hi - lo;
    let step = Math.pow(10, Math.floor(Math.log10(span / n)));
    const err = (n / span) * step;
    if (err <= 0.15) step *= 10; else if (err <= 0.35) step *= 5; else if (err <= 0.75) step *= 2;
    if (integer) step = Math.max(1, Math.round(step));
    const a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step;
    const out = [];
    for (let v = a; v <= b + step / 2; v += step) out.push(Math.round(v * 1e6) / 1e6);
    return out;
  }
  function timeTicks(x0, x1, maxN) {
    const span = x1 - x0;
    const steps = [[HOUR, "h"], [3 * HOUR, "h"], [6 * HOUR, "h"], [12 * HOUR, "h"], [DAY, "d"], [2 * DAY, "d"], [7 * DAY, "d"], [14 * DAY, "d"], [30 * DAY, "m"], [91 * DAY, "m"]];
    let st = steps[steps.length - 1];
    for (const c of steps) if (span / c[0] <= maxN) { st = c; break; }
    const out = [];
    if (st[1] === "h") {
      const hrs = st[0] / HOUR;
      const d = new Date(x0); d.setMinutes(0, 0, 0);
      let t = d.getTime();
      while (t < x0 || new Date(t).getHours() % hrs) t += HOUR;
      for (; t <= x1; t += st[0]) out.push([t, new Date(t).getHours() === 0 ? fDay.format(t) : fTime.format(t)]);
    } else if (st[1] === "d") {
      const days = Math.round(st[0] / DAY);
      let t = midnight(x0); if (t < x0) t = addDays(t, 1);
      for (; t <= x1; t = addDays(t, days)) out.push([t, fDay.format(t)]);
    } else {
      const months = st[0] > 60 * DAY ? 3 : 1;
      const d = new Date(x0); let t = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
      for (; t <= x1; t = new Date(new Date(t).getFullYear(), new Date(t).getMonth() + months, 1).getTime()) out.push([t, fMonth.format(t)]);
    }
    return out;
  }
  function roundedTop(x, y, w, hgt, r) {
    r = Math.min(r, w / 2, hgt);
    if (hgt <= 0) return "";
    return `M${x},${y + hgt}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + hgt}Z`;
  }
  const yLabelWidth = (labels) => Math.max(...labels.map((l) => l.length)) * 6.6 + 10;

  const ro = new ResizeObserver((entries) => {
    for (const e of entries) {
      const host = e.target, w = Math.round(e.contentRect.width);
      if (w === 0) host._w = 0;
      else if (w !== host._w) { host._w = w; drawChart(host); }
    }
  });
  function setChart(host, spec) {
    host._spec = spec;
    if (!host._observed) { ro.observe(host); host._observed = true; }
    if (host.clientWidth > 0) { host._w = Math.round(host.clientWidth); drawChart(host); }
  }
  function drawChart(host) {
    const sp = host._spec;
    if (!sp) return;
    tipHide(host);
    if (sp.kind === "line") drawLine(host, sp); else drawBars(host, sp);
    host._drawn = true;
  }
  function emptyBox(title, body) { return h("div", { class: "empty" }, h("div", null, h("b", { text: title }), body)); }

  // Index-based hover: crosshair/column under the pointer, keyboard arrows, tap on touch.
  function interact(host, svg, n, xAt, show) {
    let cur = -1, down = false;
    const pick = (clientX) => {
      const r = svg.getBoundingClientRect(), x = clientX - r.left;
      let best = 0, bd = Infinity;
      for (let i = 0; i < n; i++) { const d = Math.abs(xAt(i) - x); if (d < bd) { bd = d; best = i; } }
      return best;
    };
    const set = (i, ev) => { cur = i; host.classList.add("hovering"); show(i, ev); };
    svg.addEventListener("pointerdown", (e) => { down = true; set(pick(e.clientX), e); });
    svg.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse" || down) { const i = pick(e.clientX); if (i !== cur || e.pointerType !== "mouse") set(i, e); } });
    const up = () => { down = false; };
    svg.addEventListener("pointerup", up); svg.addEventListener("pointercancel", up);
    svg.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") { cur = -1; tipHide(host); } });
    svg.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        set(Math.max(0, Math.min(n - 1, (cur < 0 ? n - 1 : cur) + (e.key === "ArrowRight" ? 1 : -1))), null);
      } else if (e.key === "Home" || e.key === "End") { e.preventDefault(); set(e.key === "Home" ? 0 : n - 1, null); }
      else if (e.key === "Escape") { cur = -1; tipHide(host); }
    });
    svg.addEventListener("focus", () => set(cur < 0 ? n - 1 : cur, null));
    svg.addEventListener("blur", () => { cur = -1; tipHide(host); });
  }

  function drawLine(host, sp) {
    host.replaceChildren();
    const data = sp.data;
    if (!data) { host.append(emptyBox(sp.emptyTitle, sp.emptyText)); return; }
    const W = host._w, H = W < 560 ? 196 : 250;
    const all = data.vs.flat();
    const ticks = niceTicks(sp.zero === false ? Math.min(...all) : 0, Math.max(...all, sp.minMax || 1), W < 560 ? 3 : 4, !sp.bytes);
    const fmtY = sp.bytes ? bytes : compact;
    const m = { l: yLabelWidth(ticks.map(fmtY)), r: 10, t: 12, b: 26 };
    const x0 = data.t[0], x1 = data.t[data.t.length - 1], y0 = ticks[0], y1 = ticks[ticks.length - 1];
    const X = (t) => m.l + ((t - x0) / (x1 - x0 || 1)) * (W - m.l - m.r);
    const Y = (v) => m.t + (1 - (v - y0) / (y1 - y0 || 1)) * (H - m.t - m.b);
    const svg = s("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img", tabindex: 0, "aria-label": sp.label });
    const id = "c" + Math.random().toString(36).slice(2, 8);
    const defs = s("defs", null, svg);
    const clip = s("clipPath", { id: id + "k" }, defs);
    s("rect", { x: m.l, y: 0, width: W - m.l - m.r + 6, height: H, class: host._drawn || reduce ? null : "reveal" }, clip);
    const g = s("g", null, svg);
    for (const v of ticks) {
      s("line", { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), class: v === y0 ? "base" : "gl" }, g);
      s("text", { x: m.l - 8, y: Y(v) + 3.5, "text-anchor": "end" }, g).textContent = fmtY(v);
    }
    const tt = timeTicks(x0, x1, Math.max(2, Math.floor((W - m.l - m.r) / 64)));
    for (const [t, label] of tt) {
      const x = X(t);
      if (x < m.l + 14 || x > W - m.r - 14) continue;
      s("text", { x, y: H - 7, "text-anchor": "middle" }, g).textContent = label;
    }
    const plot = s("g", { "clip-path": `url(#${id}k)` }, svg);
    data.vs.forEach((vals, j) => {
      const ser = sp.series[j];
      let d = "";
      vals.forEach((v, i) => { d += (i ? "L" : "M") + X(data.t[i]).toFixed(1) + "," + Y(v).toFixed(1); });
      if (sp.area !== false) s("path", { d: `${d}L${X(x1).toFixed(1)},${Y(y0)}L${X(x0).toFixed(1)},${Y(y0)}Z`, fill: ser.color, "fill-opacity": 0.1 }, plot);
      s("path", { d, fill: "none", stroke: ser.color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, plot);
    });
    data.vs.forEach((vals, j) => {
      s("circle", { cx: X(x1), cy: Y(vals[vals.length - 1]), r: 4, fill: sp.series[j].color, stroke: C.surface, "stroke-width": 2, class: host._drawn || reduce ? null : "fade" }, svg);
    });
    const xh = s("line", { x1: 0, x2: 0, y1: m.t, y2: H - m.b, class: "xh", opacity: 0 }, svg);
    const dots = data.vs.map((_, j) => s("circle", { r: 4.5, fill: sp.series[j].color, stroke: C.surface, "stroke-width": 2, class: "hdot", opacity: 0 }, svg));
    s("rect", { x: m.l, y: 0, width: W - m.l - m.r, height: H, fill: "transparent" }, svg);
    host.append(svg);
    interact(host, svg, data.t.length, (i) => X(data.t[i]), (i, ev) => {
      const x = X(data.t[i]);
      xh.setAttribute("x1", x); xh.setAttribute("x2", x); xh.setAttribute("opacity", 1);
      let topY = H;
      dots.forEach((d, j) => { const y = Y(data.vs[j][i]); topY = Math.min(topY, y); d.setAttribute("cx", x); d.setAttribute("cy", y); d.setAttribute("opacity", 1); });
      const r = svg.getBoundingClientRect();
      const rows = sp.series.map((ser, j) => ({ name: ser.name, color: ser.color, value: (sp.bytes ? bytes : num)(data.vs[j][i]) }));
      const total = sp.total ? { name: "Total", value: num(data.vs.reduce((a, v) => a + v[i], 0)) } : null;
      const isNow = i === data.t.length - 1 && sp.nowLive;
      const y = ev && ev.pointerType === "touch" ? Math.min(ev.clientY, r.top + topY) : r.top + topY;
      tipShow(host, (isNow ? "Now · " : "") + fDayTime.format(data.t[i]), rows, total, null, r.left + x, y);
    });
  }

  function drawBars(host, sp) {
    host.replaceChildren();
    const bs = sp.buckets;
    if (!bs || !bs.length) { host.append(emptyBox(sp.emptyTitle, sp.emptyText)); return; }
    const W = host._w, H = W < 560 ? 196 : 250;
    const totals = bs.map((b) => b.vals.reduce((a, v) => a + v, 0));
    const ticks = niceTicks(0, Math.max(...totals, 1), W < 560 ? 3 : 4, true);
    const m = { l: yLabelWidth(ticks.map(compact)), r: 6, t: 12, b: 26 };
    const y1 = ticks[ticks.length - 1];
    const Y = (v) => m.t + (1 - v / (y1 || 1)) * (H - m.t - m.b);
    const band = (W - m.l - m.r) / bs.length;
    const bw = Math.max(2, Math.min(24, band * 0.62));
    const X = (i) => m.l + band * i + band / 2;
    const svg = s("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img", tabindex: 0, "aria-label": sp.label });
    const g = s("g", null, svg);
    for (const v of ticks) {
      s("line", { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), class: v === 0 ? "base" : "gl" }, g);
      s("text", { x: m.l - 8, y: Y(v) + 3.5, "text-anchor": "end" }, g).textContent = compact(v);
    }
    const labelEvery = Math.max(1, Math.ceil(bs.length / Math.max(1, Math.floor((W - m.l) / (sp.wideLabels ? 64 : 52)))));
    const highlight = s("rect", { y: m.t, height: H - m.t - m.b, width: band, class: "band", opacity: 0 }, svg);
    const cols = bs.map((b, i) => {
      const cg = s("g", { class: "col-g" + (b.partialStart || b.inProgress ? " partial-g" : "") }, svg);
      let acc = 0;
      const segs = b.vals.map((v, j) => ({ v, j })).filter((x) => x.v > 0);
      segs.forEach((seg, k) => {
        const yTop = Y(acc + seg.v), yBot = Y(acc);
        const gap = k > 0 ? 2 : 0;
        const hgt = Math.max(0, yBot - yTop - gap);
        const last = k === segs.length - 1;
        const d = last ? roundedTop(X(i) - bw / 2, yTop, bw, hgt, 4) : `M${X(i) - bw / 2},${yTop}h${bw}v${hgt}h${-bw}Z`;
        if (d) s("path", { d, fill: sp.series[seg.j].color, class: (host._drawn || reduce ? "" : "grow") + (b.partialStart ? " partial" : ""), style: host._drawn || reduce ? null : `animation-delay:${Math.min(i * 18, 500)}ms` }, cg);
        acc += seg.v;
      });
      if (sp.labelBars && totals[i] > 0) {
        const t = s("text", { x: X(i), y: Y(totals[i]) - 6, "text-anchor": "middle", style: "fill:#c9cdd3;font-weight:600" }, cg);
        t.textContent = compact(totals[i]);
      }
      if (sp.allLabels ? !!b.label : i % labelEvery === 0 || bs.length <= 8) {
        const t = s("text", { x: X(i), y: H - 7, "text-anchor": "middle" }, g);
        t.textContent = b.label != null ? b.label : fDay.format(b.t0);
      }
      return cg;
    });
    s("rect", { x: m.l, y: 0, width: W - m.l - m.r, height: H, fill: "transparent" }, svg);
    host.append(svg);
    interact(host, svg, bs.length, X, (i, ev) => {
      cols.forEach((c, k) => c.classList.toggle("on", k === i));
      highlight.setAttribute("x", X(i) - band / 2); highlight.setAttribute("opacity", 1);
      const b = bs[i], r = svg.getBoundingClientRect();
      const rows = sp.series.map((ser, j) => ({ name: ser.name, color: ser.color, value: num(b.vals[j]) }));
      const total = sp.series.length > 1 ? { name: "Total", value: num(totals[i]) } : null;
      const note = b.note || (b.partialStart ? `Partial: history starts ${fDayTime.format(sp.first)}` : b.inProgress ? "So far (still in progress)" : null);
      const title = b.title || (sp.gran === "week" ? `Week of ${fDay.format(b.t0)}` : fWeekday.format(b.t0));
      const yTop = r.top + Y(totals[i]);
      tipShow(host, title, rows, total, note, r.left + X(i), ev && ev.pointerType === "touch" ? Math.min(ev.clientY, yTop) : yTop);
    });
  }

  function sparkline(host, data, color = C.win) {
    host.querySelectorAll("svg").forEach((x) => x.remove());
    if (!data || data.t.length < 2) return;
    const W = host.clientWidth || 600, H = host.clientHeight || 120;
    const v = data.vs[0], lo = Math.min(...v), hi = Math.max(...v);
    const x0 = data.t[0], x1 = data.t[data.t.length - 1];
    const X = (t) => ((t - x0) / (x1 - x0 || 1)) * W;
    const Y = (n) => H - 6 - ((n - lo) / (hi - lo || 1)) * (H * 0.72);
    let d = "";
    v.forEach((n, i) => { d += (i ? "L" : "M") + X(data.t[i]).toFixed(1) + "," + Y(n).toFixed(1); });
    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none" });
    const defs = s("defs", null, svg);
    const gid = "sf" + host.id;
    const lg = s("linearGradient", { id: gid, x1: 0, x2: 0, y1: 0, y2: 1 }, defs);
    s("stop", { offset: 0, "stop-color": color, "stop-opacity": 0.16 }, lg);
    s("stop", { offset: 1, "stop-color": color, "stop-opacity": 0 }, lg);
    s("path", { d: `${d}L${W},${H}L0,${H}Z`, fill: `url(#${gid})` }, svg);
    s("path", { d, fill: "none", stroke: color, "stroke-opacity": 0.6, "stroke-width": 2, "vector-effect": "non-scaling-stroke" }, svg);
    host.prepend(svg);
  }

  // ================================================================ RENDER
  function tagEl(el, kind, label) { el.className = "tag " + kind; el.textContent = label; }
  function keysEl(host, items) {
    host.replaceChildren(...items.map((it) => h("span", { class: "key" }, h("i", { class: it.line ? "line" : null, style: `background:${it.color}` }), it.name, it.value != null ? h("b", { text: it.value }) : null)));
  }
  function deltaEl(cur, prev, prevName) {
    if (!cur) return h("span", { class: "flat", text: "starts with the first snapshot" });
    if (cur.partial) return h("span", { class: "flat", text: `since ${fDay.format(cur.from)}, when history starts` });
    if (!prev) return h("span", { class: "flat", text: `${prevName}: not enough history yet` });
    const d = cur.v - prev.v;
    if (d === 0) return h("span", { class: "flat", text: `= same as ${prevName} (${num(prev.v)})` });
    return h("span", null, h("span", { class: d > 0 ? "up" : "down", text: `${d > 0 ? "▲" : "▼"} ${num(Math.abs(d))}` }), ` vs ${prevName} (${num(prev.v)})`);
  }
  function tile(label, value, sub, opts = {}) {
    const val = h("div", { class: "val" });
    const el = h("article", { class: "card tile" + (opts.cls ? " " + opts.cls : "") },
      h("div", { class: "label" }, opts.sw ? h("i", { class: "sw " + opts.sw }) : null, label),
      val, h("div", { class: "delta" }, sub));
    if (typeof value === "number") { val.textContent = (opts.fmt || num)(shown.get(opts.key) ?? 0); el._tick = () => tick(val, value, opts.fmt || num); }
    else { val.textContent = value; }
    if (opts.unit) val.append(h("small", { text: opts.unit }));
    return el;
  }
  function fillTiles(host, tiles) {
    // keep the tickers smooth across refreshes: start each number from what was on screen
    const old = [...host.querySelectorAll(".val")].map((v) => shown.get(v));
    host.replaceChildren(...tiles);
    tiles.forEach((t, i) => {
      t.style.setProperty("--i", i);
      const v = t.querySelector(".val");
      if (old[i] != null && v) shown.set(v, old[i]);
      if (t._tick) t._tick();
    });
  }

  function renderOverview(m) {
    tick("total", m.dl);
    tagEl($("hero-tag"), m.tl.live ? "live" : "hist", m.tl.live ? "live" : "last known");
    const chips = [];
    if (m.p.dl.today) chips.push(h("span", { class: "chip" }, h("b", { text: signed(m.p.dl.today.v) }), m.p.dl.today.partial ? "since tracking began" : "today"));
    if (m.p.dl.week && !m.p.dl.week.partial) chips.push(h("span", { class: "chip" }, h("b", { text: signed(m.p.dl.week.v) }), "in 7 days"));
    if (S.sinceLast > 0) chips.push(h("span", { class: "chip new" }, h("b", { text: `+${num(S.sinceLast)}` }), "since your last look"));
    if (!m.tl.hasHist) chips.push(h("span", { class: "chip dim", text: "no history yet" }));
    $("hero-chips").replaceChildren(...chips);
    const sp = cumulative(m.tl, [["iw", "im"]], 30, m.now);
    sparkline($("spark"), sp);
    text("spark-cap", sp ? (m.now - sp.t[0] > 29 * DAY ? "last 30 days" : `since ${fDay.format(sp.t[0])}`) : "trend starts with the first snapshot");
    $("spark").classList.toggle("wait", !sp);
    const rc = m.releases.length;
    text("hero-sub", `Windows and macOS installers · ${plural(rc, "release")}${m.latest ? ` · latest ${m.latest.tag}` : ""}`);

    tick("win", m.win); tick("mac", m.mac);
    const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : "—");
    text("winp", `${pct(m.win, m.dl)} of downloads`);
    text("macp", `${pct(m.mac, m.dl)} of downloads`);
    setShare("bw", "bm", m.win, m.mac);
    sparkline($("spark-win"), cumulative(m.tl, [["iw"]], 30, m.now), C.win);
    sparkline($("spark-mac"), cumulative(m.tl, [["im"]], 30, m.now), C.mac);
    const rw = change(m.tl, ["iw"], m.now - 7 * DAY, m.now), rm = change(m.tl, ["im"], m.now - 7 * DAY, m.now);
    text("share-recent", rw && rm && rw.v + rm.v > 0
      ? `${rw.partial ? `Since ${fDay.format(rw.from)}` : "Last 7 days"}: Windows ${Math.round((rw.v / (rw.v + rm.v)) * 100)}% · macOS ${Math.round((rm.v / (rw.v + rm.v)) * 100)}% of ${num(rw.v + rm.v)} new downloads`
      : m.tl.hasHist ? "No new downloads in the last 7 days." : "The recent split appears once there's some history.");
    $("lw").replaceChildren("Windows ", h("b", { text: num(m.win) }));
    $("lm").replaceChildren("macOS ", h("b", { text: num(m.mac) }));

    const pd = m.p.dl;
    fillTiles($("ov-periods"), [
      tile("Today", pd.today ? pd.today.v : "—", deltaEl(pd.today, pd.todayPrev, "same time yesterday")),
      tile("7 days", pd.week ? pd.week.v : "—", deltaEl(pd.week, pd.weekPrev, "the 7 days before")),
      tile("30 days", pd.month ? pd.month.v : "—", deltaEl(pd.month, pd.monthPrev, "the 30 days before")),
      tile("Update checks today", m.p.ck.today ? m.p.ck.today.v : "—",
        m.p.ck.today ? deltaEl(m.p.ck.today, m.p.ck.todayPrev, "same time yesterday") : h("span", { class: "flat", text: `${num(m.checks)} in total, all time` })),
    ]);

    renderMilestone(m);
    renderFacts(m);
    renderCollector(m);
    renderBudget();
  }

  function setShare(wId, mId, w, mac) {
    const t = w + mac, bar = $(wId).parentElement, gap = bar.clientWidth ? 2 / bar.clientWidth : 0.005;
    const sw = t ? w / t : 0, sm = t ? mac / t : 0;
    $(wId).style.transform = `scaleX(${t ? Math.max(0, sw - (sm ? gap / 2 : 0)) : 0})`;
    $(mId).style.transform = `scaleX(${t ? Math.max(0, sm - (sw ? gap / 2 : 0)) : 0})`;
  }

  function renderMilestone(m) {
    const total = m.dl;
    const next = MILESTONES.find((x) => x > total) || total + 1;
    const prev = [...MILESTONES].reverse().find((x) => x <= total) || 0;
    $("ms-next").replaceChildren(h("b", { text: num(next - total) }), ` to go until ${num(next)} downloads`);
    $("ms-fill").style.transform = `scaleX(${Math.max(0.02, Math.min(1, (total - prev) / (next - prev || 1)))})`;
    text("ms-from", num(prev)); text("ms-to", num(next));
    // pace from the last 7 days of history (an estimate, said so)
    const wk = m.p.dl.week;
    let eta = "";
    if (wk && wk.v > 0) {
      const days = Math.max(1, (m.tl.end - wk.from) / DAY), pace = wk.v / days, left = next - total;
      const d = Math.ceil(left / pace);
      eta = `≈ ${d <= 1 ? "within a day" : `${num(d)} days`} at the recent pace (${pace >= 10 ? num(pace) : pace.toFixed(1)} a day over ${days >= 6.5 ? "7 days" : `${days.toFixed(1)} days`}). That's an estimate, not a promise.`;
    } else if (m.tl.hasHist) eta = "No new downloads in the last 7 days to work out a pace from.";
    else eta = "A pace estimate appears once there's some history.";
    text("ms-eta", eta);
    const items = [];
    const reached = MILESTONES.filter((x) => x <= total);
    for (const x of reached.slice(-4)) {
      let when = "";
      if (m.tl.hasHist) {
        const i = m.tl.T.findIndex((_, k) => sumAt(m.tl, ["iw", "im"], k) >= x);
        when = i <= 0 ? " · before tracking" : ` · ${fDay.format(m.tl.T[i])}`;
      }
      items.push(h("li", { class: "done", text: `${num(x)}${when}` }));
    }
    MILESTONES.filter((x) => x > total).slice(0, 2).forEach((x, i) => items.push(h("li", { class: i === 0 ? "next" : null, text: num(x) })));
    $("ms-list").replaceChildren(...items);
    const cn = MILESTONES.find((x) => x > m.checks) || m.checks + 1, cp = [...MILESTONES].reverse().find((x) => x <= m.checks) || 0;
    tick("ms2-now", m.checks);
    text("ms2-next", `${num(cn - m.checks)} to go until ${num(cn)}`);
    $("ms2-fill").style.transform = `scaleX(${Math.max(0.02, Math.min(1, (m.checks - cp) / (cn - cp || 1)))})`;
  }

  function renderFacts(m) {
    const rows = [];
    const add = (dt, dd, sub, dsub) => rows.push(h("dt", null, dt, sub ? h("small", { text: sub }) : null), h("dd", null, dd, dsub ? h("small", { text: dsub }) : null));
    if (m.latest) add("Latest version", m.latest.tag, null, m.latest.pub ? `${fDate.format(m.latest.pub)} · ${daysAgoText(m.latest.pub, m.now)}` : null);
    add("Update checks, all time", num(m.checks), "manifest downloads (app activity)", `Windows ${num(m.checksWin)} · macOS ${num(m.checksMac)}`);
    add("Updates installed", num(m.upd + m.updEst) + (m.updEst ? " ≈" : ""), "in-app updates", m.upd || m.updEst ? `Windows ${num(m.updWin)} · macOS ${num(m.updMac)}${m.updEst ? ` · ≈${num(m.updEst)} unattributed` : ""}` : "none yet");
    add("Data served", bytes(m.bytes.total), "downloads × file size");
    if (m.bestDay) add("Best day", num(m.bestDay.vals[0]), "most downloads in one day", `${fWeekday.format(m.bestDay.t0)}${m.bestDay.partialStart ? " (partial)" : m.bestDay.inProgress ? " (today)" : ""}`);
    if (m.meta && m.meta.s != null) add("GitHub stars", num(m.meta.s), "periph-site, from the last snapshot", `${plural(m.meta.f || 0, "fork")} · ${plural(m.meta.w || 0, "watcher")}`);
    else add("GitHub stars", "—", "recorded by the snapshots");
    if (m.meta && m.meta.c) add("Website updated", daysAgoText(m.meta.c * 1000, m.now), "last commit to periph-site", fDayTime.format(m.meta.c * 1000));
    $("facts").replaceChildren(...rows);
  }

  function renderCollector(m) {
    const el = $("col");
    const hs = S.hist;
    let orb = "wait", title, body, extra = null;
    if (!hs) { title = "Loading history…"; body = "Fetching the snapshot file."; }
    else if (hs.none || !m.tl.hasHist) {
      title = "History starts at the first snapshot";
      body = "GitHub only reports running totals. A small GitHub Action records them every hour on the stats-data branch. Charts, daily numbers and trends appear here after its first run. Until then, everything on this page is the live total.";
      extra = h("div", { class: "dots", "aria-hidden": "true" }, ...Array.from({ length: 12 }, () => h("i")));
    } else {
      const age = m.now - m.tl.checked;
      orb = age > 3 * HOUR ? "warn" : "ok";
      title = `${plural(m.tl.nHist, "snapshot")} since ${fDate.format(m.tl.firstTracked)}`;
      body = `Last snapshot ${ago(age)} (${fDayTime.format(m.tl.checked)}). The snapshot runs about hourly and only records a point when something changed. Points older than two weeks are merged to one per day.`;
      if (age > 3 * HOUR) body += " It hasn't run for a while: check the repo's Actions tab, because GitHub pauses scheduled workflows in repos without recent activity.";
      const kb = S.histBytes ? ` · ${bytes(S.histBytes)}` : "";
      extra = h("p", { class: "sub", text: `stats-data/history.json${kb} · ${plural(m.hist.assets.length, "file")} tracked` });
    }
    el.replaceChildren(h("div", { class: "col" }, h("div", { class: "orb " + orb }, h("i")), h("div", null, h("div", { class: "label", text: "History" }), h("h2", { text: title }), h("p", { text: body }), extra)));
    if (S.hist && S.hist.error) el.querySelector("p").append(` (Couldn't refresh it: ${S.hist.error}.)`);
  }

  function renderBudget() {
    const r = S.rate;
    let t = "GitHub API: one request per refresh, about every 2 minutes while open. It's sent with an ETag, so an unchanged answer is a tiny 304.";
    if (r) t += ` GitHub says ${num(r.left)} of ${num(r.limit)} left this hour for this network${r.reset ? `, resetting at ${fTime.format(r.reset)}` : ""}.`;
    t += " History comes from raw.githubusercontent.com, which doesn't use API requests.";
    text("budget", t);
  }

  function rangeLabel(days) { return days ? `last ${days} days` : "all time"; }
  function coverText(m) {
    if (!m.tl.hasHist) return "History starts at the first snapshot.";
    return `History since ${fDayTime.format(m.tl.firstTracked)} · last snapshot ${ago(m.now - m.tl.checked)}`;
  }

  function renderDownloads(m) {
    text("dl-cover", coverText(m));
    const tl = m.tl, R = S.range;
    const ch = (keys) => change(tl, keys, R ? m.now - R * DAY : 0, m.now);
    const cw = ch(["iw"]), cm = ch(["im"]), ca = ch(["iw", "im"]);
    const sub = (c) => (c ? (c.partial ? `since ${fDay.format(c.from)}` : rangeLabel(R)) : "needs history");
    fillTiles($("dl-tiles"), [
      tile("All time", m.dl, `${num(m.win)} Windows · ${num(m.mac)} macOS`),
      tile(R ? `${R} days` : "Since tracking", ca ? ca.v : "—", sub(ca)),
      tile("Windows", cw ? cw.v : "—", sub(cw), { sw: "sw-win" }),
      tile("macOS", cm ? cm.v : "—", sub(cm), { sw: "sw-mac" }),
    ]);

    const series = [{ name: "Windows", color: C.win }, { name: "macOS", color: C.mac }];
    keysEl($("lg-cum"), [{ ...series[0], line: true, value: num(m.win) }, { ...series[1], line: true, value: num(m.mac) }]);
    const cum = cumulative(tl, [["iw"], ["im"]], R, m.now);
    setChart($("ch-cum"), { kind: "line", data: cum, series, total: true, nowLive: tl.live, label: `Cumulative installer downloads, ${rangeLabel(R)}. Windows ${num(m.win)}, macOS ${num(m.mac)}.`,
      emptyTitle: tl.hasHist ? "One snapshot so far" : "History starts at the first snapshot",
      emptyText: tl.hasHist ? "The line appears once there are two points in this range. Try All, or check back in an hour." : "The hourly snapshot hasn't run yet. Today's live totals are above." });
    text("note-cum", tl.hasHist ? "Each point is an hourly snapshot (daily after two weeks), and the last one is GitHub's live answer. Downloads between two snapshots show up at the later one." : "");

    const bs = buckets(tl, [["iw"], ["im"]], S.gran, R || 0, m.now);
    keysEl($("lg-bars"), series.map((x) => ({ ...x })));
    setChart($("ch-bars"), { kind: "bars", buckets: bs, series, gran: S.gran, first: tl.first, label: `New downloads per ${S.gran}, ${rangeLabel(R)}.`,
      emptyTitle: "History starts at the first snapshot", emptyText: "Per-day and per-week numbers need at least one snapshot." });
    $("gran").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.gran === S.gran)));
    fillTable($("tbl-bars"), [S.gran === "week" ? "Week of" : "Day", "Windows", "macOS", "Total"],
      bs.slice().reverse().map((b) => [fDay.format(b.t0) + (b.partialStart ? " (partial)" : b.inProgress ? " (so far)" : ""), num(b.vals[0]), num(b.vals[1]), num(b.vals[0] + b.vals[1])]));

    // data served
    tick("bytes-total", m.bytes.total, bytes);
    const parts = [
      ["Installers", m.bytes.inst, "win", `${num(m.dl)} downloads`],
      ["In-app update files", m.bytes.z, "mac", "blobs and patches"],
      ["Update checks", m.bytes.man, "any", `${num(m.checks)} manifest downloads`],
    ];
    if (m.bytes.other) parts.push(["Other files", m.bytes.other, "any", ""]);
    const maxB = Math.max(...parts.map((p) => p[1]), 1);
    $("bytes-split").replaceChildren(...parts.map(([name, b, cls, note]) => {
      const bar = h("div", { class: "bar" });
      requestAnimationFrame(() => { bar.style.transform = `scaleX(${b / maxB})`; });
      return h("li", { class: cls }, bar, h("div", { class: "fname" }, h("b", { text: name }), h("span", { text: note })), h("div", { class: "fcount", text: bytes(b) }));
    }));
    text("bytes-note", "Real counts × file sizes. GitHub counts a download when it starts, so cancelled downloads count in full.");

    tick("sh-win", m.dl ? Math.round((m.win / m.dl) * 100) : 0, (v) => (m.dl ? `${Math.round(v)}%` : "—"));
    tick("sh-mac", m.dl ? Math.round((m.mac / m.dl) * 100) : 0, (v) => (m.dl ? `${Math.round(v)}%` : "—"));
    setShare("bw2", "bm2", m.win, m.mac);
    const shR = R ? [cw, cm] : null;
    text("sh-note", shR && shR[0] && shR[1] && shR[0].v + shR[1].v > 0
      ? `In the ${rangeLabel(R)}: Windows ${Math.round((shR[0].v / (shR[0].v + shR[1].v)) * 100)}%, macOS ${Math.round((shR[1].v / (shR[0].v + shR[1].v)) * 100)}% of ${num(shR[0].v + shR[1].v)} downloads.`
      : `${num(m.dl)} installer downloads in total.`);

    // share per release
    const rsRows = m.releases.slice().reverse().filter((r) => r.installs > 0).map((r) => {
      const bar = h("div", { class: "sharebar" }, h("div", { class: "w" }), h("div", { class: "m" }));
      requestAnimationFrame(() => {
        const t = r.installs, gap = bar.clientWidth ? 2 / bar.clientWidth : 0.005, sw = r.inst.win / t, sm = r.inst.mac / t;
        bar.children[0].style.transform = `scaleX(${Math.max(0, sw - (sm ? gap / 2 : 0))})`;
        bar.children[1].style.transform = `scaleX(${Math.max(0, sm - (sw ? gap / 2 : 0))})`;
      });
      return h("div", { class: "rs-row" }, h("b", { text: r.tag }), bar, h("span", { text: `${Math.round((r.inst.win / r.installs) * 100)}% / ${Math.round((r.inst.mac / r.installs) * 100)}%` }));
    });
    $("relshare").replaceChildren(...(rsRows.length > 1 ? [h("div", { class: "label", text: "By release · Windows / macOS" }), ...rsRows] : []));

    renderBoard(m);
  }

  function assetLabel(a) {
    if (a.kind === "inst") return [a.name, `${a.os === "win" ? "Windows" : "macOS"} installer · ${a.tag}`];
    if (a.kind === "man") return [a.name, `${a.os === "win" ? "Windows" : "macOS"} update check · ${a.tag}`];
    if (a.kind === "ver") return [`VERSION · ${a.os === "win" ? "Windows" : "macOS"}`, `update install marker · ${a.tag} · ${a.name.slice(0, 10)}…`];
    if (a.kind === "patch") { const p = a.name.split("-"); return [`patch ${p[1].slice(0, 8)}…`, `delta from ${String(p[2]).slice(0, 8)}… · ${a.tag}`]; }
    if (a.kind === "blob") return [`file ${a.name.slice(0, 10)}…`, `update file · ${a.tag}`];
    return [a.name, a.tag];
  }
  function renderBoard(m) {
    const all = [...m.assets.values()].filter((a) => a.count > 0).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    const zero = m.assets.size - all.length;
    const LIMIT = 10;
    const list = S.boardAll ? all : all.slice(0, LIMIT);
    const max = all.length ? all[0].count : 1;
    tagEl($("board-tag"), m.tl.live ? "live" : "hist", m.tl.live ? "live" : "last known");
    const items = list.map((a, i) => {
      const [name, sub] = assetLabel(a);
      const bar = h("div", { class: "bar" });
      requestAnimationFrame(() => { bar.style.transform = `scaleX(${a.count / max})`; });
      return h("li", { class: a.os === "mac" ? "mac" : a.os === "win" ? "" : "any" }, bar, h("span", { class: "rank", text: String(i + 1) }),
        h("div", { class: "fname" }, h("b", { text: name, title: a.name }), h("span", { text: sub })),
        h("div", { class: "fcount" }, num(a.count), h("small", { text: bytes(a.size) })));
    });
    if (!items.length) items.push(h("li", { class: "any" }, h("span", { class: "rank", text: "–" }), h("div", { class: "fname" }, h("b", { text: "No downloads yet" }), h("span", { text: "Files show up here as they're downloaded." })), h("div")));
    $("board").replaceChildren(...items);
    const more = $("board-more");
    more.hidden = all.length <= LIMIT;
    more.textContent = S.boardAll ? "Show the top 10" : `Show all ${num(all.length)} downloaded files`;
    let note = $("board-note");
    if (!note) { note = h("p", { class: "sub", id: "board-note" }); more.after(note); }
    note.textContent = zero ? `${plural(zero, "file")} with no downloads yet. Most are in-app update files, which only get downloaded when a copy updates past the version they belong to.` : "";
  }

  function fillTable(table, head, rows) {
    table.replaceChildren(h("thead", null, h("tr", null, head.map((x, i) => h("th", { class: i ? "num" : null, text: x })))),
      h("tbody", null, rows.length ? rows.map((r) => h("tr", null, r.map((x, i) => h("td", { class: i ? "num" : null, text: x })))) : h("tr", null, h("td", { colspan: head.length, text: "No data yet." }))));
  }

  function renderUpdates(m) {
    text("up-cover", coverText(m));
    const tl = m.tl, R = S.range;
    const ck = m.p.ck;
    const wk = change(tl, ["cw", "cm"], m.now - 7 * DAY, m.now);
    const covered = wk ? (m.tl.end - wk.from) / DAY : 0;
    const perDay = wk && covered >= 1 ? wk.v / covered : null;
    fillTiles($("up-tiles"), [
      tile("Checks today", ck.today ? ck.today.v : "—", deltaEl(ck.today, ck.todayPrev, "same time yesterday")),
      tile("Checks a day", perDay == null ? "—" : Math.round(perDay), perDay == null ? (wk ? "needs a full day of history" : "needs history") : wk.partial ? `average since ${fDay.format(wk.from)}` : "7-day average"),
      tile("Checks, all time", m.checks, `Windows ${num(m.checksWin)} · macOS ${num(m.checksMac)}`),
      tile("Updates installed", m.upd + m.updEst, m.upd + m.updEst ? `Windows ${num(m.updWin)} · macOS ${num(m.updMac)}${m.updEst ? ` · ≈${num(m.updEst)}` : ""}` : m.firstUpdater ? `first ones arrive after ${m.firstUpdater.tag}` : "no updater release yet"),
    ]);

    const series = [{ name: "Windows", color: C.win }, { name: "macOS", color: C.mac }];
    keysEl($("lg-checks"), series);
    const bs = buckets(tl, [["cw"], ["cm"]], "day", R || 0, m.now);
    setChart($("ch-checks"), { kind: "bars", buckets: bs, series, gran: "day", first: tl.first, label: `Update checks per day, ${rangeLabel(R)}.`,
      emptyTitle: "History starts at the first snapshot", emptyText: `${num(m.checks)} update checks so far, all time. Per-day numbers need snapshots.` });
    fillTable($("tbl-checks"), ["Day", "Windows", "macOS", "Total"], bs.slice().reverse().map((b) => [fDay.format(b.t0) + (b.partialStart ? " (partial)" : b.inProgress ? " (so far)" : ""), num(b.vals[0]), num(b.vals[1]), num(b.vals[0] + b.vals[1])]));

    const hrs = hourOfDay(tl, ["cw", "cm"], 14, m.now);
    keysEl($("lg-hours"), []);
    setChart($("ch-hours"), { kind: "bars", series: [{ name: "Update checks", color: C.mac }], gran: "hour", allLabels: true, label: "Update checks by hour of day, last 14 days.",
      buckets: hrs ? hrs.map((v, hr) => ({ t0: 0, label: hr % 6 === 0 ? `${hr}:00` : "", title: `${hr}:00–${(hr + 1) % 24}:00 · last 14 days`, vals: [v] })) : [],
      emptyTitle: tl.hasHist ? "Not enough hourly snapshots yet" : "History starts at the first snapshot", emptyText: "This shows which hours of your day the app is running, once there are hourly snapshots." });
    if (hrs) {
      const top = hrs.indexOf(Math.max(...hrs)), tot = hrs.reduce((a, b) => a + b, 0);
      text("note-hours", `Busiest: ${top}:00–${(top + 1) % 24}:00 (${Math.round((hrs[top] / tot) * 100)}% of ${num(tot)} checks). Each snapshot's checks are filed under the hour before it. That's right when the hourly snapshot runs on time, but GitHub sometimes delays scheduled runs.`);
    } else text("note-hours", "");

    renderActive(m, perDay, wk);
    renderDelta(m);

    // updates installed per release
    const withUpd = m.releases.filter((r) => r.hasUpdater || r.zFiles);
    keysEl($("lg-upr"), series);
    tagEl($("upr-tag"), m.updEst ? "est" : m.tl.live ? "live" : "hist", m.updEst ? "partly estimated" : m.tl.live ? "live" : "last known");
    setChart($("ch-upr"), { kind: "bars", series, labelBars: true, wideLabels: true,
      buckets: withUpd.map((r) => ({ t0: r.pub, label: r.tag, title: `${r.tag} · ${r.pub ? fDate.format(r.pub) : ""}`, vals: [r.upd.win || 0, r.upd.mac || 0],
        note: r.updEst ? `≈ ${num(r.updEst)} more, platform unknown (most-downloaded update file)` : r === m.firstUpdater && !r.updTotal ? "First version with the updater: nobody could update to it in-app" : null })),
      label: "Updates installed per release, by platform.", emptyTitle: "No updater releases yet", emptyText: "In-app updates start with the first release that ships update files." });
    text("note-upr", m.firstUpdater ? `Counted from each release's VERSION file, which every in-app update downloads once. ${m.firstUpdater.tag} is the first version with the updater, so in-app updates start with the release after it.` : "");

    const cum = cumulative(tl, [["uw"], ["um"]], R, m.now);
    keysEl($("lg-upcum"), [{ ...series[0], line: true, value: num(m.updWin) }, { ...series[1], line: true, value: num(m.updMac) }]);
    setChart($("ch-upcum"), { kind: "line", data: cum && cum.vs.some((v) => v[v.length - 1] > 0) ? cum : null, series, total: true, nowLive: tl.live, minMax: 1,
      label: `Updates installed over time, ${rangeLabel(R)}.`,
      emptyTitle: tl.hasHist ? "No in-app updates installed yet" : "History starts at the first snapshot",
      emptyText: tl.hasHist ? "This line starts when the first copy updates itself." : "Once snapshots are running, this shows when updates landed." });
  }

  function renderActive(m, perDay, wk) {
    const el = $("active");
    const head = h("div", { class: "card-head" }, h("h2", { text: "How many copies are running?" }), h("span", { class: "tag est", text: "rough range" }));
    if (perDay == null) {
      el.replaceChildren(head, h("div", { class: "big-range", text: "—" }), h("p", { class: "sub", text: "This needs at least a day of snapshots. It divides update checks per day by how often one copy checks: about once a day for 1.0.1, up to about 144 a day for 1.0.2 and later." }));
      return;
    }
    const lo = Math.max(perDay > 0 ? 1 : 0, Math.ceil(perDay / 150)), hi = Math.round(perDay);
    el.replaceChildren(head,
      h("div", { class: "big-range" }, lo === hi ? num(lo) : `${num(lo)}–${num(hi)}`, h("small", { text: " copies a day" })),
      h("p", { class: "sub" }, `Based on ${perDay >= 10 ? num(perDay) : perDay.toFixed(1)} update checks a day (${wk.partial ? `since ${fDay.format(wk.from)}` : "7-day average"}). `,
        "At the low end, every check comes from a 1.0.2+ copy running all day (about 144–150 checks each). At the high end, every check comes from a 1.0.1 copy opened once. ",
        h("b", { text: "Not a user count: " }), "copies with auto-check off aren't seen, and one person can run several machines."));
  }

  function renderDelta(m) {
    const el = $("delta");
    const head = h("div", { class: "card-head" }, h("h2", { text: "Delta updates vs full installers" }), h("span", { class: "tag", text: "bandwidth" }));
    let installs = 0, actual = 0, full = 0;
    const latestInst = { win: 0, mac: 0 };
    for (const r of m.releases) { if (r.instSize.win) latestInst.win = r.instSize.win; if (r.instSize.mac) latestInst.mac = r.instSize.mac; }
    for (const r of m.releases) {
      const w = r.upd.win || 0, mc = r.upd.mac || 0, est = r.updEst;
      if (!(w + mc + est)) continue;
      installs += w + mc + est;
      actual += r.zServed;
      const iw = r.instSize.win || latestInst.win, im = r.instSize.mac || latestInst.mac;
      full += w * iw + mc * im + est * Math.max(iw, im);
    }
    const pub = m.releases.filter((r) => r.zFiles);
    const lastPub = pub[pub.length - 1];
    const payload = lastPub ? h("p", { class: "sub" }, `Latest update files published: ${lastPub.tag}, ${plural(lastPub.zFiles, "file")} (${plural(lastPub.blobs, "whole file")} + ${plural(lastPub.patches, "patch", "patches")}) totalling ${bytes(lastPub.zBytes)} for both platforms. The Windows installer is ${bytes(lastPub.instSize.win || latestInst.win)}.`) : null;
    if (!installs) {
      el.replaceChildren(head, h("div", { class: "big-range", text: "No updates yet" }),
        h("p", { class: "sub", text: m.firstUpdater ? `${m.firstUpdater.tag} is the first version with the in-app updater. The savings show here once copies update themselves to the next release.` : "The savings show here once there are in-app updates." }), payload);
      return;
    }
    const avg = actual / installs, avgFull = full / installs, saved = Math.max(0, full - actual);
    el.replaceChildren(head,
      h("div", { class: "big-range" }, bytes(saved), h("small", { text: " saved" })),
      h("p", { class: "sub" }, h("b", { text: `Average update ${bytes(avg)}` }), ` vs ${bytes(avgFull)} for the full installer: ${(() => { const d = avgFull ? Math.round((1 - avg / avgFull) * 100) : 0; return d < 0 ? `${-d}% larger` : `${d}% smaller`; })()}, over ${plural(installs, "update")}. `,
        "Update files downloaded × their size, compared with each install downloading the installer instead.", m.updEst ? " Partly estimated where the platform isn't known." : ""),
      payload);
  }

  function renderReleases(m) {
    const rs = m.releases, now = m.now;
    const pub = rs.filter((r) => r.pub);
    const first = pub[0], last = m.latest || pub[pub.length - 1];
    const gaps = pub.slice(1).map((r, i) => (r.pub - pub[i].pub) / DAY);
    const avgGap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null;
    const since = last && last.pub ? Math.max(0, calDays(last.pub, now)) : null;
    const gapText = (d) => (d < 1 ? `${Math.max(1, Math.round(d * 24))} h` : `${d < 10 ? d.toFixed(1) : Math.round(d)} days`);
    fillTiles($("rel-tiles"), [
      tile("Since release", since == null ? "—" : since, last ? `${last.tag} · ${fDate.format(last.pub)}` : "no releases"),
      tile("Releases", rs.length, first ? `first: ${first.tag}, ${fDate.format(first.pub)}` : "—"),
      tile("Cadence", avgGap == null ? "—" : gapText(avgGap), avgGap == null ? "needs two releases" : `average gap between ${plural(pub.length, "release")}`),
      tile("Latest", last ? last.tag : "—", last ? (m.meta && m.meta.l === last.tag ? "GitHub's \"latest\" release" : "newest published") : ""),
    ]);
    tagEl($("tl-tag"), "", first && last ? `${fDay.format(first.pub)} – ${fDay.format(last.pub)}` : "—");

    // adoption bars
    const seg = [{ name: "Windows installer", color: C.win, get: (r) => r.inst.win }, { name: "Windows update", color: C.winU, get: (r) => r.upd.win || 0 },
      { name: "macOS installer", color: C.mac, get: (r) => r.inst.mac }, { name: "macOS update", color: C.macU, get: (r) => r.upd.mac || 0 }];
    keysEl($("lg-adopt"), seg);
    const rows = rs.slice().reverse();
    const maxA = Math.max(1, ...rows.map((r) => seg.reduce((a, sg) => a + sg.get(r), 0) + r.updEst));
    $("adopt").replaceChildren(...rows.map((r) => {
      const vals = seg.map((sg) => sg.get(r));
      const tot = vals.reduce((a, b) => a + b, 0) + r.updEst;
      const track = h("div", { class: "hb-track" + (tot ? "" : " none"), style: tot ? `width:${(tot / maxA) * 100}%` : null });
      vals.forEach((v, j) => { if (v) track.append(h("span", { style: `flex:${v} 1 0;background:${seg[j].color}` })); });
      if (r.updEst) track.append(h("span", { style: "flex:" + r.updEst + " 1 0;background:#5c6370" }));
      const row = h("div", { class: "hb-row", tabindex: 0, role: "group", "aria-label": `${r.tag}: ${num(tot)} total. ${seg.map((sg, j) => `${sg.name} ${num(vals[j])}`).join(", ")}${r.updEst ? `, about ${num(r.updEst)} updates of unknown platform` : ""}.` },
        h("span", { class: "hb-tag", text: r.tag }), h("div", null, track), h("span", { class: "hb-val", text: num(tot) }));
      const show = (ev) => {
        document.querySelectorAll(".hb-row.on").forEach((x) => x.classList.remove("on"));
        row.classList.add("on");
        const b = row.getBoundingClientRect();
        tipShow(row, `${r.tag} · ${r.pub ? fDate.format(r.pub) : ""}`, seg.map((sg, j) => ({ name: sg.name, color: sg.color, value: num(vals[j]) })), { name: "Total", value: num(tot) },
          r.updEst ? `≈ ${num(r.updEst)} updates, platform unknown` : null, ev && ev.clientX ? ev.clientX : b.left + b.width / 2, b.top);
      };
      row.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") show(e); });
      row.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") tipHide(row); });
      row.addEventListener("pointerdown", (e) => show(e));
      row.addEventListener("focus", () => show(null));
      row.addEventListener("blur", () => tipHide(row));
      return row;
    }));
    text("note-adopt", "Installer downloads plus in-app updates that moved a copy onto each version. Someone who downloads twice counts twice. Copies that later updated still count under their first version.");

    // timeline
    const items = [];
    rows.forEach((r, i) => {
      if (i > 0) {
        const newer = rows[i - 1];
        if (newer.pub && r.pub) items.push(h("li", { class: "gap", text: `↑ ${newer.tag} came ${gapText((newer.pub - r.pub) / DAY)} after ${r.tag}` }));
      }
      const chips = [
        h("span", { class: "chip" }, h("i", { class: "sw sw-win" }), h("b", { text: num(r.inst.win) }), "Windows"),
        h("span", { class: "chip" }, h("i", { class: "sw sw-mac" }), h("b", { text: num(r.inst.mac) }), "macOS"),
      ];
      if (r.hasUpdater) chips.push(h("span", { class: "chip" }, h("b", { text: num(r.checks.win + r.checks.mac) }), "update checks"));
      if (r.updTotal) chips.push(h("span", { class: "chip" }, h("b", { text: num(r.updTotal) + (r.updEst ? " ≈" : "") }), "updated in"));
      const L = r.launch || {};
      const launch = [];
      if (L.day) launch.push(`day one ${num(L.day.v)}${L.day.sofar ? " so far" : ""}`);
      if (L.week && !(L.day && L.day.sofar)) launch.push(`week one ${num(L.week.v)}${L.week.sofar ? " so far" : ""}`);
      if (launch.length) chips.push(h("span", { class: "chip", text: launch.join(" · ") }));
      if (L.perDay != null && r.installs) chips.push(h("span", { class: "chip dim", text: `${L.perDay >= 10 ? num(L.perDay) : L.perDay.toFixed(1)} a day since release` }));
      if (r.zFiles) chips.push(h("span", { class: "chip dim", text: `${plural(r.zFiles, "update file")} · ${bytes(r.zBytes)}` }));
      if (r.instSize.win || r.instSize.mac) chips.push(h("span", { class: "chip dim", text: `installers ${[r.instSize.win && bytes(r.instSize.win), r.instSize.mac && bytes(r.instSize.mac)].filter(Boolean).join(" / ")}` }));
      if (!r.hasUpdater) chips.push(h("span", { class: "chip dim", text: "no in-app updater" }));
      const li = h("li", { class: r === last ? "latest" : null },
        h("div", { class: "tl-head" }, h("span", { class: "tl-tag", text: r.tag }), h("span", { class: "tl-date", text: r.pub ? `${fDate.format(r.pub)} · ${daysAgoText(r.pub, now)}` : "" }),
          r === last ? h("span", { class: "tag live", text: "latest" }) : null, r.pre ? h("span", { class: "tag est", text: "pre-release" }) : null),
        h("div", { class: "tl-chips" }, chips));
      if (r.body) li.append(h("details", { class: "tl-notes" }, h("summary", { text: "What's new" }), notesEl(r.body)));
      items.push(li);
    });
    if (!items.length) items.push(h("li", { text: "No releases yet." }));
    $("timeline").replaceChildren(...items);

    $("rows").replaceChildren(...rows.map((r, i) => {
      const tr = h("tr", { style: `animation-delay:${i * 40}ms` },
        h("td", { text: r.tag }), h("td", { class: "hide-sm", text: r.pub ? fDate.format(r.pub) : "" }), h("td", { class: "num", text: num(r.inst.win) }),
        h("td", { class: "num", text: num(r.inst.mac) }), h("td", { class: "num hide-xs", text: r.hasUpdater || r.updTotal ? num(r.updTotal) + (r.updEst ? "≈" : "") : "–" }),
        h("td", { class: "num n", text: num(r.installs + r.updTotal) }));
      return tr;
    }));
  }
  function notesEl(body) {
    const box = h("div", { class: "notes" });
    let ul = null;
    for (const raw of body.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) { ul = null; continue; }
      const m = line.match(/^[-*•]\s+(.*)$/);
      if (m) { if (!ul) { ul = h("ul"); box.append(ul); } ul.append(h("li", { text: m[1] })); }
      else { ul = null; box.append(h("p", { text: line.replace(/^#+\s*/, "") })); }
    }
    return box;
  }

  let renderSeq = 0;
  async function render() {
    if (!(S.rel && S.rel.data) && !(S.hist && S.hist.data)) { renderNothing(); return; }
    const seq = ++renderSeq;
    const m = await buildModel();
    if (seq !== renderSeq) return;
    S.model = m;
    renderOverview(m); renderDownloads(m); renderUpdates(m); renderReleases(m);
    statusLine();
  }
  function renderNothing() {
    renderCollector({ tl: { hasHist: false }, now: Date.now() });
    renderBudget();
    statusLine();
  }

  // ================================================================ LIVE: refresh, status, celebration
  let inflight = null, lastAttempt = 0, timer = 0;
  function statusLine() {
    const p = $("pulse"), w = $("when"), b = $("banner");
    const relAt = S.rel && S.rel.at;
    let cls = "", label = "loading…", banner = "", bannerCls = "";
    if (S.status === "loading" && !relAt) { cls = "idle"; label = "loading…"; }
    else if (S.offline) { cls = "idle"; label = relAt ? `offline · ${ago(Date.now() - relAt)}` : "offline"; banner = relAt ? `You're offline. Showing what GitHub said ${ago(Date.now() - relAt)} (${fDayTime.format(relAt)}).` : "You're offline and there's nothing saved on this device yet."; }
    else if (S.status === "rate" || S.status === "error") {
      const histAt = S.model && S.model.tl.hasHist ? S.model.tl.T[S.model.tl.nHist - 1] : 0;
      const from = relAt ? ` Showing data from ${fDayTime.format(relAt)}.` : histAt ? ` Showing the last hourly snapshot (${fDayTime.format(histAt)}).` : "";
      cls = relAt || histAt ? "stale" : "err";
      label = relAt ? `cached · ${ago(Date.now() - relAt)}` : histAt ? `snapshot · ${ago(Date.now() - histAt)}` : S.status === "rate" ? "rate limited" : "couldn't reach GitHub";
      banner = S.status === "rate" ? `GitHub's hourly limit for this network is used up${S.rate && S.rate.reset ? `. It resets at ${fTime.format(S.rate.reset)}` : ""}.${from}` : `Couldn't reach GitHub (${S.error}).${from}`;
      bannerCls = relAt || histAt ? "warn" : "err";
    }
    else if (relAt && S.status === "live") { const age = Date.now() - relAt; cls = age > 10 * 60e3 ? "stale" : ""; label = `live · ${ago(age)}`; }
    else if (relAt) { cls = "stale"; label = inflight ? "updating…" : `cached · ${ago(Date.now() - relAt)}`; }
    p.className = "pulse " + cls;
    if (w.textContent !== label) w.textContent = label;
    b.hidden = !banner; b.textContent = banner; b.className = "banner" + (bannerCls === "err" ? " err" : "");
  }

  async function refresh(why) {
    if (inflight) return inflight;
    const manual = why === "manual" || why === "pull";
    if (!manual && Date.now() - lastAttempt < GAP_MS) return;
    lastAttempt = Date.now();
    const btn = $("refresh");
    btn.classList.add("spin"); btn.setAttribute("aria-busy", "true");
    statusLine();
    inflight = (async () => {
      const [r, hh] = await Promise.allSettled([fetchReleases(), fetchHistory(manual)]);
      S.offline = navigator.onLine === false;
      if (r.status === "fulfilled") { S.rel = r.value; S.status = "live"; S.error = ""; }
      else {
        const e = r.reason || {};
        S.status = e.rate ? "rate" : "error";
        S.error = e.rate ? "rate limit" : e instanceof TypeError ? "network error" : (e.message || String(e));
      }
      if (hh.status === "fulfilled") { S.hist = hh.value; S.histBytes = S.hist.data ? JSON.stringify(S.hist.data).length : 0; }
      else if (S.hist) S.hist.error = (hh.reason && hh.reason.message) || "network error";
      else S.hist = { at: 0, none: false, data: null, error: (hh.reason && hh.reason.message) || "network error" };
      const before = S.model;
      await render();
      if (r.status === "fulfilled") celebrate(before, S.model);
    })().finally(() => {
      inflight = null;
      btn.classList.remove("spin"); btn.removeAttribute("aria-busy");
      schedule();
    });
    return inflight;
  }
  function schedule() {
    clearTimeout(timer);
    let wait = REFRESH_MS;
    if (S.rate && S.rate.left === 0 && S.rate.reset > Date.now()) wait = S.rate.reset - Date.now() + 5000;
    else if (S.rate && S.rate.left < 10) wait = 5 * 60e3;
    timer = setTimeout(() => { if (!document.hidden) refresh("auto"); else schedule(); }, wait);
  }

  function celebrate(before, m) {
    if (!m || !m.tl.live) return;
    const seen = store.get(K.seen);
    const cur = { dl: m.dl, up: m.upd, ck: m.checks, t: Date.now() };
    store.set(K.seen, cur);
    if (!seen) return;
    const d = cur.dl - (seen.dl || 0), u = cur.up - (seen.up || 0), c = cur.ck - (seen.ck || 0);
    if (d > 0) {
      S.sinceLast = (S.sinceLast || 0) + d;
      renderOverview(m);
      flash($("hero"));
      confetti($("total"), Math.min(90, 36 + d * 6));
      toast(`+${plural(d, "new download")} since you last looked`);
    } else if (u > 0) {
      flash($("hero"));
      confetti($("total"), 28);
      toast(`+${plural(u, "in-app update")} since you last looked`);
    } else if (c > 0 && before) {
      document.querySelectorAll("#ov-periods .tile:last-child, #up-tiles .tile:first-child").forEach(flash);
    }
  }
  function flash(el) { if (!el || reduce) return; el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash"); }
  let toastT = 0;
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg; t.hidden = false;
    requestAnimationFrame(() => t.classList.add("on"));
    clearTimeout(toastT);
    toastT = setTimeout(() => { t.classList.remove("on"); setTimeout(() => { t.hidden = true; }, 450); }, 4200);
  }
  function confetti(origin, n) {
    if (reduce || !origin || !origin.animate || document.hidden) return;
    const box = $("confetti"), r = origin.getBoundingClientRect();
    const cx = r.left + Math.min(r.width, 220) / 2, cy = r.top + r.height / 2;
    const colors = [C.win, C.win, C.mac, "#ffffff", "#e6ff8a"];
    for (let i = 0; i < n; i++) {
      const p = h("i", { style: `background:${colors[i % colors.length]};transform:translate(${cx}px,${cy}px)` });
      if (i % 3 === 0) { p.style.width = "7px"; p.style.height = "7px"; p.style.borderRadius = "50%"; }
      box.append(p);
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.25, v = 180 + Math.random() * 260;
      const dx = Math.cos(ang) * v, dy = Math.sin(ang) * v, rot = (Math.random() - 0.5) * 900, dur = 1300 + Math.random() * 900;
      p.animate([
        { transform: `translate(${cx}px,${cy}px) rotate(0deg)`, opacity: 1 },
        { transform: `translate(${cx + dx * 0.8}px,${cy + dy}px) rotate(${rot * 0.5}deg)`, opacity: 1, offset: 0.45 },
        { transform: `translate(${cx + dx}px,${cy + dy + 340}px) rotate(${rot}deg)`, opacity: 0 },
      ], { duration: dur, easing: "cubic-bezier(.15,.7,.35,1)", delay: Math.random() * 120 }).finished.then(() => p.remove(), () => p.remove());
    }
  }

  // ================================================================ UI: tabs, swipe, pull to refresh, lock
  const scrollPos = {};
  function showTab(name, opts = {}) {
    if (!TABS.includes(name)) name = "overview";
    const prev = S.tab;
    if (prev !== name) scrollPos[prev] = scrollY;
    S.tab = name;
    const dir = TABS.indexOf(name) - TABS.indexOf(prev);
    for (const t of TABS) {
      const p = $("p-" + t), b = $("t-" + t), on = t === name;
      b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1;
      if (on) {
        const wasHidden = p.hidden;
        p.hidden = false;
        if (wasHidden || opts.first) {
          p.style.setProperty("--dx", `${dir > 0 ? 18 : dir < 0 ? -18 : 0}px`);
          p.classList.remove("enter"); void p.offsetWidth; p.classList.add("enter");
          if (!p.dataset.seen) { p.dataset.seen = "1"; p.classList.add("first"); setTimeout(() => p.classList.remove("first"), 1400); }
        }
      } else p.hidden = true;
    }
    moveInd();
    tipHide();
    if (prev !== name) scrollTo(0, scrollPos[name] || 0);
    if (!opts.noHash && location.hash !== "#" + name) history.replaceState(null, "", "#" + name);
    saveUi();
  }
  function moveInd() {
    const b = $("t-" + S.tab), ind = $("tabind");
    if (!b || !b.offsetWidth) return;
    ind.style.width = b.offsetWidth + "px";
    ind.style.setProperty("--x", b.offsetLeft + "px");
  }
  function saveUi() { store.set(K.ui, { tab: S.tab, range: S.range, gran: S.gran }); }

  function setupUi() {
    tip.el = $("tip");
    const ui = store.get(K.ui) || {};
    if ([0, 7, 30, 90].includes(ui.range)) S.range = ui.range;
    if (ui.gran === "week" || ui.gran === "day") S.gran = ui.gran;
    document.querySelectorAll("[data-range-group]").forEach((g) => g.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-range]"); if (!b) return;
      S.range = +b.dataset.range; syncRange(); saveUi(); if (S.model) { renderDownloads(S.model); renderUpdates(S.model); }
    }));
    syncRange();
    $("gran").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-gran]"); if (!b) return;
      S.gran = b.dataset.gran; saveUi(); if (S.model) renderDownloads(S.model);
    });
    $("tabs").addEventListener("click", (e) => { const b = e.target.closest(".tab"); if (b) showTab(b.dataset.tab); });
    $("tabs").addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const i = (TABS.indexOf(S.tab) + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length;
      showTab(TABS[i]); $("t-" + TABS[i]).focus();
    });
    addEventListener("hashchange", () => { const t = location.hash.slice(1); if (TABS.includes(t) && t !== S.tab) showTab(t, { noHash: true }); });
    addEventListener("resize", () => { moveInd(); tipHide(); });
    $("refresh").addEventListener("click", () => refresh("manual"));
    $("board-more").addEventListener("click", () => { S.boardAll = !S.boardAll; if (S.model) renderBoard(S.model); });
    let armed = 0;
    $("lockbtn").addEventListener("click", () => {
      const b = $("lockbtn");
      if (Date.now() - armed > 4000) {
        armed = Date.now(); b.textContent = "Tap again to lock"; b.classList.add("danger");
        setTimeout(() => { if (Date.now() - armed >= 4000) { b.textContent = "Lock this device"; b.classList.remove("danger"); } }, 4100);
        return;
      }
      lockDevice();
    });
    // cursor spotlight on cards (mouse only)
    document.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse") return;
      const c = e.target.closest && e.target.closest(".card"); if (!c) return;
      const b = c.getBoundingClientRect();
      c.style.setProperty("--mx", e.clientX - b.left + "px"); c.style.setProperty("--my", e.clientY - b.top + "px");
    }, { passive: true });
    // tapping outside a chart, or scrolling, puts the tooltip away
    document.addEventListener("pointerdown", (e) => { if (!e.target.closest(".chart, .hb-row")) tipHide(); }, { passive: true });
    let lastSY = scrollY;
    addEventListener("scroll", () => {
      $("top").classList.toggle("scrolled", scrollY > 4);
      if (Math.abs(scrollY - lastSY) > 8) { tipHide(); lastSY = scrollY; }
    }, { passive: true });
    setupTouch();
  }
  function syncRange() {
    document.querySelectorAll("button[data-range]").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.range === S.range)));
  }

  function setupTouch() {
    const ptr = $("ptr");
    let y0 = null, x0 = 0, t0 = 0, dy = 0, mode = null, sx = 0, sy = 0;
    addEventListener("touchstart", (e) => {
      if (e.touches.length !== 1) { y0 = null; return; }
      const t = e.touches[0];
      y0 = t.clientY; x0 = t.clientX; t0 = Date.now(); dy = 0; mode = null; sx = t.clientX; sy = t.clientY;
      const inChart = e.target.closest(".chart, .tbl-wrap, input, .hb-row");
      if (inChart) mode = "none";
      else if (scrollY > 2) mode = "noptr";
    }, { passive: true });
    addEventListener("touchmove", (e) => {
      if (y0 == null || mode === "none") return;
      const t = e.touches[0], ddx = t.clientX - x0, ddy = t.clientY - y0;
      if (!mode || mode === "noptr") {
        if (Math.abs(ddx) > 12 && Math.abs(ddx) > Math.abs(ddy) * 1.6) mode = "swipe";
        else if (mode !== "noptr" && ddy > 12 && Math.abs(ddy) > Math.abs(ddx) && scrollY <= 0) mode = "ptr";
      }
      if (mode === "ptr") {
        dy = Math.max(0, ddy);
        const y = Math.min(dy * 0.5, 96);
        ptr.classList.remove("back");
        ptr.style.transform = `translateY(${y}px) rotate(${dy * 1.6}deg)`;
        ptr.style.opacity = String(Math.min(1, dy / 90));
        ptr.classList.toggle("armed", dy > 130);
      }
    }, { passive: true });
    addEventListener("touchend", (e) => {
      if (mode === "ptr") {
        ptr.classList.add("back");
        if (dy > 130) {
          ptr.style.transform = "translateY(56px)"; ptr.classList.add("spin");
          refresh("pull").finally(() => { ptr.classList.remove("spin", "armed"); ptr.style.transform = "translateY(0)"; ptr.style.opacity = "0"; });
        } else { ptr.style.transform = "translateY(0)"; ptr.style.opacity = "0"; ptr.classList.remove("armed"); }
      } else if (mode === "swipe") {
        const t = e.changedTouches[0], ddx = t.clientX - sx, ddy = t.clientY - sy;
        if (Math.abs(ddx) > 70 && Math.abs(ddx) > Math.abs(ddy) * 1.6 && Date.now() - t0 < 800 && sx > 24 && sx < innerWidth - 24) {
          const i = TABS.indexOf(S.tab) + (ddx < 0 ? 1 : -1);
          if (i >= 0 && i < TABS.length) showTab(TABS[i]);
        }
      }
      y0 = null; mode = null; dy = 0;
    }, { passive: true });
  }

  function lockDevice() {
    store.del(KEY); store.del(K.rel); store.del(K.hist); store.del(K.seen); store.del(K.ui); store.del(K.rel, true);
    try { if (window.caches) caches.keys().then((ks) => ks.filter((k) => k.startsWith("periph-stats")).forEach((k) => caches.delete(k))); } catch (e) { /* ignore */ }
    location.replace(location.pathname);
  }

  // ================================================================ START
  let started = false;
  function start() {
    if (started) return;
    started = true;
    $("lock").hidden = true; $("app").hidden = false;
    setupUi();
    const hashTab = location.hash.slice(1);
    const ui = store.get(K.ui) || {};
    showTab(TABS.includes(hashTab) ? hashTab : TABS.includes(ui.tab) ? ui.tab : "overview", { first: true });
    // last known view straight away (offline tolerant), then ask GitHub
    S.rel = store.get(K.rel, true) || store.get(K.rel);
    S.hist = store.get(K.hist);
    if (S.hist && S.hist.data) S.histBytes = JSON.stringify(S.hist.data).length;
    S.offline = navigator.onLine === false;
    if (S.rel) S.status = "cached";
    render().then(() => {
      const fresh = S.rel && Date.now() - S.rel.at < FRESH_MS && S.hist && Date.now() - S.hist.at < FRESH_MS;
      if (fresh) { S.status = "live"; schedule(); statusLine(); celebrate(null, S.model); } else refresh("start");
    });
    setInterval(() => { if (!document.hidden) statusLine(); }, 15000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) { statusLine(); refresh("resume"); } });
    addEventListener("pageshow", (e) => { if (e.persisted) refresh("resume"); });
    addEventListener("online", () => { S.offline = false; refresh("online"); });
    addEventListener("offline", () => { S.offline = true; statusLine(); });
    if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  if (remembered()) start();
  else {
    $("lock").hidden = false;
    setTimeout(() => $("pw").focus(), 50);
    $("lockform").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = $("lockform"), btn = $("unlock");
      btn.disabled = true; btn.textContent = "Checking…";
      const ok = (await derive($("pw").value)) === HASH;
      btn.disabled = false; btn.textContent = "Unlock";
      if (ok) {
        try { localStorage.setItem(KEY, HASH); } catch (err) { /* remembered for this visit only */ }
        $("pw").value = "";
        start();
      } else {
        $("pwerr").textContent = "Wrong password.";
        f.classList.remove("shake"); void f.offsetWidth; f.classList.add("shake");
        $("pw").select();
      }
    });
  }
})();
