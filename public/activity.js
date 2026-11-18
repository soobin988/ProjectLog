(() => {
  const idleAfter = 60_000;
  const reportEvery = 15_000;
  let lastActivity = performance.now();
  let checkpoint = document.hidden ? null : lastActivity;
  let timer;

  function report() {
    if (checkpoint === null) return;
    const now = performance.now();
    const elapsed = Math.floor(Math.min(now, lastActivity + idleAfter) - checkpoint);
    checkpoint = now;
    if (elapsed < 1000) return;
    const body = new URLSearchParams({ elapsed: Math.min(elapsed, 20_000) });
    if (navigator.sendBeacon?.('/activity/ping', body)) return;
    fetch('/activity/ping', { method: 'POST', body, keepalive: true }).catch(() => {});
  }

  function noteActivity() {
    if (document.hidden) return;
    const now = performance.now();
    if (checkpoint === null || now - lastActivity >= idleAfter) {
      report();
      checkpoint = now;
    }
    lastActivity = now;
  }

  function start() {
    if (document.hidden) return;
    noteActivity();
    timer ??= setInterval(report, reportEvery);
  }

  function stop() {
    report();
    checkpoint = null;
    clearInterval(timer);
    timer = undefined;
  }

  for (const event of ['pointerdown', 'keydown', 'scroll']) {
    document.addEventListener(event, noteActivity, { passive: true, capture: true });
  }
  document.addEventListener('visibilitychange', () => document.hidden ? stop() : start());
  window.addEventListener('pagehide', stop);
  window.addEventListener('pageshow', start);
  start();
})();
