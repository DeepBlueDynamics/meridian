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
  .mheader .mright{display:flex;align-items:center;gap:14px;flex-shrink:0}`;
  document.head.appendChild(style);

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
      <div style="display:flex;flex-direction:column;gap:2px;line-height:1;">
        <div class="mtitle">MERIDIAN</div>
        <div class="msubtitle"><span><span class="deep">DEEP</span><span class="blue">BLUE</span></span><span class="dyn">DYNAMICS</span></div>
      </div>
    `;
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
    if (liveEl) {
      right.appendChild(liveEl);
    } else {
      const stamp = document.createElement("span");
      stamp.className = "live";
      stamp.id = "liveStamp";
      stamp.textContent = "Fetching live";
      right.appendChild(stamp);
    }
    header.appendChild(right);
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
    encodeURIComponent("http://127.0.0.1:9123/auth-callback");
  function jwtClaims(t) {
    try { return JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); }
    catch (e) { return null; }
  }
  async function renderSvc() {
    const chip = document.getElementById("svcChip");
    if (!chip || !(window.meridian && window.meridian.auth)) return;
    const t = await window.meridian.auth.getToken();
    const c = t ? jwtClaims(t) : null;
    if (t) {
      chip.classList.add("in");
      chip.textContent = "⚡ " + ((c && c.tier) ? c.tier.toUpperCase() : "SVC");
      chip.title = "Meridian service — signed in" + (c && c.sub ? " as " + c.sub : "");
      chip.onclick = null;
    } else {
      chip.classList.remove("in");
      chip.textContent = "⚡ SVC";
      chip.title = "Meridian service — click to sign in";
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
