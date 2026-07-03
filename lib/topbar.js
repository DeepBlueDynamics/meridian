// Standardized Meridian top bar — one nav definition + cross-view radio
// notifications. Classic script. Pages mount it with:
//   <nav data-meridian-nav></nav>  +  <script src="lib/topbar.js"></script>
// The radio badge counts transcriptions arriving while you're on any OTHER
// view (the preload radio bridge exists on every page); opening the Radio
// view clears it. Count persists across page hops via localStorage.
(function () {
  const VIEWS = [
    { href: "setup.html",   icon: "⚙",  label: "Setup" },
    { href: "routing.html", icon: "🌊", label: "Routing" },
    { href: "layers.html",  icon: "🌬", label: "Layers" },
    { href: "index.html",   icon: "🌐", label: "Harbor" },
    { href: "radio.html",   icon: "📻", label: "Radio", badge: true },
  ];
  const here = location.pathname.split("/").pop() || "index.html";

  const style = document.createElement("style");
  style.textContent = `
  .mnav{display:flex;gap:6px;align-items:center;font-family:'Fira Code',ui-monospace,monospace}
  .mnav a{position:relative;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#9ba8bd;
    text-decoration:none;border:1px solid #324863;padding:5px 11px;border-radius:4px;background:rgba(10,15,24,.5);
    white-space:nowrap}
  .mnav a:hover{color:#e8ecf3;border-color:#9ba8bd}
  .mnav a.active{color:#f9a826;border-color:#f9a826;background:rgba(249,168,38,.08)}
  .mnav .nbadge{position:absolute;top:-7px;right:-7px;min-width:16px;height:16px;border-radius:9px;
    background:#e94560;color:#fff;font-size:9px;line-height:16px;text-align:center;padding:0 3px;display:none}
  .mnav .nbadge.on{display:block;box-shadow:0 0 8px rgba(233,69,96,.7)}
  .mnav .svc{cursor:pointer;border-style:dashed;color:#54627c}
  .mnav .svc.in{border-style:solid;color:#4ecdc4;border-color:rgba(78,205,196,.5)}
  .mnav .svc.in:hover{color:#e8ecf3}
  
  .mheader{padding:12px 22px;background:linear-gradient(180deg,#060a13,rgba(10,15,24,0.9));border-bottom:1px solid #1f2a3d;
    display:flex;align-items:center;justify-content:space-between;gap:20px;height:56px;box-sizing:border-box}
  .mheader .mbrand{display:flex;align-items:center;gap:16px;flex-shrink:0}
  .mheader .mbrand .mtitle{font-family:'Instrument Serif',serif;font-size:26px;color:#e8ecf3;letter-spacing:0.08em;line-height:1}
  .mheader .mbrand .msubtitle{font-family:'Fira Code',ui-monospace,monospace;font-size:9px;letter-spacing:0.3em;display:flex;gap:6px;margin-top:2px}
  .mheader .mbrand .msubtitle .deep{color:#fff}
  .mheader .mbrand .msubtitle .blue{color:#4fa3ff}
  .mheader .mbrand .msubtitle .dyn{color:#9ba8bd}
  .mheader .mviewname{font-family:'Fira Code',ui-monospace,monospace;font-size:10px;letter-spacing:0.22em;color:#54627c;text-transform:uppercase;
    border-left:1px solid #324863;padding-left:16px;margin-left:4px}
  .mheader .mright{display:flex;align-items:center;gap:14px;flex-shrink:0}
  .mclock{position:relative;font-family:'Fira Code',ui-monospace,monospace;cursor:pointer;
    border-left:1px solid #324863;padding-left:16px;margin-left:4px;user-select:none}
  .mclock .t{font-size:17px;color:#e8ecf3;letter-spacing:0.08em;line-height:1}
  .mclock .z{font-size:9px;color:#54627c;letter-spacing:0.22em;margin-top:3px}
  .mclock:hover .z{color:#9ba8bd}
  .mclock-pop{display:none;position:absolute;top:calc(100% + 12px);left:0;z-index:70;width:270px;
    background:#0a0f18;border:1px solid #324863;border-radius:6px;padding:8px;box-shadow:0 12px 30px rgba(0,0,0,.5);cursor:default}
  .mclock-pop.open{display:block}
  .mclock-pop input{width:100%;box-sizing:border-box;padding:7px 9px;background:#060a13;border:1px solid #324863;
    border-radius:4px;color:#e8ecf3;font-family:inherit;font-size:11px;outline:none}
  .mclock-pop input:focus{border-color:#4ecdc4}
  .mclock-pop .list{max-height:260px;overflow-y:auto;margin-top:6px;display:flex;flex-direction:column}
  .mclock-pop .list button{text-align:left;padding:6px 9px;background:transparent;border:none;color:#9ba8bd;
    font-family:inherit;font-size:11px;cursor:pointer;border-bottom:1px solid #1f2a3d}
  .mclock-pop .list button:hover{color:#e8ecf3;background:rgba(155,168,189,.08)}
  .mclock-pop .list button.sel{color:#4ecdc4}`;
  document.head.appendChild(style);

  // ── zone clock (top-left, after the logo): Zulu by default, any IANA zone
  // via a searchable dropdown; choice persists across views/sessions ──
  const TZ_KEY = "meridian.clock.tz";
  const clockTz = () => { try { return localStorage.getItem(TZ_KEY) || "UTC"; } catch (e) { return "UTC"; } };
  function zoneLabel(tz) {
    return tz === "UTC" ? "ZULU" : tz.split("/").pop().replace(/_/g, " ").toUpperCase();
  }
  function makeClock() {
    const wrap = document.createElement("div");
    wrap.className = "mclock";
    wrap.title = "Click to change timezone";
    wrap.innerHTML = `<div class="t" id="mclockTime">--:--:--</div><div class="z" id="mclockZone">ZULU ▾</div>` +
      `<div class="mclock-pop" id="mclockPop"><input id="mclockSearch" placeholder="Search timezones…" autocomplete="off" />` +
      `<div class="list" id="mclockList"></div></div>`;
    return wrap;
  }
  function renderClockTime() {
    const tEl = document.getElementById("mclockTime");
    if (!tEl) return;
    const tz = clockTz();
    try {
      const s = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date());
      tEl.textContent = tz === "UTC" ? s + "Z" : s;
    } catch (e) { tEl.textContent = new Date().toISOString().slice(11, 19) + "Z"; }
    const zEl = document.getElementById("mclockZone");
    if (zEl) zEl.textContent = zoneLabel(clockTz()) + " ▾";
  }
  function initClock() {
    const wrap = document.querySelector(".mclock"), pop = document.getElementById("mclockPop");
    const search = document.getElementById("mclockSearch"), list = document.getElementById("mclockList");
    if (!wrap || !pop) return;
    const zones = ["UTC"].concat((Intl.supportedValuesOf ? Intl.supportedValuesOf("timeZone") : []).filter(z => z !== "UTC"));
    let built = false;
    function buildList() {
      if (built) return; built = true;
      const cur = clockTz(), frag = document.createDocumentFragment();
      for (const z of zones) {
        const b = document.createElement("button");
        b.textContent = z === "UTC" ? "UTC · Zulu" : z.replace(/_/g, " ");
        b.dataset.tz = z;
        if (z === cur) b.classList.add("sel");
        b.addEventListener("click", (ev) => {
          ev.stopPropagation();
          try { localStorage.setItem(TZ_KEY, z); } catch (e) { /* noop */ }
          list.querySelectorAll("button.sel").forEach(x => x.classList.remove("sel"));
          b.classList.add("sel");
          pop.classList.remove("open");
          renderClockTime();
        });
        frag.appendChild(b);
      }
      list.appendChild(frag);
    }
    wrap.addEventListener("click", (ev) => {
      if (pop.contains(ev.target)) return;
      buildList();
      pop.classList.toggle("open");
      if (pop.classList.contains("open")) { search.value = ""; filter(""); search.focus(); }
    });
    function filter(q) {
      q = q.trim().toLowerCase();
      for (const b of list.children) b.style.display = !q || b.dataset.tz.toLowerCase().replace(/_/g, " ").includes(q) ? "" : "none";
    }
    search.addEventListener("input", () => filter(search.value));
    search.addEventListener("keydown", (ev) => { if (ev.key === "Escape") pop.classList.remove("open"); });
    document.addEventListener("click", (ev) => { if (!wrap.contains(ev.target)) pop.classList.remove("open"); });
    renderClockTime();
    setInterval(renderClockTime, 1000);
  }

  // ── standardized header compiler ──
  const header = document.querySelector("[data-meridian-header]");
  if (header) {
    const title = header.getAttribute("data-meridian-header") || "";
    const customElements = Array.from(header.children);
    header.innerHTML = "";
    header.classList.add("mheader");

    const brand = document.createElement("div");
    brand.className = "mbrand";
    brand.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:3px;line-height:1;">
        <div class="msubtitle"><span><span class="deep">DEEP</span><span class="blue">BLUE</span></span><span class="dyn">DYNAMICS</span></div>
        <div class="mtitle">MERIDIAN</div>
      </div>
    `;
    brand.appendChild(makeClock());
    if (title && title !== "Harbor") {
      const vn = document.createElement("div");
      vn.className = "mviewname";
      vn.textContent = title;
      brand.appendChild(vn);
    }
    header.appendChild(brand);

    // Re-insert custom elements (e.g. .route layout from routing.html)
    for (const el of customElements) {
      if (!el.hasAttribute("data-meridian-nav") && !el.classList.contains("stamp") && !el.classList.contains("live") && !el.classList.contains("spacer")) {
        header.appendChild(el);
      }
    }

    const right = document.createElement("div");
    right.className = "mright";
    
    const nav = document.createElement("nav");
    nav.setAttribute("data-meridian-nav", "");
    right.appendChild(nav);

    // Look for live stamps/connection status indicators
    let liveEl = customElements.find(el => el.classList.contains("live") || el.id === "liveStamp" || el.id === "connText" || el.id === "connDot");
    if (!liveEl) {
      for (const el of customElements) {
        const found = el.querySelector(".live, #liveStamp, #connText, #connDot");
        if (found) { liveEl = el; break; }
      }
    }
    // The live/fetch stamp stays in the DOM (page JS on every view writes to
    // #liveStamp) but is no longer shown — the clock owns the time corner and
    // fetch state lives in each view's own loader/panels.
    if (liveEl) {
      liveEl.style.display = "none";
      right.appendChild(liveEl);
    } else {
      const stamp = document.createElement("span");
      stamp.className = "live";
      stamp.id = "liveStamp";
      stamp.style.display = "none";
      right.appendChild(stamp);
    }
    header.appendChild(right);
    initClock();
  }

  const mount = document.querySelector("[data-meridian-nav]");
  if (mount) {
    mount.classList.add("mnav");
    mount.innerHTML = VIEWS.map(v =>
      `<a href="${v.href}" class="${v.href === here ? "active" : ""}">${v.icon} ${v.label}` +
      (v.badge ? '<span class="nbadge" id="radioNavBadge"></span>' : "") + "</a>").join("") +
      `<a class="svc" id="svcChip" title="Meridian service — sign in">⚡ SVC</a>`;
  }

  // ── service sign-in chip (spec-service-usage §3/§10) ──
  // Signed out: dashed/dim, click opens the nuts-auth loopback login in the
  // system browser. Signed in: solid teal with the token's tier; click = none
  // (sign-out lives in future settings; decode is display-only).
  const LOGIN_URL = "https://auth.nuts.services/login?return_url=" +
    encodeURIComponent("http://127.0.0.1:9123/auth-callback?scope=transcribe.audio%20route.compute%20research.report%20search.query&scopes=transcribe.audio,route.compute,research.report,search.query");
  function jwtClaims(t) {
    try { return JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); }
    catch (e) { return null; }
  }
  async function renderSvc() {
    const chip = document.getElementById("svcChip");
    if (!chip || !(window.meridian && window.meridian.auth)) return;
    const t = await window.meridian.auth.getToken();
    const c = t ? jwtClaims(t) : null;
    const expired = c && c.exp && (c.exp < Date.now() / 1000);
    if (t && !expired) {
      chip.classList.add("in");
      chip.textContent = "⚡ " + ((c && c.tier) ? c.tier.toUpperCase() : "SVC");
      chip.title = "Meridian service — signed in" + (c && c.sub ? " as " + c.sub : "");
      chip.onclick = null;
    } else {
      chip.classList.remove("in");
      chip.textContent = "⚡ SVC";
      chip.title = expired ? "Meridian service — session expired, click to sign in" : "Meridian service — click to sign in";
      chip.onclick = () => { if (window.meridian.openExternal) window.meridian.openExternal(LOGIN_URL); };
    }
  }
  renderSvc();
  if (window.meridian && window.meridian.auth) window.meridian.auth.onChange(renderSvc);

  // ── radio unread badge ──
  const KEY = "meridian.radio.unread";
  const get = () => { try { return +localStorage.getItem(KEY) || 0; } catch (e) { return 0; } };
  const set = (n) => { try { localStorage.setItem(KEY, String(Math.max(0, n))); } catch (e) {} render(); };
  function render() {
    const b = document.getElementById("radioNavBadge");
    if (!b) return;
    const n = get();
    b.textContent = n > 9 ? "9+" : n;
    b.classList.toggle("on", n > 0);
  }
  render();

  if (here === "radio.html") {
    set(0); // opening the radio view marks everything read
  } else if (window.meridian && window.meridian.radio) {
    window.meridian.radio.onEvent((e) => {
      if (e.type === "transcription") set(get() + 1);
    });
  }
  window.MeridianNav = { refreshBadge: render, clearRadioBadge: () => set(0) };
})();
