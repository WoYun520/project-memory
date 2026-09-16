import test from 'node:test';
import assert from 'node:assert/strict';
import {createStationShutdown} from './shutdown.mjs';

function clock() {
  let now = 0, id = 0;
  const pending = new Map();
  return {
    setTimer(callback, delay) { const key = ++id; pending.set(key, {callback, at: now + delay}); return key; },
    clearTimer(key) { pending.delete(key); },
    advance(target) {
      while (true) {
        const next = [...pending.entries()].filter(([, value]) => value.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at; pending.delete(next[0]); next[1].callback();
      }
      now = target;
    },
    get now() { return now; },
  };
}

test('closed HTTP does not exit before the runner force-stop fallback', () => {
  const time = clock(), events = [];
  const shutdown = createStationShutdown({
    server: {close(done) { events.push('close'); done(); }, closeIdleConnections() { events.push('idle'); }},
    stopWork() { events.push('stop'); time.setTimer(() => events.push('force-stop'), 1500); },
    exit: code => events.push(['exit', code, time.now]),
    setTimer: time.setTimer, clearTimer: time.clearTimer,
  });
  shutdown(); shutdown();
  assert.deepEqual(events, ['stop', 'close', 'idle']);
  time.advance(1499);
  assert.ok(!events.some(Array.isArray));
  time.advance(1500);
  assert.equal(events.at(-1), 'force-stop');
  time.advance(2000);
  assert.deepEqual(events.at(-1), ['exit', 0, 2000]);
  time.advance(6000);
  assert.equal(events.filter(Array.isArray).length, 1);
});

test('an open HTTP connection is forced closed at the bounded deadline', () => {
  const time = clock(), events = [];
  let closeDone;
  const shutdown = createStationShutdown({
    server: {
      close(done) { closeDone = done; },
      closeAllConnections() { events.push('connections-closed'); closeDone(); },
    },
    stopWork() { time.setTimer(() => events.push('force-stop'), 1500); },
    exit: code => events.push(['exit', code, time.now]),
    setTimer: time.setTimer, clearTimer: time.clearTimer,
  });
  shutdown(); time.advance(2000);
  assert.deepEqual(events, ['force-stop']);
  time.advance(5000);
  assert.deepEqual(events, ['force-stop', 'connections-closed', ['exit', 0, 5000]]);
});

test('shutdown errors still allow the runner fallback before a nonzero exit', () => {
  const time = clock(), events = [];
  createStationShutdown({
    server: {close() { throw Error('synthetic close failure'); }},
    stopWork() { time.setTimer(() => events.push('force-stop'), 1500); throw Error('synthetic stop failure'); },
    exit: code => events.push(['exit', code, time.now]),
    setTimer: time.setTimer, clearTimer: time.clearTimer,
  })();
  time.advance(1500);
  assert.deepEqual(events, ['force-stop']);
  time.advance(2000);
  assert.deepEqual(events.at(-1), ['exit', 1, 2000]);
});
