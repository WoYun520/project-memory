// Keep the event loop alive beyond grok-runner's 1500 ms SIGKILL fallback.
const RUNNER_GRACE_MS = 2000;
const CONNECTION_DEADLINE_MS = 5000;

export function createStationShutdown({server, stopWork = () => {}, exit = code => process.exit(code), setTimer = setTimeout, clearTimer = clearTimeout}) {
  let started = false;
  return function shutdown() {
    if (started) return;
    started = true;
    let closed = false;
    let graceElapsed = false;
    let finished = false;
    let exitCode = 0;
    let graceTimer;
    let deadlineTimer;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimer(graceTimer);
      clearTimer(deadlineTimer);
      exit(exitCode);
    };
    // These timers deliberately stay referenced even when HTTP closes at once.
    graceTimer = setTimer(() => { graceElapsed = true; if (closed) finish(); }, RUNNER_GRACE_MS);
    deadlineTimer = setTimer(() => {
      try { server.closeAllConnections?.(); } catch { exitCode = 1; }
      finish();
    }, CONNECTION_DEADLINE_MS);
    try { stopWork(); } catch { exitCode = 1; }
    try {
      server.close(() => { closed = true; if (graceElapsed) finish(); });
      server.closeIdleConnections?.();
    } catch {
      exitCode = 1;
      closed = true;
    }
  };
}
