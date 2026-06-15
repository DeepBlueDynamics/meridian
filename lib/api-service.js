// Meridian service client (spec-service-usage) — login state, Agent Card
// discovery, and /a2a skill calls with the spec's exact error semantics.
// Classic script; exposes window.ApiService.
//
// NOTE (spec-refactor-guidance §4.2): this file is the seed of the
// consolidated API layer — the geocoding fallback (routing.html) and the
// forecast fetch pipelines (lib/field.js) migrate INTO it during the
// refactor pass. Service-contract surface lands first.
(function () {
  const BASE = "https://meridian-service-ugcdy6vw7a-uc.a.run.app"; // canonical: meridian.deepbluedynamics.com (DNS pending)
  const LOGIN_URL = "https://auth.nuts.services/login?return_url=" +
    encodeURIComponent("http://127.0.0.1:9123/auth-callback");

  let _token = null, _card = null, _cardAt = 0;

  async function refreshToken() {
    _token = (window.meridian && window.meridian.auth) ? await window.meridian.auth.getToken() : null;
    return _token;
  }
  if (window.meridian && window.meridian.auth) {
    window.meridian.auth.onChange(() => { _token = null; refreshToken(); });
  }

  // Decode the JWT payload for display (sub / scopes / tier) — display only,
  // the gateway is the enforcer.
  function claims(token) {
    const t = token || _token;
    if (!t) return null;
    try {
      const b64 = t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      return JSON.parse(atob(b64));
    } catch (e) { return null; }
  }

  async function signedIn() { return !!(await refreshToken()); }
  function signIn() {
    if (window.meridian && window.meridian.openExternal) window.meridian.openExternal(LOGIN_URL);
  }
  async function signOut() {
    if (window.meridian && window.meridian.auth) await window.meridian.auth.logout();
    _token = null;
  }

  // Agent Card: fetch once per session (public endpoint), cache 10 min.
  async function agentCard({ force = false } = {}) {
    if (_card && !force && Date.now() - _cardAt < 600000) return _card;
    const r = await fetch(BASE + "/.well-known/agent.json");
    if (!r.ok) throw new Error("agent card HTTP " + r.status);
    _card = await r.json(); _cardAt = Date.now();
    return _card;
  }

  // POST /a2a (JSON-RPC 2.0). Error semantics per spec §5:
  //   -32005 declared-but-pending  → { fallback:true }  (caller uses offline path)
  //   -32006 not scoped/tier       → { fallback:true, denied:true }
  //   -32004 unknown skill         → throw (caller bug)
  let _rpcId = 1;
  async function call(skill, data) {
    if (!_token) await refreshToken();
    const headers = { "content-type": "application/json" };
    if (_token) headers.authorization = "Bearer " + _token;
    let r;
    try {
      r = await fetch(BASE + "/a2a", {
        method: "POST", headers,
        body: JSON.stringify({
          jsonrpc: "2.0", id: _rpcId++, method: "message/send",
          params: { message: { metadata: { skill }, parts: [{ kind: "data", data }] } },
        }),
      });
    } catch (e) {
      return { fallback: true, offline: true, reason: String(e.message || e) };
    }
    if (r.status === 401) return { fallback: true, denied: true, reason: "sign in required" };
    const j = await r.json().catch(() => ({}));
    if (j.error) {
      const c = j.error.code;
      if (c === -32005) return { fallback: true, reason: "executor pending" };
      if (c === -32006) return { fallback: true, denied: true, reason: "not in token scope/tier" };
      throw new Error(`a2a ${c}: ${j.error.message || skill}`);
    }
    return j.result;
  }

  window.ApiService = { BASE, LOGIN_URL, signIn, signOut, signedIn, claims, agentCard, call, refreshToken };
})();
