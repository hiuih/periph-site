/* periph site — one rAF loop drives the keyboard hero and the DPI pad.
   It only runs while one of them is on screen and the tab is visible. */
(() => {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const root = document.documentElement;
  root.classList.add("js");
  const mqReduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reduced = mqReduce.matches;

  // ------------------------------------------------------------ release info
  const R = window.PERIPH_RELEASE;
  if (R) {
    const set = (k, v) => $$(`[data-rel="${k}"]`).forEach((el) => {
      if (k.endsWith("href")) el.setAttribute("href", v); else el.textContent = v;
    });
    set("version", "v" + R.version);
    $$('.dl [data-rel="version"]').forEach((el) => (el.textContent = R.version));
    set("date", R.date);
    set("winsize", R.windows.size); set("macsize", R.mac.size);
    set("winnote", R.windows.note); set("macnote", R.mac.note);
    set("winhref", R.windows.href); set("machref", R.mac.href);
    $$('a[data-os="windows"]').forEach((a) => (a.href = R.windows.href));
    $$('a[data-os="mac"]').forEach((a) => (a.href = R.mac.href));
  }
  // Count download clicks (GoatCounter, no cookies). Off unless version.js sets a code.
  if (R && R.goatcounter) {
    document.addEventListener("click", (e) => {
      const a = e.target.closest && e.target.closest("a[href]");
      if (!a || (a.href !== R.windows.href && a.href !== R.mac.href)) return;
      const os = a.href === R.mac.href ? "macos" : "windows";
      const q = new URLSearchParams({ p: `/download/${os}/${R.version}`, t: `Download ${os} ${R.version}`, e: "true", rnd: Math.random().toString(36).slice(2) });
      new Image().src = `https://${R.goatcounter}.goatcounter.com/count?${q}`;
    });
  }
  // Put the visitor's OS first.
  const plat = ((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || navigator.userAgent || "").toLowerCase();
  const isMac = /mac|iphone|ipad/.test(plat);
  if (isMac) {
    const p = $(".dl-primary"), s = $(".dl-secondary");
    if (p && s) {
      const tmp = p.innerHTML; p.innerHTML = s.innerHTML; s.innerHTML = tmp;
      const h = p.href; p.href = s.href; s.href = h;
      p.dataset.os = "mac"; s.dataset.os = "windows";
      $(".dl-label", p).textContent = "Download for macOS";
      $(".dl-label", s).textContent = "Windows";
      if (R) { const m = $('.meta [data-rel="winsize"]'); if (m) m.textContent = R.mac.size; }
    }
  }
  const recCard = $(isMac ? '.dl-card[data-rel="machref"]' : '.dl-card[data-rel="winhref"]');
  if (recCard) recCard.classList.add("rec");

  // ------------------------------------------------------------ split text
  // Wrap every word in a clipping span so it can rise out of a mask. Text stays real text.
  function split(el) {
    let n = 0;
    const walk = (node) => {
      Array.from(node.childNodes).forEach((c) => {
        if (c.nodeType === 3) {
          const parts = c.textContent.split(/(\s+)/);
          const frag = document.createDocumentFragment();
          parts.forEach((w) => {
            if (!w) return;
            if (/^\s+$/.test(w)) { frag.appendChild(document.createTextNode(" ")); return; }
            const o = document.createElement("span"); o.className = "w";
            const i = document.createElement("span"); i.textContent = w; i.style.setProperty("--i", n++);
            o.appendChild(i); frag.appendChild(o);
          });
          node.replaceChild(frag, c);
        } else if (c.nodeType === 1 && c.tagName !== "BR") walk(c);
      });
    };
    walk(el);
  }
  $$(".split").forEach(split);
  $$(".hero .specs li").forEach((li, i) => li.style.setProperty("--i", i));

  // ------------------------------------------------------------ header + reveal
  const top = $("#top");
  const onScroll = () => { top.classList.toggle("scrolled", window.scrollY > 8); kick(); };
  window.addEventListener("scroll", onScroll, { passive: true });

  const revealTargets = $$(".reveal, .split:not(.display), [data-count], [data-count-text]");
  if ("IntersectionObserver" in window && !reduced) {
    const io = new IntersectionObserver((ents) => ents.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); if (e.target.matches("[data-count], [data-count-text]")) startCount(e.target); }
    }), { rootMargin: "0px 0px -8% 0px" });
    revealTargets.forEach((el) => io.observe(el));
  } else revealTargets.forEach((el) => el.classList.add("in"));

  // ------------------------------------------------------------ helpers
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function hsv(h, s, v) {
    h = ((h % 1) + 1) % 1; const i = Math.floor(h * 6), f = h * 6 - i;
    const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
    return [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
  }
  const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
  const css = (c, a = 1) => `rgba(${(c[0] * 255) | 0},${(c[1] * 255) | 0},${(c[2] * 255) | 0},${a})`;
  function radioGroup(el, onPick) {
    const items = () => $$('[role="radio"]', el);
    el.addEventListener("keydown", (e) => {
      const list = items(), i = list.indexOf(document.activeElement);
      if (i < 0) return;
      const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!d) return;
      e.preventDefault();
      const n = list[(i + d + list.length) % list.length];
      n.focus(); onPick(n);
    });
    el.addEventListener("click", (e) => { const b = e.target.closest('[role="radio"]'); if (b) onPick(b); });
  }
  function syncRadios(el, pred) {
    $$('[role="radio"]', el).forEach((b) => {
      const on = pred(b); b.setAttribute("aria-checked", on); b.tabIndex = on ? 0 : -1;
    });
  }

  // ------------------------------------------------------------ loop
  const parts = [];
  let running = false, last = 0;
  function tick(now) {
    running = false;
    const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
    let any = false;
    for (const p of parts) if (p.visible && !document.hidden && p.wants()) { p.frame(now / 1000, dt); any = true; }
    if (any) { running = true; requestAnimationFrame(tick); } else last = 0;
  }
  function kick() { if (!running) { running = true; requestAnimationFrame(tick); } }
  function addPart(p, el) {
    p.visible = false; parts.push(p);
    if ("IntersectionObserver" in window) {
      new IntersectionObserver((ents) => { p.visible = ents[0].isIntersecting; if (p.visible) { p.dirty = true; kick(); } }).observe(el);
    } else p.visible = true;
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) kick(); });
  onScroll();

  // ------------------------------------------------------------ smooth scroll (Lenis, driven by our loop)
  // Only for fine pointers with motion allowed; native scroll stays the source of truth,
  // so sticky, anchors, keyboard scrolling and find-in-page keep working.
  let lenis = null, lastWheel = -10, prevY = window.scrollY, vel = 0;
  if (window.Lenis && !reduced && window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
    lenis = new window.Lenis({ lerp: 0.115, anchors: { offset: -64 }, autoRaf: false });
    parts.push({
      visible: true,
      wants: () => !!lenis.isScrolling || performance.now() / 1000 - lastWheel < 0.5,
      frame(t) { const ms = t * 1000; if (!lenis.time || ms - lenis.time > 100) lenis.time = ms - 16; lenis.raf(ms); },
    });
    window.addEventListener("wheel", () => { lastWheel = performance.now() / 1000; kick(); }, { passive: true });
    document.addEventListener("click", () => setTimeout(kick, 0));
  }
  // scroll velocity (px/s), smoothed — feeds the marquee
  parts.push({ visible: true, wants: () => Math.abs(vel) > 2 || window.scrollY !== prevY, frame(t, dt) {
    const y = window.scrollY, v = dt > 0 ? (y - prevY) / dt : 0; prevY = y; vel += (v - vel) * 0.2; if (Math.abs(vel) < 2) vel = 0;
  } });

  // ------------------------------------------------------------ number tickers
  const counting = [];
  function startCount(el) {
    if (el.dataset.done) return; el.dataset.done = 1;
    let to, pre = el.dataset.prefix || "", suf = el.dataset.suffix || "";
    if (el.hasAttribute("data-count-text")) {
      const m = el.textContent.match(/^(\D*)([\d.]+)(.*)$/); if (!m) return;
      pre = m[1]; to = parseFloat(m[2]); suf = m[3];
    } else to = parseFloat(el.dataset.count);
    const from = parseFloat(el.dataset.from || 0);
    if (reduced) return;
    counting.push({ el, from, to, pre, suf, t0: performance.now() / 1000 + (el.closest(".hero") ? 1.1 : 0.15), dur: 1.6 });
    el.textContent = pre + from + suf; kick();
  }
  parts.push({ visible: true, wants: () => counting.length > 0, frame(t) {
    for (let i = counting.length - 1; i >= 0; i--) {
      const c = counting[i], k = clamp((t - c.t0) / c.dur, 0, 1), e = 1 - Math.pow(2, -10 * k);
      c.el.textContent = c.pre + Math.round(c.from + (c.to - c.from) * (k >= 1 ? 1 : e)) + c.suf;
      if (k >= 1) counting.splice(i, 1);
    }
  } });

  // ------------------------------------------------------------ magnetic buttons + card spotlight
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  if (finePointer && !reduced) {
    $$(".btn-lg, .top .btn, .dl-card").forEach((el) => {
      el.classList.add("mag");
      let inner = null;
      if (el.classList.contains("btn")) { inner = document.createElement("span"); inner.className = "mag-in"; while (el.firstChild) inner.appendChild(el.firstChild); el.appendChild(inner); }
      el.addEventListener("pointermove", (e) => {
        const r = el.getBoundingClientRect(), dx = e.clientX - r.left - r.width / 2, dy = e.clientY - r.top - r.height / 2;
        el.style.transform = `translate(${dx * 0.22}px, ${dy * 0.3}px)`;
        if (inner) inner.style.transform = `translate(${dx * 0.1}px, ${dy * 0.12}px)`;
      });
      el.addEventListener("pointerleave", () => { el.style.transform = ""; if (inner) inner.style.transform = ""; });
    });
    $$(".card").forEach((card) => {
      card.insertAdjacentHTML("afterbegin", '<span class="glow" aria-hidden="true"><i></i></span><span class="glow ring" aria-hidden="true"><i></i></span>');
      card.addEventListener("pointerenter", () => card.classList.add("lit"));
      card.addEventListener("pointerleave", () => card.classList.remove("lit"));
      card.addEventListener("pointermove", (e) => {
        const r = card.getBoundingClientRect();
        card.style.setProperty("--gx", (e.clientX - r.left) + "px"); card.style.setProperty("--gy", (e.clientY - r.top) + "px");
      });
    });
  }
  mqReduce.addEventListener && mqReduce.addEventListener("change", (e) => { reduced = e.matches; parts.forEach((p) => (p.dirty = true)); kick(); });

  // ================================================================ KEYBOARD
  // label, width (u), Fn sub-legend — the GK61's real 61-key layout
  const LAYOUT = [
    [["Esc", 1, "`"], ["1", 1, "F1"], ["2", 1, "F2"], ["3", 1, "F3"], ["4", 1, "F4"], ["5", 1, "F5"], ["6", 1, "F6"], ["7", 1, "F7"], ["8", 1, "F8"], ["9", 1, "F9"], ["0", 1, "F10"], ["-", 1, "F11"], ["=", 1, "F12"], ["Backspace", 2, "Del"]],
    [["Tab", 1.5], ["Q", 1], ["W", 1], ["E", 1], ["R", 1], ["T", 1], ["Y", 1], ["U", 1], ["I", 1], ["O", 1], ["P", 1], ["[", 1], ["]", 1], ["\\", 1.5]],
    [["Caps", 1.75], ["A", 1], ["S", 1], ["D", 1], ["F", 1], ["G", 1], ["H", 1], ["J", 1], ["K", 1], ["L", 1], [";", 1], ["'", 1], ["Enter", 2.25]],
    [["Shift", 2.25], ["Z", 1], ["X", 1], ["C", 1], ["V", 1], ["B", 1], ["N", 1], ["M", 1], [",", 1], [".", 1], ["/", 1], ["Shift", 2.75]],
    [["Ctrl", 1.25], ["Win", 1.25], ["Alt", 1.25], ["", 6.25], ["Alt", 1.25], ["Menu", 1.25], ["Ctrl", 1.25], ["Fn", 1.25]],
  ];
  const SHORT = { Backspace: "⌫", Enter: "⏎", Shift: "⇧", Tab: "⇥", Caps: "⇪", Ctrl: "Ctl", Menu: "☰" };
  const KEYS = [];
  LAYOUT.forEach((row, r) => {
    let x = 0;
    row.forEach(([label, w, sub]) => { KEYS.push({ label, w, sub, x, y: r, cx: x + w / 2, cy: r + 0.5 }); x += w; });
  });
  const N = KEYS.length; // 61
  const idxOf = (label, nth = 0) => KEYS.filter((k) => k.label === label)[nth] && KEYS.indexOf(KEYS.filter((k) => k.label === label)[nth]);
  const SPACE = KEYS.findIndex((k) => k.w === 6.25), FN = idxOf("Fn");
  const CODE = {};
  KEYS.forEach((k, i) => {
    if (/^[A-Z]$/.test(k.label)) CODE["Key" + k.label] = i;
    if (/^[0-9]$/.test(k.label)) CODE["Digit" + k.label] = i;
  });
  Object.assign(CODE, {
    Escape: idxOf("Esc"), Backquote: idxOf("Esc"), Minus: idxOf("-"), Equal: idxOf("="), Backspace: idxOf("Backspace"),
    Tab: idxOf("Tab"), BracketLeft: idxOf("["), BracketRight: idxOf("]"), Backslash: idxOf("\\"), CapsLock: idxOf("Caps"),
    Semicolon: idxOf(";"), Quote: idxOf("'"), Enter: idxOf("Enter"), NumpadEnter: idxOf("Enter"),
    ShiftLeft: idxOf("Shift"), ShiftRight: idxOf("Shift", 1), Comma: idxOf(","), Period: idxOf("."), Slash: idxOf("/"),
    ControlLeft: idxOf("Ctrl"), MetaLeft: idxOf("Win"), OSLeft: idxOf("Win"), AltLeft: idxOf("Alt"), Space: SPACE,
    AltRight: idxOf("Alt", 1), ContextMenu: idxOf("Menu"), MetaRight: idxOf("Menu"), ControlRight: idxOf("Ctrl", 1),
  });
  // Keys the GK61 reaches through its Fn layer: light Fn + the base key.
  const FNCODE = { Delete: idxOf("Backspace") };
  for (let i = 1; i <= 12; i++) FNCODE["F" + i] = KEYS.findIndex((k) => k.sub === "F" + i);
  ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown", "Insert", "PrintScreen"].forEach((c) => (FNCODE[c] = -1));

  const PALETTE = ["#d4ff3a", "#ff4d4d", "#5ee08a", "#3a7bff", "#ffd23a", "#b26cff", "#3ae0e0", "#ffffff", "#000000"];
  const PAL_NAMES = ["Lime", "Red", "Green", "Blue", "Yellow", "Purple", "Cyan", "White", "Off"];
  const paint = KEYS.map((k, i) => {
    if (i === idxOf("Esc")) return hex("#ff4d4d");
    if (["W", "A", "S", "D"].includes(k.label) || i === SPACE) return hex("#d4ff3a");
    if (k.y === 0) return hex("#ffd23a");
    if (/^[A-Z]$/.test(k.label)) return hex("#3ae0e0");
    if (k.w > 1 || k.y === 4) return hex("#b26cff");
    return hex("#3a7bff");
  });

  const stage = $("#stage"), cv = $("#kb"), ctx = cv.getContext("2d");
  const hint = $("#hint");
  const col = KEYS.map(() => [0, 0, 0]);
  const heat = new Float32Array(N), hhue = new Float32Array(N);
  const ripples = [];
  let fx = "wave", cycling = !reduced, fxStart = 0, lastReal = -10, autoAt = 0, autoI = 0, frozenT = 4.2;
  let G = null; // geometry + static layers
  let bootT = reduced ? 0 : -1; // -1 = dark, waiting for intro; 0 = done
  let brush = 0, painting = false;

  function rr(c, x, y, w, h, r) { c.beginPath(); c.roundRect ? c.roundRect(x, y, w, h, r) : c.rect(x, y, w, h); }
  function layout() {
    const w = cv.clientWidth; if (!w) return;
    const narrow = w < 640;
    const padX = narrow ? 0.45 : 1.6, padY = narrow ? 0.7 : 1.0;
    const u = w / (15 + padX * 2), h = u * (5 + padY * 2);
    cv.style.height = h + "px";
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    const ox = padX * u, oy = padY * u, gap = u * 0.07;
    const mk = () => { const c = document.createElement("canvas"); c.width = cv.width; c.height = cv.height; const x = c.getContext("2d"); x.scale(dpr, dpr); return [c, x]; };
    // case
    const [caseC, cc] = mk();
    const cm = u * 0.32;
    rr(cc, ox - cm, oy - cm, 15 * u + cm * 2, 5 * u + cm * 2, u * 0.32);
    let g = cc.createLinearGradient(0, oy - cm, 0, oy + 5 * u + cm);
    g.addColorStop(0, "#1c1f24"); g.addColorStop(1, "#101215");
    cc.fillStyle = g; cc.fill();
    cc.strokeStyle = "rgba(255,255,255,.07)"; cc.lineWidth = 1; cc.stroke();
    rr(cc, ox - u * 0.06, oy - u * 0.06, 15 * u + u * 0.12, 5 * u + u * 0.12, u * 0.14);
    cc.fillStyle = "#07080a"; cc.fill();
    // caps
    const [capC, kc] = mk();
    const faces = [];
    KEYS.forEach((k) => {
      const x = ox + k.x * u + gap / 2, y = oy + k.y * u + gap / 2, kw = k.w * u - gap, kh = u - gap;
      rr(kc, x, y, kw, kh, u * 0.11);
      kc.fillStyle = "rgba(14,15,18,.93)"; kc.fill();
      const ix = u * 0.07, it = u * 0.04, ib = u * 0.13;
      const f = new Path2D();
      f.roundRect ? f.roundRect(x + ix, y + it, kw - ix * 2, kh - it - ib, u * 0.08) : f.rect(x + ix, y + it, kw - ix * 2, kh - it - ib);
      const fg = kc.createLinearGradient(0, y, 0, y + kh);
      fg.addColorStop(0, "#262a31"); fg.addColorStop(1, "#1b1e23");
      kc.fillStyle = fg; kc.fill(f);
      kc.strokeStyle = "rgba(255,255,255,.06)"; kc.lineWidth = 1; kc.stroke(f);
      faces.push({ f, x, y, kw, kh, fx: x + ix, fy: y + it, fw: kw - ix * 2, fh: kh - it - ib });
    });
    // light maps: hi = 4 px per unit for the plate, lo = 1 px per unit for the halo; 2-unit transparent border
    const hi = document.createElement("canvas"); hi.width = 19 * 4; hi.height = 9 * 4;
    const lo = document.createElement("canvas"); lo.width = 19; lo.height = 9;
    G = { u, ox, oy, dpr, w, h, narrow, caseC, capC, faces, hi, hx: hi.getContext("2d"), lo, lx: lo.getContext("2d"),
      font: `500 ${Math.max(8, u * 0.2)}px Plex, system-ui, sans-serif`, sfont: `500 ${Math.max(7, u * 0.14)}px Mono, monospace` };
    kb.dirty = true;
  }

  // effects -> col[]
  const BREATH = ["#d4ff3a", "#3ae0e0", "#b26cff", "#ff4d4d", "#ffffff"].map(hex);
  function compute(t, dt) {
    if (bootT > 0 && t - bootT > 2.2) bootT = 0;
    for (let i = 0; i < N; i++) heat[i] = Math.max(0, heat[i] - dt * (fx === "react" ? 1.1 : 1.8));
    for (let j = ripples.length - 1; j >= 0; j--) if (t - ripples[j].t0 > 2.6) ripples.splice(j, 1);
    if (fx === "ripple" && !reduced && t - lastReal > 2 && t > autoAt) {
      const k = KEYS[(Math.random() * N) | 0]; ripples.push({ x: k.cx, y: k.cy, t0: t, h: Math.random() }); autoAt = t + 0.9 + Math.random() * 0.6;
    }
    if (fx === "react" && !reduced && t - lastReal > 2.5 && t > autoAt) {
      const word = "periph is light  ";
      const ch = word[autoI++ % word.length];
      if (ch !== " " || autoI % word.length) {
        const i = ch === " " ? SPACE : CODE["Key" + ch.toUpperCase()];
        if (i != null) press(i, t, false);
      }
      autoAt = t + (autoI % word.length === 0 ? 1.4 : 0.11 + Math.random() * 0.12);
    }
    for (let i = 0; i < N; i++) {
      const k = KEYS[i], c = col[i];
      let r = 0, g = 0, b = 0;
      if (fx === "wave") {
        [r, g, b] = hsv(k.cx * 0.045 + k.cy * 0.03 - t * 0.2, 0.85, 1);
      } else if (fx === "breathe") {
        const P = 3.4, n = Math.floor(t / P), f = (t % P) / P, lv = Math.pow(Math.sin(Math.PI * f), 2) * 0.92 + 0.04;
        const bc = BREATH[n % BREATH.length]; r = bc[0] * lv; g = bc[1] * lv; b = bc[2] * lv;
      } else if (fx === "ripple") {
        r = g = b = 0.025;
        for (const rp of ripples) {
          const age = t - rp.t0, d = Math.hypot(k.cx - rp.x, (k.cy - rp.y) * 1.1), rad = age * 7.5;
          const a = Math.exp(-((d - rad) ** 2) / 0.9) * Math.max(0, 1 - age / 2.4);
          if (a > 0.004) { const rc = hsv(rp.h, 0.8, 1); r += rc[0] * a; g += rc[1] * a; b += rc[2] * a; }
        }
      } else if (fx === "react") {
        r = 0.07; g = 0.09; b = 0.03;
      } else if (fx === "paint") {
        [r, g, b] = paint[i];
      }
      const h = heat[i];
      if (h > 0) {
        if (fx === "react") { const hc = hsv(hhue[i], 0.75, 1); const e = Math.pow(h, 1.4); r += hc[0] * e; g += hc[1] * e; b += hc[2] * e; }
        else { const e = h * 0.85; r += (1 - r) * e; g += (1 - g) * e; b += (1 - b) * e; }
      }
      if (bootT !== 0) { // power-on sweep from left to right, lime wavefront
        const sw = bootT < 0 ? -9 : (t - bootT) * 15 - 1.5, on = clamp((sw - k.cx) / 2.5, 0, 1), front = Math.exp(-((sw - k.cx) ** 2) / 1.2);
        r = r * on + 0.83 * front; g = g * on + 1 * front; b = b * on + 0.23 * front;
      }
      c[0] = Math.min(1, r); c[1] = Math.min(1, g); c[2] = Math.min(1, b);
    }
  }

  function draw() {
    if (!G) return;
    const { u, ox, oy, dpr, faces, hx, lx, hi, lo } = G;
    // light maps
    hx.clearRect(0, 0, hi.width, hi.height); lx.clearRect(0, 0, lo.width, lo.height);
    KEYS.forEach((k, i) => {
      hx.fillStyle = css(col[i]); hx.fillRect((k.x + 2) * 4, (k.y + 2) * 4, k.w * 4, 4);
      lx.fillStyle = css(col[i]); lx.fillRect(k.x + 2, k.y + 2, k.w, 1);
    });
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, G.w, G.h);
    ctx.imageSmoothingEnabled = true;
    // halo
    if (!G.narrow) { ctx.globalAlpha = 0.7; ctx.drawImage(lo, ox - 2.3 * u, oy - 2.1 * u, 19.6 * u, 9.2 * u); ctx.globalAlpha = 1; }
    ctx.drawImage(G.caseC, 0, 0, G.w, G.h);
    // backlight on the plate
    ctx.save(); rr(ctx, ox - u * 0.06, oy - u * 0.06, 15 * u + u * 0.12, 5 * u + u * 0.12, u * 0.14); ctx.clip();
    ctx.globalAlpha = 0.85; ctx.drawImage(hi, ox - 2 * u, oy - 2 * u, 19 * u, 9 * u); ctx.globalAlpha = 1;
    ctx.restore();
    ctx.drawImage(G.capC, 0, 0, G.w, G.h);
    // per-key tint, legends
    ctx.textBaseline = "alphabetic";
    for (let i = 0; i < N; i++) {
      const k = KEYS[i], f = faces[i], c = col[i];
      const lum = Math.max(c[0], c[1], c[2]);
      if (lum > 0.02) {
        // light bleeding up the skirt + a faint wash on the face
        const g = ctx.createLinearGradient(0, f.y + f.kh * 0.55, 0, f.y + f.kh);
        g.addColorStop(0, css(c, 0)); g.addColorStop(1, css(c, 0.28 * lum));
        ctx.fillStyle = g; rr(ctx, f.x, f.y, f.kw, f.kh, u * 0.11); ctx.fill();
        ctx.fillStyle = css(c, 0.06 + 0.06 * lum); ctx.fill(f.f);
      }
      const lab = G.narrow || u < 34 ? (SHORT[k.label] || k.label) : k.label;
      if (lab) {
        const m = 0.35 + 0.65 * lum;
        const lc = [0.29 + (Math.min(1, c[0] * 0.75 + 0.25) - 0.29) * m, 0.31 + (Math.min(1, c[1] * 0.75 + 0.25) - 0.31) * m, 0.34 + (Math.min(1, c[2] * 0.75 + 0.25) - 0.34) * m];
        ctx.fillStyle = css(lc);
        ctx.font = G.font;
        if (lum > 0.3 && !G.narrow) { ctx.shadowColor = css(c, 0.8); ctx.shadowBlur = u * 0.16 * lum; }
        if (G.narrow) { ctx.textAlign = "center"; ctx.fillText(lab, f.fx + f.fw / 2, f.fy + f.fh * 0.68); }
        else { ctx.textAlign = "left"; ctx.fillText(lab, f.fx + u * 0.1, f.fy + u * 0.27); }
        ctx.shadowBlur = 0;
      }
      if (k.sub && !G.narrow && u >= 40) {
        ctx.font = G.sfont; ctx.textAlign = "right"; ctx.fillStyle = "rgba(139,144,152,.55)";
        ctx.fillText(k.sub, f.fx + f.fw - u * 0.08, f.fy + f.fh - u * 0.08);
      }
    }
  }

  function press(i, t, real) {
    if (i == null || i < 0) return;
    heat[i] = 1; hhue[i] = (t * 0.15 + KEYS[i].cx * 0.04) % 1;
    if (fx === "ripple" || (fx === "react" && real)) ripples.push({ x: KEYS[i].cx, y: KEYS[i].cy, t0: t, h: (t * 0.2) % 1 });
    if (fx === "react") {
      for (let j = 0; j < N; j++) {
        if (j === i) continue;
        const d = Math.hypot(KEYS[j].cx - KEYS[i].cx, KEYS[j].cy - KEYS[i].cy);
        if (d < 1.6) { const v = 0.45 * (1 - d / 1.6); if (v > heat[j]) { heat[j] = v; hhue[j] = hhue[i]; } }
      }
    }
    if (real) lastReal = t;
    kb.dirty = true;
  }

  let shownHint = false;
  window.addEventListener("keydown", (e) => {
    if (!kb.visible || e.ctrlKey && e.key === "Tab") return;
    const tg = e.target;
    if (tg && (tg.closest("input, select, textarea, [contenteditable]"))) return;
    const t = performance.now() / 1000;
    let i = CODE[e.code];
    if (i == null && e.code in FNCODE) { press(FN, t, true); i = FNCODE[e.code]; }
    if (i == null) return;
    press(i, t, true);
    if (fx === "react" && reduced) setTimeout(() => { heat.fill(0); kb.dirty = true; kick(); }, 700);
    if (!shownHint) { shownHint = true; if (fx !== "paint") hint.innerHTML = 'Yep — that\'s the key on the GK61. Try <b>Reactive</b> or <b>Ripple</b>.'; }
    kick();
  });

  // effect buttons
  const fxBtns = $$(".fx-b");
  const order = ["wave", "ripple", "breathe", "react"];
  const swWrap = $("#swatches");
  function setFx(name, user) {
    if (user) cycling = false;
    if (user && name === fx) { fxBtns.forEach((b) => ($("i", b).style.transform = "scaleX(0)")); return; }
    fx = name; fxStart = performance.now() / 1000; autoAt = 0; ripples.length = 0; heat.fill(0);
    fxBtns.forEach((b) => { b.setAttribute("aria-pressed", b.dataset.fx === name); $("i", b).style.transform = "scaleX(0)"; });
    stage.classList.toggle("flat", name === "paint");
    swWrap.hidden = name !== "paint";
    if (name === "paint") hint.textContent = "Click or drag across the keys to paint them.";
    else if (user) hint.innerHTML = "<kbd>type</kbd> anything — the board is listening";
    kb.dirty = true; kick();
  }
  fxBtns.forEach((b) => b.addEventListener("click", () => setFx(b.dataset.fx, true)));
  PALETTE.forEach((p, i) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "sw"; b.style.background = p === "#000000" ? "#1d2026" : p;
    b.setAttribute("aria-label", PAL_NAMES[i]); b.setAttribute("aria-pressed", i === 0);
    b.addEventListener("click", () => { brush = i; $$(".sw", swWrap).forEach((s, j) => s.setAttribute("aria-pressed", j === i)); });
    swWrap.appendChild(b);
  });
  function keyAt(ev) {
    if (!G) return -1;
    const r = cv.getBoundingClientRect();
    const x = ((ev.clientX - r.left) / r.width * G.w - G.ox) / G.u, y = ((ev.clientY - r.top) / r.height * G.h - G.oy) / G.u;
    return KEYS.findIndex((k) => x >= k.x && x < k.x + k.w && y >= k.y && y < k.y + 1);
  }
  function paintAt(ev) {
    const i = keyAt(ev); if (i < 0) return;
    paint[i] = hex(PALETTE[brush]); updateMini(); kb.dirty = true; kick();
  }
  cv.addEventListener("pointerdown", (e) => {
    if (fx !== "paint") { const i = keyAt(e); if (i >= 0) { press(i, performance.now() / 1000, true); kick(); } return; }
    painting = true; cv.setPointerCapture(e.pointerId); paintAt(e);
  });
  cv.addEventListener("pointermove", (e) => { if (painting) paintAt(e); });
  const endPaint = () => (painting = false);
  cv.addEventListener("pointerup", endPaint); cv.addEventListener("pointercancel", endPaint);

  // mini painted board in the bento card mirrors the hero's paint layer
  const mini = $("#mini-paint"), miniKeys = [];
  if (mini) {
    LAYOUT.forEach((row) => {
      const r = document.createElement("div"); r.className = "r";
      row.forEach(([, w]) => { const k = document.createElement("span"); k.className = "k"; k.style.flex = `${w} 1 0`; r.appendChild(k); miniKeys.push(k); });
      mini.appendChild(r);
    });
  }
  function updateMini() {
    miniKeys.forEach((k, i) => {
      const c = paint[i], on = Math.max(...c) > 0.02;
      k.style.background = on ? css(c, 0.9) : "";
      k.style.boxShadow = on ? `0 0 14px ${css(c, 0.35)}, inset 0 -3px 0 rgba(0,0,0,.25)` : "";
    });
  }
  updateMini();

  const kb = {
    dirty: true,
    wants() { return this.dirty || (!reduced) || heat.some((h) => h > 0); },
    frame(t, dt) {
      if (cycling && !reduced && fx !== "paint") {
        const p = (t - fxStart) / 7;
        const bar = $(`.fx-b[data-fx="${fx}"] i`); if (bar) bar.style.transform = `scaleX(${clamp(p, 0, 1)})`;
        if (p >= 1) setFx(order[(order.indexOf(fx) + 1) % order.length], false);
      }
      compute(reduced ? frozenT : t, reduced ? (heat.some((h) => h > 0) ? dt : 0) : dt);
      draw(); this.dirty = false;
    },
  };
  addPart(kb, stage);
  fxStart = performance.now() / 1000;
  if ("ResizeObserver" in window) new ResizeObserver(() => { layout(); kick(); }).observe(cv.parentElement);
  else window.addEventListener("resize", () => { layout(); kick(); });
  layout();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { kb.dirty = true; kick(); });

  // ================================================================ MOUSE
  const stagesEl = $("#stages"), slider = $("#dpi"), dpiVal = $("#dpi-val"), stageName = $("#stage-name");
  const padMult = $("#pad-mult"), pollEl = $("#poll"), pollMs = $("#poll-ms"), svg = $("#g305"), led = $(".led", svg);
  const M = { dpis: [400, 800, 1600, 3200, 6400], cur: 2, hz: 1000 };
  stagesEl.innerHTML = M.dpis.map((d, i) => `<button type="button" class="stg" role="radio" data-i="${i}"><small>STAGE ${i + 1}</small><b>${d}</b></button>`).join("");
  function renderStages(flash) {
    syncRadios(stagesEl, (b) => +b.dataset.i === M.cur);
    $$(".stg", stagesEl).forEach((b, i) => { $("b", b).textContent = M.dpis[i]; b.setAttribute("aria-label", `Stage ${i + 1}, ${M.dpis[i]} DPI`); });
    const d = M.dpis[M.cur];
    slider.value = d; slider.style.setProperty("--p", ((d - 200) / (12000 - 200) * 100).toFixed(1) + "%");
    dpiVal.textContent = d; stageName.textContent = `Stage ${M.cur + 1}`;
    slider.setAttribute("aria-label", `Stage ${M.cur + 1} DPI`);
    padMult.textContent = (d / 800).toFixed(d / 800 < 10 ? 1 : 0) + "×";
    if (flash && led) { led.style.opacity = 1; clearTimeout(renderStages.t); renderStages.t = setTimeout(() => (led.style.opacity = 0), 500); }
  }
  radioGroup(stagesEl, (b) => { M.cur = +b.dataset.i; renderStages(true); });
  slider.addEventListener("input", () => { M.dpis[M.cur] = +slider.value; renderStages(false); });
  function renderPoll() {
    syncRadios(pollEl, (b) => +b.dataset.hz === M.hz);
    const ms = 1000 / M.hz; pollMs.textContent = `${ms % 1 ? ms.toFixed(1) : ms} ms between reports`;
  }
  radioGroup(pollEl, (b) => { M.hz = +b.dataset.hz; renderPoll(); });
  renderStages(false); renderPoll();

  // buttons
  const ZONES = ["Left", "Right", "Wheel click", "Side · rear", "Side · front", "Top"];
  const ACTIONS = ["Left Click", "Right Click", "Middle Click", "Back", "Forward", "DPI Up", "DPI Down", "DPI Cycle", "DPI Shift (hold)", "Volume Up", "Volume Down", "Mute", "Play/Pause", "Next Track", "Previous Track", "Key: Ctrl+C", "Key: Ctrl+V", "Key: Alt+Tab", "Disabled"];
  const binds = ["Left Click", "Right Click", "Middle Click", "Back", "Forward", "DPI Cycle"];
  const list = $("#btnlist");
  list.innerHTML = binds.map((b, i) => `<li data-b="${i}"><span class="n">${i + 1}</span><span class="w"><span class="z">${ZONES[i]}</span>
    <select aria-label="Button ${i + 1}, ${ZONES[i]}">${ACTIONS.map((a) => `<option${a === b ? " selected" : ""}>${a}</option>`).join("")}</select></span></li>`).join("");
  const out = document.createElement("p");
  out.className = "small mono dim"; out.setAttribute("aria-live", "polite"); out.textContent = "Click a button on the mouse.";
  $(".mouse-vis").appendChild(out);
  function hl(i, on) {
    $$(`.mb[data-b="${i}"]`, svg).forEach((g) => g.classList.toggle("hl", on));
    const li = $(`li[data-b="${i}"]`, list); if (li) li.classList.toggle("hl", on);
    const num = $$(".nums text", svg).find((t) => t.textContent === String(i + 1)); if (num) num.classList.toggle("hl", on);
  }
  $$("li", list).forEach((li) => {
    const i = +li.dataset.b;
    li.addEventListener("pointerenter", () => hl(i, true)); li.addEventListener("pointerleave", () => hl(i, false));
    li.addEventListener("focusin", () => hl(i, true)); li.addEventListener("focusout", () => hl(i, false));
    $("select", li).addEventListener("change", (e) => { binds[i] = e.target.value; out.textContent = `Button ${i + 1} → ${binds[i]}`; });
  });
  function fire(i) {
    const a = binds[i];
    const g = $(`.mb[data-b="${i}"]`, svg); g.classList.add("press"); setTimeout(() => g.classList.remove("press"), 160);
    if (a === "DPI Cycle") { M.cur = (M.cur + 1) % M.dpis.length; renderStages(true); }
    else if (a === "DPI Up") { M.cur = Math.min(M.dpis.length - 1, M.cur + 1); renderStages(true); }
    else if (a === "DPI Down") { M.cur = Math.max(0, M.cur - 1); renderStages(true); }
    out.textContent = `Button ${i + 1} → ${a}${a.startsWith("DPI") && a !== "DPI Shift (hold)" ? ` · ${M.dpis[M.cur]} DPI` : ""}`;
  }
  $$(".mb", svg).forEach((g) => {
    const i = +g.dataset.b;
    g.setAttribute("tabindex", "0"); g.setAttribute("role", "button"); g.setAttribute("aria-label", `Button ${i + 1}, ${ZONES[i]}`);
    g.addEventListener("click", () => fire(i));
    g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fire(i); } });
    g.addEventListener("pointerenter", () => hl(i, true)); g.addEventListener("pointerleave", () => hl(i, false));
    g.addEventListener("focus", () => hl(i, true)); g.addEventListener("blur", () => hl(i, false));
  });

  // DPI pad
  const pad = $("#pad"), px = pad.getContext("2d");
  const P = { w: 0, h: 0, dpr: 1, x: 0, y: 0, last: null, lastMove: -10, trail: [], lastSample: 0, dirty: true, grid: null, tt: 0 };
  function padLayout() {
    const w = pad.clientWidth, h = pad.clientHeight; if (!w) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    pad.width = w * dpr; pad.height = h * dpr;
    Object.assign(P, { w, h, dpr });
    if (!P.x) { P.x = w / 2; P.y = h / 2; }
    const g = document.createElement("canvas"); g.width = pad.width; g.height = pad.height;
    const gx = g.getContext("2d"); gx.scale(dpr, dpr); gx.fillStyle = "rgba(255,255,255,.07)";
    for (let x = 12; x < w; x += 20) for (let y = 12; y < h; y += 20) gx.fillRect(x, y, 1.5, 1.5);
    P.grid = g; padPart.dirty = true;
  }
  function moveBy(dx, dy, t) {
    const m = M.dpis[M.cur] / 800;
    let nx = P.x + dx * m, ny = P.y + dy * m, wrapped = false;
    if (nx < 0 || nx > P.w || ny < 0 || ny > P.h) { nx = (nx % P.w + P.w) % P.w; ny = (ny % P.h + P.h) % P.h; wrapped = true; }
    P.x = nx; P.y = ny;
    if (wrapped) P.trail.push(null);
    const interval = 8 * 1000 / M.hz / 1000; // polling interval, slowed 8x so it's visible
    if (wrapped || t - P.lastSample >= interval) { P.trail.push({ x: nx, y: ny, t }); P.lastSample = t; }
  }
  pad.addEventListener("pointermove", (e) => {
    const t = performance.now() / 1000;
    if (P.last && e.pointerType !== "mouse" && e.buttons === 0) { P.last = null; return; }
    if (P.last) moveBy(e.clientX - P.last[0], e.clientY - P.last[1], t);
    P.last = [e.clientX, e.clientY]; P.lastMove = t; padPart.dirty = true; kick();
  });
  pad.addEventListener("pointerdown", (e) => { P.last = [e.clientX, e.clientY]; pad.setPointerCapture && pad.setPointerCapture(e.pointerId); });
  pad.addEventListener("pointerleave", () => (P.last = null));
  pad.addEventListener("pointerup", (e) => { if (e.pointerType !== "mouse") P.last = null; });

  const padPart = {
    dirty: true,
    wants() { return this.dirty || !reduced || performance.now() / 1000 - P.lastMove < 1.2; },
    frame(t, dt) {
      if (!P.w) return;
      if (!reduced && t - P.lastMove > 1.6) { // idle: a hand drawing loops; the dot follows at the chosen DPI
        P.tt += dt;
        const vx = Math.cos(P.tt * 1.1) * 70, vy = Math.sin(P.tt * 1.9) * 55;
        moveBy(vx * dt, vy * dt, t);
      }
      while (P.trail.length && (P.trail[0] === null || t - P.trail[0].t > 1.1)) P.trail.shift();
      px.setTransform(P.dpr, 0, 0, P.dpr, 0, 0);
      px.clearRect(0, 0, P.w, P.h);
      px.drawImage(P.grid, 0, 0, P.w, P.h);
      // trail: segments between reports
      px.lineCap = "round"; px.lineJoin = "round";
      for (let i = 1; i < P.trail.length; i++) {
        const a = P.trail[i - 1], b = P.trail[i];
        if (!a || !b) continue;
        const al = Math.max(0, 1 - (t - b.t) / 1.1);
        px.strokeStyle = `rgba(212,255,58,${al * 0.7})`; px.lineWidth = 2;
        px.beginPath(); px.moveTo(a.x, a.y); px.lineTo(b.x, b.y); px.stroke();
      }
      for (const s of P.trail) {
        if (!s) continue;
        const al = Math.max(0, 1 - (t - s.t) / 1.1);
        px.fillStyle = `rgba(236,237,238,${al * 0.8})`; px.fillRect(s.x - 1.5, s.y - 1.5, 3, 3);
      }
      // cursor
      const gr = px.createRadialGradient(P.x, P.y, 0, P.x, P.y, 26);
      gr.addColorStop(0, "rgba(212,255,58,.35)"); gr.addColorStop(1, "rgba(212,255,58,0)");
      px.fillStyle = gr; px.beginPath(); px.arc(P.x, P.y, 26, 0, Math.PI * 2); px.fill();
      px.fillStyle = "#d4ff3a"; px.beginPath(); px.arc(P.x, P.y, 4.5, 0, Math.PI * 2); px.fill();
      px.strokeStyle = "rgba(212,255,58,.5)"; px.lineWidth = 1;
      px.beginPath(); px.moveTo(P.x - 14, P.y); px.lineTo(P.x - 8, P.y); px.moveTo(P.x + 8, P.y); px.lineTo(P.x + 14, P.y);
      px.moveTo(P.x, P.y - 14); px.lineTo(P.x, P.y - 8); px.moveTo(P.x, P.y + 8); px.lineTo(P.x, P.y + 14); px.stroke();
      px.font = "500 11px Mono, monospace"; px.fillStyle = "rgba(139,144,152,.9)"; px.textAlign = "right";
      px.fillText(`${M.dpis[M.cur]} DPI · ${M.hz} Hz`, P.w - 12, P.h - 12);
      this.dirty = false;
    },
  };
  addPart(padPart, pad);
  if ("ResizeObserver" in window) new ResizeObserver(() => { padLayout(); kick(); }).observe(pad);
  padLayout();
  [stagesEl, pollEl, slider].forEach((el) => el.addEventListener("input", () => { padPart.dirty = true; kick(); }));
  [stagesEl, pollEl].forEach((el) => el.addEventListener("click", () => { padPart.dirty = true; kick(); }));

  // ================================================================ MARQUEE (scroll-velocity reactive)
  const band = $("#band");
  if (band) {
    Array.from(band.children).forEach((c) => band.appendChild(c.cloneNode(true)));
    const B = { x: 0, skew: 0, half: 0, dir: 1 };
    const measure = () => { B.half = band.scrollWidth / 2; };
    measure();
    if ("ResizeObserver" in window) new ResizeObserver(measure).observe(band);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
    const bandPart = {
      dirty: true,
      wants() { return this.dirty || !reduced; },
      frame(t, dt) {
        if (Math.abs(vel) > 30) B.dir = vel > 0 ? 1 : -1;
        const speed = reduced ? 0 : 55 + Math.min(1600, Math.abs(vel)) * 0.45;
        B.x -= speed * dt * B.dir;
        if (B.half) B.x = ((B.x % B.half) - B.half) % B.half;
        B.skew += ((reduced ? 0 : clamp(-vel / 140, -9, 9)) - B.skew) * 0.12;
        band.style.transform = `translate3d(${B.x.toFixed(1)}px,0,0) skewX(${B.skew.toFixed(2)}deg)`;
        this.dirty = false;
      },
    };
    addPart(bandPart, band.parentElement);
  }

  // ================================================================ STORY: pinned exploded view
  const story = $("#story"), scene = $("#scene");
  if (story && scene) {
    const layers = {}; $$(".ly", scene).forEach((c) => (layers[c.dataset.ly] = { c, x: c.getContext("2d") }));
    const steps = $$("#steps li"), tags = $$("#scene-tags span");
    const S = { w: 0, h: 0, u: 0, dpr: 1, step: -1 };
    function storyLayout() {
      const w = scene.clientWidth, h = scene.clientHeight; if (!w) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2), u = w / 16.2, ox = 0.6 * u, oy = 0.6 * u, gap = u * 0.08;
      Object.assign(S, { w, h, u, dpr, ox, oy });
      for (const k in layers) { const L = layers[k]; L.c.width = w * dpr; L.c.height = h * dpr; L.x.setTransform(dpr, 0, 0, dpr, 0, 0); L.x.clearRect(0, 0, w, h); }
      // case
      let x = layers.case.x;
      rr(x, ox - u * 0.45, oy - u * 0.45, 15 * u + u * 0.9, 5 * u + u * 0.9, u * 0.4);
      let g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, "#22262c"); g.addColorStop(1, "#121418");
      x.fillStyle = g; x.fill(); x.strokeStyle = "rgba(255,255,255,.08)"; x.lineWidth = 1.5; x.stroke();
      rr(x, ox - u * 0.12, oy - u * 0.12, 15 * u + u * 0.24, 5 * u + u * 0.24, u * 0.2); x.fillStyle = "#0a0b0d"; x.fill();
      // pcb + controller
      x = layers.pcb.x;
      rr(x, ox - u * 0.1, oy - u * 0.1, 15 * u + u * 0.2, 5 * u + u * 0.2, u * 0.16); x.fillStyle = "rgba(14,22,10,.96)"; x.fill();
      x.strokeStyle = "rgba(212,255,58,.35)"; x.lineWidth = 1; x.stroke();
      const mcx = ox + 7.5 * u, mcy = oy + 2.5 * u;
      x.strokeStyle = "rgba(212,255,58,.16)"; x.lineWidth = Math.max(1, u * 0.03);
      KEYS.forEach((k) => {
        const kx = ox + k.cx * u, ky = oy + k.cy * u;
        x.beginPath(); x.moveTo(kx, ky); x.lineTo(kx, mcy + (ky < mcy ? -u * 0.6 : u * 0.6)); x.lineTo(mcx + (kx - mcx) * 0.12, mcy + (ky < mcy ? -u * 0.6 : u * 0.6)); x.stroke();
      });
      KEYS.forEach((k) => {
        const kx = ox + k.cx * u, ky = oy + k.cy * u;
        x.beginPath(); x.arc(kx, ky, u * 0.17, 0, Math.PI * 2); x.strokeStyle = "rgba(212,255,58,.45)"; x.lineWidth = 1.2; x.stroke();
        x.fillStyle = "rgba(212,255,58,.55)"; x.fillRect(kx - u * 0.3, ky - u * 0.06, u * 0.07, u * 0.12); x.fillRect(kx + u * 0.23, ky - u * 0.06, u * 0.07, u * 0.12);
      });
      rr(x, mcx - u * 1.1, mcy - u * 0.55, u * 2.2, u * 1.1, u * 0.1); x.fillStyle = "#050605"; x.fill(); x.strokeStyle = "#d4ff3a"; x.lineWidth = 1.5; x.stroke();
      x.fillStyle = "#d4ff3a"; x.textAlign = "center"; x.font = `600 ${Math.max(7, u * 0.24)}px Mono, monospace`;
      x.fillText("MCU · FLASH", mcx, u >= 30 ? mcy - u * 0.05 : mcy + u * 0.08); x.fillStyle = "rgba(212,255,58,.6)"; x.font = `500 ${Math.max(6, u * 0.16)}px Mono, monospace`;
      if (u >= 30) x.fillText("keymap · lights · macros", mcx, mcy + u * 0.25);
      // caps
      x = layers.caps.x;
      KEYS.forEach((k) => {
        const kx = ox + k.x * u + gap / 2, ky = oy + k.y * u + gap / 2, kw = k.w * u - gap, kh = u - gap;
        rr(x, kx, ky, kw, kh, u * 0.12); x.fillStyle = "rgba(24,26,31,.94)"; x.fill();
        rr(x, kx + u * 0.07, ky + u * 0.04, kw - u * 0.14, kh - u * 0.17, u * 0.09);
        const fg = x.createLinearGradient(0, ky, 0, ky + kh); fg.addColorStop(0, "#2b2f36"); fg.addColorStop(1, "#1e2126");
        x.fillStyle = fg; x.fill(); x.strokeStyle = "rgba(255,255,255,.07)"; x.lineWidth = 1; x.stroke();
        const lab = u < 34 ? (SHORT[k.label] || k.label) : k.label;
        if (lab && u >= 22) { x.fillStyle = "#8b9098"; x.textAlign = "left"; x.font = `500 ${Math.max(7, u * 0.2)}px Plex, sans-serif`; x.fillText(lab, kx + u * 0.17, ky + u * 0.32); }
      });
      storyPart.dirty = true;
    }
    function drawLeds(t, p) {
      const x = layers.led.x, { u, ox, oy, w, h } = S;
      x.clearRect(0, 0, w, h);
      const lv = 0.18 + 0.82 * clamp((p - 0.42) / 0.12, 0, 1);
      KEYS.forEach((k) => {
        const kx = ox + k.cx * u, ky = oy + k.cy * u, c = hsv(k.cx * 0.05 + k.cy * 0.03 - t * 0.12 + p * 1.2, 0.85, 1), rad = u * (0.32 + 0.22 * lv) * Math.min(1.5, 0.8 + k.w * 0.2);
        const gr = x.createRadialGradient(kx, ky, 0, kx, ky, rad);
        gr.addColorStop(0, css(c, 0.95 * lv)); gr.addColorStop(0.3, css(c, 0.45 * lv)); gr.addColorStop(1, css(c, 0));
        x.fillStyle = gr; x.fillRect(kx - rad, ky - rad, rad * 2, rad * 2);
        x.fillStyle = css([0.6 + c[0] * 0.4, 0.6 + c[1] * 0.4, 0.6 + c[2] * 0.4], 0.4 + 0.6 * lv); x.fillRect(kx - u * 0.06, ky - u * 0.04, u * 0.12, u * 0.08);
      });
    }
    const ease = (v) => 1 - Math.pow(1 - v, 3);
    const storyPart = {
      dirty: true,
      wants() { return this.dirty || !reduced; },
      frame(t) {
        if (!S.w) return;
        let p;
        if (reduced) p = 0.62;
        else { const r = story.getBoundingClientRect(), span = r.height - window.innerHeight; p = span > 0 ? clamp(-r.top / span, 0, 1) : 0.62; }
        const a = ease(clamp(p / 0.24, 0, 1)), e = ease(clamp((p - 0.14) / 0.3, 0, 1));
        scene.style.transform = `translateY(${(a * 4).toFixed(2)}%) rotateX(${(a * 56).toFixed(2)}deg) rotateZ(${(-a * 24).toFixed(2)}deg) scale(${(1 - a * 0.1).toFixed(3)})`;
        const spread = S.w * 0.075 * e, order = ["case", "pcb", "led", "caps"];
        order.forEach((k, i) => (layers[k].c.style.transform = `translateZ(${(i * spread + (k === "led" ? 2 : 0)).toFixed(1)}px)`));
        const step = p < 0.46 ? 0 : p < 0.7 ? 1 : 2;
        if (step !== S.step) {
          S.step = step;
          steps.forEach((li, i) => li.classList.toggle("on", reduced || i === step));
          tags.forEach((s, i) => s.classList.toggle("on", i === step));
        }
        const focus = ["caps", "led", "pcb"][step], dimOthers = e > 0.85 && !reduced;
        order.forEach((k) => (layers[k].c.style.opacity = !dimOthers || k === focus || k === "case" ? 1 : 0.35));
        drawLeds(reduced ? 3 : t, p);
        this.dirty = false;
      },
    };
    addPart(storyPart, story);
    if ("ResizeObserver" in window) new ResizeObserver(() => { storyLayout(); kick(); }).observe(scene);
    storyLayout();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { storyLayout(); kick(); });
  }

  // ================================================================ INTRO choreography
  let readyDone = false;
  function ready() {
    if (readyDone) return; readyDone = true;
    root.classList.add("ready");
    $$(".hero .split").forEach((el) => el.classList.add("in"));
    if (!reduced) bootT = performance.now() / 1000 + 0.75;
    kb.dirty = true; kick();
  }
  if (reduced) ready();
  else {
    const go = () => requestAnimationFrame(() => requestAnimationFrame(ready));
    if (document.fonts && document.fonts.ready) Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 700))]).then(go); else go();
  }

  kick();

  // ------------------------------------------------------------ request a device
  // Posts to a small public endpoint (Supabase edge function); no account needed.
  const reqForm = $("#reqform");
  if (reqForm) {
    const REQ_URL = "https://elpwstkkzecdhzjdmtfp.supabase.co/functions/v1/periph-request";
    const msg = $("#rq-msg"), send = $("#rq-send");
    const say = (t, cls) => { msg.textContent = t; msg.className = "req-msg small" + (cls ? " " + cls : ""); };
    reqForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(reqForm);
      const device = String(fd.get("device") || "").trim();
      if (device.length < 2) { say("Tell us which device first.", "err"); $("#rq-device").focus(); return; }
      send.disabled = true; say("Sending…");
      try {
        const r = await fetch(REQ_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ device, wants: fd.get("wants") || "", os: fd.get("os") || "", website: fd.get("website") || "" }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || "Couldn't send that. Try again.");
        reqForm.reset();
        say(`Got it. ${device} is on the list for the next monthly update.`, "ok");
      } catch (err) {
        say(err.message || "Couldn't send that. Try again.", "err");
      } finally {
        send.disabled = false;
      }
    });
  }
})();
