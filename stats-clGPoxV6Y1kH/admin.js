/* periph stats: Requests + Agent tabs.

   Talks to the periph-admin edge function (Supabase). It needs the owner key, which is pasted
   once per device and kept in this browser's storage; the page itself holds no secret.
     Requests: every "Request a device" submission from the website; set status, notes, delete.
     Agent:    run the device-request agent now (GitHub repository_dispatch -> Claude routine),
               and see every run with its status, version and summary. */
"use strict";
(() => {
  const API = "https://erdoijtwfaoxhjdijyhp.supabase.co/functions/v1/periph-admin";
  const KEY = "periph-admin-key";
  const STATUS = {
    new: "New", researching: "Researching", added: "Added", "needs-info": "Needs info",
    "not-possible": "Not possible", duplicate: "Duplicate", spam: "Spam",
  };
  const RUN = { queued: "Queued", running: "Running", done: "Done", failed: "Failed", "nothing-to-do": "Nothing to do" };
  const OS = { windows: "Windows", mac: "Mac", both: "Windows + Mac" };
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const store = {
    get() { try { return localStorage.getItem(KEY) || ""; } catch { return ""; } },
    set(v) { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch { /* private mode */ } },
  };
  const ago = (iso) => {
    if (!iso) return "—";
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
  };
  const when = (iso) => iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

  const S = { tel: null, telDays: 30, telErr: "", telLoading: false, data: null, loading: false, error: "", filter: "open", open: new Set(), tab: "", poll: 0 };

  async function api(action, body = {}) {
    const r = await fetch(API, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + store.get() },
      body: JSON.stringify({ action, ...body }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) { store.set(""); throw new Error("That key didn't work. Paste it again."); }
    if (!r.ok) throw new Error(j.error || `Server said ${r.status}.`);
    return j;
  }

  async function load(quiet) {
    if (!store.get() || S.loading) return;
    S.loading = true;
    if (!quiet) renderAll();
    try { S.data = await api("list"); S.error = ""; }
    catch (e) { S.error = e.message; }
    S.loading = false;
    renderAll();
    schedulePoll();
  }

  // ------------------------------------------------------------------ shared bits
  function card(title, tagText, tagCls) {
    const c = el("article", "card span-all");
    const h = el("div", "card-head");
    h.append(el("h2", null, title));
    if (tagText) h.append(el("span", "tag " + (tagCls || ""), tagText));
    c.append(h);
    return c;
  }
  function connectCard(root) {
    const c = card("Connect admin", "owner only");
    c.append(el("p", "sub", "Paste your periph admin key once on this device. It's in periph-owner-key.txt in your periph-release folder on your PC (%APPDATA%\\periph-release)."));
    const f = el("form", "adm-connect");
    const inp = el("input"); inp.type = "password"; inp.placeholder = "pk_o_…"; inp.autocomplete = "off"; inp.setAttribute("aria-label", "Admin key");
    const b = el("button", "btn", "Connect"); b.type = "submit";
    f.append(inp, b);
    f.addEventListener("submit", (e) => { e.preventDefault(); if (inp.value.trim()) { store.set(inp.value.trim()); load(); } });
    c.append(f);
    if (S.error) c.append(el("p", "sub adm-err", S.error));
    root.append(c);
  }
  function stateLine(root) {
    if (S.loading && !S.data) { const c = card("Loading…"); c.append(el("div", "adm-skel")); root.append(c); return true; }
    if (S.error && S.data) root.append(el("p", "sub adm-err span-all", S.error));
    if (S.error && !S.data) { const c = card("Couldn't load"); c.append(el("p", "sub adm-err", S.error)); const r = el("button", "btn", "Try again"); r.onclick = () => load(); c.append(r); root.append(c); return true; }
    return false;
  }

  // ------------------------------------------------------------------ Requests
  function renderRequests() {
    const root = $("adm-requests"); if (!root) return;
    root.replaceChildren();
    if (!store.get()) return connectCard(root);
    if (stateLine(root)) return;
    const reqs = (S.data && S.data.requests) || [];
    const count = (k) => reqs.filter((r) => r.status === k).length;
    const openN = reqs.filter((r) => ["new", "researching", "needs-info"].includes(r.status)).length;

    const tiles = el("div", "tiles span-all");
    for (const [label, n, cls] of [["Open", openN, "lime"], ["New", count("new"), ""], ["Added", count("added"), ""], ["All time", reqs.length, ""]]) {
      const t = el("div", "tile adm-tile " + cls); t.append(el("div", "adm-tile-k", label), el("div", "adm-tile-v", String(n))); tiles.append(t);
    }
    root.append(tiles);

    const c = card("Device requests", "from the website", "live");
    const pills = el("div", "chips adm-filter");
    for (const [k, label] of [["open", "Open"], ["new", "New"], ["added", "Added"], ["all", "All"]]) {
      const p = el("button", "chip" + (S.filter === k ? " new" : ""), label); p.type = "button";
      p.onclick = () => { S.filter = k; renderRequests(); };
      pills.append(p);
    }
    c.append(pills);
    const list = el("div", "adm-list");
    const shown = reqs.filter((r) => S.filter === "all" ? true : S.filter === "open" ? ["new", "researching", "needs-info"].includes(r.status) : r.status === S.filter);
    if (!shown.length) list.append(el("p", "sub", reqs.length ? "Nothing in this filter." : "No requests yet. They show up here as soon as someone uses the form on the website."));
    for (const r of shown) list.append(requestRow(r));
    c.append(list);
    root.append(c);
  }
  function requestRow(r) {
    const row = el("div", "adm-req" + (S.open.has(r.id) ? " open" : ""));
    const head = el("button", "adm-req-head"); head.type = "button"; head.setAttribute("aria-expanded", String(S.open.has(r.id)));
    const name = el("div", "adm-req-name"); name.append(el("b", null, r.device));
    const meta = [ago(r.created_at), r.os && OS[r.os], r.version && "v" + r.version].filter(Boolean).join(" · ");
    name.append(el("span", "sub", meta));
    head.append(name, el("span", "adm-pill s-" + r.status, STATUS[r.status] || r.status));
    head.onclick = () => { S.open.has(r.id) ? S.open.delete(r.id) : S.open.add(r.id); renderRequests(); };
    row.append(head);
    if (r.wants) row.append(el("p", "adm-wants", r.wants));
    if (!S.open.has(r.id)) return row;

    const body = el("div", "adm-req-body");
    if (r.contact) body.append(el("p", "sub", "Contact: " + r.contact));
    if (r.notes) { const n = el("pre", "adm-notes", r.notes); body.append(n); }
    const sel = el("select", "adm-sel"); sel.setAttribute("aria-label", "Status");
    for (const [k, v] of Object.entries(STATUS)) { const o = el("option", null, v); o.value = k; if (k === r.status) o.selected = true; sel.append(o); }
    const note = el("textarea", "adm-note"); note.rows = 2; note.placeholder = "Note (optional)"; note.value = "";
    const save = el("button", "btn", "Save"); save.type = "button";
    save.onclick = async () => {
      save.disabled = true;
      try {
        const patch = { id: r.id, status: sel.value };
        if (note.value.trim()) patch.notes = ((r.notes ? r.notes + "\n" : "") + "owner: " + note.value.trim()).slice(-4000);
        await api("update_request", patch); toast("Saved"); await load(true);
      } catch (e) { toast(e.message, true); save.disabled = false; }
    };
    const del = el("button", "btn danger", "Delete"); del.type = "button";
    let armed = false;
    del.onclick = async () => {
      if (!armed) { armed = true; del.textContent = "Tap again to delete"; setTimeout(() => { armed = false; del.textContent = "Delete"; }, 3000); return; }
      try { await api("delete_request", { id: r.id }); S.open.delete(r.id); toast("Deleted"); await load(true); } catch (e) { toast(e.message, true); }
    };
    const actions = el("div", "adm-actions"); actions.append(sel, save, del);
    body.append(note, actions);
    row.append(body);
    return row;
  }

  // ------------------------------------------------------------------ Agent
  function nextScheduled() {
    // 1st of every month, 17:00 UTC (the routine's cron)
    const now = new Date();
    let d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 17, 0));
    if (d <= now) d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 17, 0));
    return d;
  }
  function renderAgent() {
    const root = $("adm-agent"); if (!root) return;
    root.replaceChildren();
    if (!store.get()) return connectCard(root);
    if (stateLine(root)) return;
    const d = S.data || {};
    const runs = d.runs || [];
    const reqs = d.requests || [];
    const openN = reqs.filter((r) => ["new", "researching", "needs-info"].includes(r.status)).length;
    const active = runs.find((r) => r.status === "queued" || r.status === "running");
    const manualToday = runs.filter((r) => r.trigger === "manual" && Date.now() - new Date(r.created_at) < 86400e3).length;

    const hero = card("Device-request agent", active ? RUN[active.status] : "idle", active ? "live" : "");
    hero.classList.add("adm-hero");
    const line = el("p", "sub");
    line.innerHTML = "";
    line.append(`It reads the open requests, researches each device, adds every control it can, tests it, and ships a release. Next automatic run: `);
    line.append(el("b", null, nextScheduled().toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })));
    line.append(".");
    hero.append(line);
    const go = el("button", "btn adm-go", active ? (active.status === "queued" ? "Starting…" : "Working…") : `Run now · ${openN} open request${openN === 1 ? "" : "s"}`);
    go.type = "button";
    go.disabled = !!active || !d.dispatch_ready;
    let armed = false;
    go.onclick = async () => {
      if (!armed) { armed = true; go.textContent = "Tap again to start the agent"; setTimeout(() => { armed = false; renderAgent(); }, 4000); return; }
      go.disabled = true; go.textContent = "Starting…";
      try { await api("trigger"); toast("Agent started"); await load(true); }
      catch (e) { toast(e.message, true); renderAgent(); }
    };
    hero.append(go);
    const meta = [];
    if (!d.dispatch_ready) meta.push("Run now needs the GitHub token set up first.");
    meta.push(`${manualToday} of 6 manual runs used today.`);
    hero.append(el("p", "sub", meta.join(" ")));
    root.append(hero);

    const c = card("Runs", `${runs.length} recorded`);
    const list = el("div", "adm-list");
    if (!runs.length) list.append(el("p", "sub", "No runs yet. Each run shows up here with what it did."));
    for (const r of runs) {
      const row = el("div", "adm-req" + (S.open.has("run" + r.id) ? " open" : ""));
      const head = el("button", "adm-req-head"); head.type = "button";
      const name = el("div", "adm-req-name");
      name.append(el("b", null, (r.trigger === "manual" ? "Manual run" : "Monthly run") + (r.version ? " → v" + r.version : "")));
      const dur = r.finished_at ? Math.max(1, Math.round((new Date(r.finished_at) - new Date(r.created_at)) / 60000)) + " min" : "";
      name.append(el("span", "sub", [when(r.created_at), dur].filter(Boolean).join(" · ")));
      head.append(name, el("span", "adm-pill r-" + r.status, RUN[r.status] || r.status));
      head.onclick = () => { const k = "run" + r.id; S.open.has(k) ? S.open.delete(k) : S.open.add(k); renderAgent(); };
      row.append(head);
      if (S.open.has("run" + r.id)) {
        const body = el("div", "adm-req-body");
        body.append(el("pre", "adm-notes", r.summary || (r.status === "queued" ? "Waiting for the agent to start (usually under a minute)." : "No summary yet.")));
        if (r.session_url && /^https:\/\/claude\.ai\//.test(r.session_url)) {
          const a = el("a", "btn", "Open the full session"); a.href = r.session_url; a.target = "_blank"; a.rel = "noopener"; body.append(a);
        }
        row.append(body);
      }
      list.append(row);
    }
    c.append(list);
    root.append(c);

    const lock = el("button", "btn wide", "Forget admin key on this device"); lock.type = "button";
    lock.onclick = () => { store.set(""); S.data = null; renderAll(); };
    const w = el("div", "span-all"); w.append(lock); root.append(w);
  }


  // ------------------------------------------------------------------ Telemetry
  async function loadTelemetry(quiet) {
    if (!store.get() || S.telLoading) return;
    S.telLoading = true; if (!quiet) renderTelemetry();
    try { S.tel = (await api("telemetry", { days: S.telDays })).summary; S.telErr = ""; }
    catch (e) { S.telErr = e.message; }
    S.telLoading = false; renderTelemetry();
  }
  function bars(rows, label, value, fmt) {
    const max = Math.max(1, ...rows.map(value));
    const list = el("div", "tel-bars");
    for (const r of rows) {
      const row = el("div", "tel-bar");
      const fill = el("i"); fill.style.width = Math.max(2, (value(r) / max) * 100) + "%";
      const track = el("span", "tel-track"); track.append(fill);
      row.append(el("span", "tel-k", label(r)), track, el("span", "tel-v", fmt ? fmt(r) : String(value(r))));
      list.append(row);
    }
    return list;
  }
  function renderTelemetry() {
    const root = $("adm-telemetry"); if (!root) return;
    root.replaceChildren();
    if (!store.get()) return connectCard(root);
    if (S.telLoading && !S.tel) { const c = card("Loading…"); c.append(el("div", "adm-skel")); root.append(c); return; }
    if (S.telErr && !S.tel) { const c = card("Couldn't load"); c.append(el("p", "sub adm-err", S.telErr)); const b = el("button", "btn", "Try again"); b.onclick = () => loadTelemetry(); c.append(b); root.append(c); return; }
    const t = S.tel; if (!t) return;
    const sel = el("div", "chips adm-filter span-all");
    for (const d of [7, 30, 90]) { const p = el("button", "chip" + (S.telDays === d ? " new" : ""), "Last " + d + " days"); p.type = "button"; p.onclick = () => { S.telDays = d; loadTelemetry(); }; sel.append(p); }
    root.append(sel);
    const tiles = el("div", "tiles span-all");
    for (const [k, v, cls] of [["Active installs", t.installs, "lime"], ["Events", t.events, ""], ["Sessions", t.sessions, ""], ["Avg session", t.session_minutes != null ? t.session_minutes + " min" : "—", ""]]) {
      const x = el("div", "tile adm-tile " + cls); x.append(el("div", "adm-tile-k", k), el("div", "adm-tile-v", String(v))); tiles.append(x);
    }
    root.append(tiles);
    if (!t.events) { const c = card("No data yet", "opt-in"); c.append(el("p", "sub", "Reports arrive once people accept the prompt in the app. Nothing is sent without that.")); root.append(c); return; }

    let c = card("Active installs per day", "anonymous");
    c.append(bars(t.daily, (r) => r.day.slice(5), (r) => r.installs, (r) => r.installs + " · " + r.events + " events")); root.append(c);
    c = card("Versions"); c.append(bars(t.versions, (r) => "v" + r.version, (r) => r.installs, (r) => r.installs + " installs")); root.append(c);
    c = card("Windows vs Mac"); c.append(bars(t.os, (r) => ({ win: "Windows", mac: "macOS" }[r.os] || r.os), (r) => r.installs)); root.append(c);
    c = card("Pages people use"); c.append(t.views.length ? bars(t.views, (r) => r.view || "?", (r) => r.n, (r) => r.n + " · " + r.installs + " installs") : el("p", "sub", "No page views yet.")); root.append(c);

    c = card("Devices seen", "USB vendor:product only");
    const dl = el("div", "adm-list");
    if (!t.devices.length) dl.append(el("p", "sub", "None yet."));
    for (const d of t.devices) {
      const row = el("div", "tel-row"); row.append(el("b", "mono", d.vidpid || "?"), el("span", "sub", [d.driver, d.family].filter(Boolean).join(" · ")),
        el("span", "adm-pill " + (d.supported ? "s-added" : "s-not-possible"), d.supported ? "supported" : "not supported"), el("span", "tel-v", d.installs + " installs")); dl.append(row);
    }
    c.append(dl); root.append(c);

    c = card("What works and what fails", "device actions");
    const al = el("div", "adm-list");
    if (!t.actions.length) al.append(el("p", "sub", "No actions yet."));
    for (const a of t.actions) {
      const pct = a.total ? Math.round((a.failed / a.total) * 100) : 0;
      const row = el("div", "tel-row"); row.append(el("b", null, (a.driver || "?") + " · " + (a.name || "?")), el("span", "sub", a.total + " runs"),
        el("span", "adm-pill " + (pct >= 20 ? "s-spam" : pct ? "s-needs-info" : "s-added"), pct ? pct + "% fail" : "all ok")); al.append(row);
    }
    c.append(al); root.append(c);

    c = card("Top errors", "scrubbed");
    const el2 = el("div", "adm-list");
    if (!t.errors.length) el2.append(el("p", "sub", "No errors reported."));
    for (const e of t.errors) {
      const row = el("div", "tel-err"); row.append(el("b", null, (e.type || e.event) + (e.place ? " · " + e.place : "")), el("span", "sub", ago(e.last_seen) + " · " + e.n + "× · " + e.installs + " installs"));
      if (e.msg) row.append(el("pre", "adm-notes", e.msg)); el2.append(row);
    }
    c.append(el2); root.append(c);

    if (t.features.length) { c = card("Features and settings"); c.append(bars(t.features, (r) => (r.name || r.event) + (r.value ? " = " + r.value : ""), (r) => r.n)); root.append(c); }
  }

  // ------------------------------------------------------------------ plumbing
  function renderAll() {
    renderRequests(); renderAgent(); renderTelemetry();
    const badge = $("req-badge");
    const n = S.data ? S.data.requests.filter((r) => r.status === "new").length : 0;
    if (badge) { badge.hidden = !n; badge.textContent = n > 99 ? "99+" : String(n); }
  }
  function schedulePoll() {
    clearTimeout(S.poll);
    const busy = S.data && S.data.runs.some((r) => r.status === "queued" || r.status === "running");
    const onAdmin = S.tab === "requests" || S.tab === "agent";
    if (!document.hidden && (onAdmin || busy)) S.poll = setTimeout(() => load(true), busy ? 15000 : 60000);
  }
  function toast(msg, bad) {
    const t = $("toast"); if (!t) return;
    t.textContent = msg; t.hidden = false; t.classList.toggle("bad", !!bad);
    requestAnimationFrame(() => t.classList.add("on"));
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { t.classList.remove("on"); setTimeout(() => { t.hidden = true; }, 450); }, 2600);
  }
  addEventListener("statstab", (e) => {
    S.tab = e.detail;
    if (S.tab === "telemetry") { if (store.get()) loadTelemetry(!!S.tel); else renderTelemetry(); return; }
    if ((S.tab === "requests" || S.tab === "agent") && store.get()) load(!!S.data); else schedulePoll();
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && (S.tab === "requests" || S.tab === "agent")) load(true); });
  renderAll();
  if (store.get()) load(true);   // fills the Requests badge
})();
