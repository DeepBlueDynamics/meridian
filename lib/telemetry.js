// Renderer-side telemetry — ships errors to the main process's /telemetry sink
// (stub for a real server later; today it lands in telemetry.log at repo root).
// Classic script; include FIRST so it catches errors from every later script.
(function () {
  const ENDPOINT = "http://127.0.0.1:9123/telemetry";
  const PAGE = (location.pathname.split("/").pop() || "?");

  function send(type, payload) {
    try {
      // text/plain keeps the request preflight-free from the file:// origin.
      fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ type, page: PAGE, ...payload }),
      }).catch(() => { /* telemetry must never break the app */ });
    } catch (e) { /* ditto */ }
  }

  window.addEventListener("error", (e) => send("error", {
    message: e.message, source: e.filename, line: e.lineno, col: e.colno,
    stack: e.error && e.error.stack,
  }));
  window.addEventListener("unhandledrejection", (e) => send("unhandledrejection", {
    message: String((e.reason && e.reason.message) || e.reason),
    stack: e.reason && e.reason.stack,
  }));

  window.Telemetry = { send };
})();
