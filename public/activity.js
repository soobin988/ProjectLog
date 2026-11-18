(() => {
  const idleAfter = 60_000;
  const slotMs = 5000;
  const clockOrigin = Date.now() - performance.now();
  const pending = new Map();
  let lastActivity = performance.now();
  let checkpoint = document.hidden ? null : lastActivity;
  let collecting;
  let reporting;
  let sending = false;

  function collect() {
    if (checkpoint === null) return;
    const now = performance.now();
    const start = clockOrigin + checkpoint;
    const end = clockOrigin + Math.min(now, lastActivity + idleAfter);
    for (let slot = Math.floor(start / slotMs); slot <= Math.floor(end / slotMs); slot++) {
      const midpoint = (slot + 0.5) * slotMs;
      if (midpoint < start || midpoint >= end) continue;
      const minute = Math.floor(slot / 12);
      pending.set(minute, (pending.get(minute) || 0) | (1 << (slot % 12)));
    }
    checkpoint = now;
    const oldest = Math.floor(Date.now() / 60_000) - 10;
    for (const minute of pending.keys()) if (minute < oldest) pending.delete(minute);
  }

  async function report(leaving = false) {
    collect();
    if (!pending.size || (!leaving && sending)) return;
    const snapshot = [...pending];
    const body = new URLSearchParams({ slots: JSON.stringify(snapshot) });
    if (leaving && navigator.sendBeacon?.('/activity/ping', body)) return;
    sending = true;
    try {
      const response = await fetch('/activity/ping', { method: 'POST', body, keepalive: true });
      if (!response.ok) return;
      for (const [minute, slots] of snapshot) {
        const remaining = (pending.get(minute) || 0) & ~slots;
        if (remaining) pending.set(minute, remaining);
        else pending.delete(minute);
      }
    } catch {
      // The same slots can be retried safely because the server merges their bits.
    } finally { sending = false; }
  }

  function noteActivity() {
    if (document.hidden) return;
    const now = performance.now();
    if (checkpoint === null || now - lastActivity >= idleAfter) {
      collect();
      checkpoint = now;
    }
    lastActivity = now;
  }

  function start() {
    if (document.hidden) return;
    noteActivity();
    collecting ??= setInterval(collect, 5000);
    reporting ??= setInterval(() => report(), 60_000);
  }

  function stop() {
    report(true);
    checkpoint = null;
    clearInterval(collecting);
    clearInterval(reporting);
    collecting = reporting = undefined;
  }

  for (const event of ['pointerdown', 'keydown', 'scroll']) {
    document.addEventListener(event, noteActivity, { passive: true, capture: true });
  }
  document.addEventListener('visibilitychange', () => document.hidden ? stop() : start());
  window.addEventListener('pagehide', stop);
  window.addEventListener('pageshow', start);
  start();
})();
