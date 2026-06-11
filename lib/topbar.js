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
  .mnav .nbadge.on{display:block;box-shadow:0 0 8px rgba(233,69,96,.7)}`;
  document.head.appendChild(style);

  const mount = document.querySelector("[data-meridian-nav]");
  if (mount) {
    mount.classList.add("mnav");
    mount.innerHTML = VIEWS.map(v =>
      `<a href="${v.href}" class="${v.href === here ? "active" : ""}">${v.icon} ${v.label}` +
      (v.badge ? '<span class="nbadge" id="radioNavBadge"></span>' : "") + "</a>").join("");
  }

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
