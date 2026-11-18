const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const vm = require('node:vm');
const { activityBuckets } = require('../services/member-usage');
const { assetUrl, assetHeaders } = require('../services/static-assets');
const path = require('node:path');

const epoch = Date.UTC(2026, 10, 18, 12);

test('activity batches merge duplicates and reject future or unbounded activity', () => {
  const minute = epoch / 60_000;
  const buckets = activityBuckets([[minute - 1, 3], [minute - 1, 12], [minute, 1]], epoch + 3000);
  assert.equal(buckets.get(minute - 1), 15);
  assert.equal(buckets.get(minute), 1);
  for (const input of [[[minute, 2]], [[minute + 1, 1]], [[minute - 11, 1]], [[minute, 4096]], [[minute, -1]], Array(13).fill([minute - 1, 1])]) {
    assert.throws(() => activityBuckets(input, epoch + 3000), { status: 422 });
  }
});

test('activity reports once a minute, retains failed slots, and stops counting idle time', async () => {
  let elapsed = 0;
  let fail = true;
  const timers = new Map();
  const events = new Map();
  const requests = [];
  const context = {
    performance: { now: () => elapsed }, Date: { now: () => epoch + elapsed }, URLSearchParams,
    document: { hidden: false, addEventListener: (event, callback) => events.set(event, callback) },
    window: { addEventListener: (event, callback) => events.set(event, callback) }, navigator: {},
    setInterval: (callback, period) => { timers.set(period, callback); return period; },
    clearInterval: period => timers.delete(period),
    fetch: async (url, options) => { requests.push(JSON.parse(options.body.get('slots'))); return { ok: !fail }; }
  };
  vm.runInNewContext(await readFile(path.join(__dirname, '../public/activity.js'), 'utf8'), context);
  assert.deepEqual([...timers.keys()], [5000, 60_000]);
  for (elapsed = 5000; elapsed <= 60_000; elapsed += 5000) {
    if (elapsed % 10_000 === 0) events.get('pointerdown')();
    timers.get(5000)();
  }
  elapsed = 60_000;
  await timers.get(60_000)();
  assert.deepEqual(requests, [[[epoch / 60_000, 4095]]]);
  fail = false;
  elapsed = 61_000;
  await timers.get(60_000)();
  assert.deepEqual(requests[1], requests[0]);
  elapsed = 120_000;
  timers.get(5000)();
  await timers.get(60_000)();
  assert.deepEqual(requests[2], [[epoch / 60_000 + 1, 4095]]);
  elapsed = 180_000;
  timers.get(5000)();
  await timers.get(60_000)();
  assert.equal(requests.length, 3);
});

test('only the current content fingerprint gets immutable public caching', () => {
  const url = new URL(assetUrl('/ui.js'), 'http://localhost');
  const headers = {};
  const response = { req: { query: { v: url.searchParams.get('v') } }, setHeader: (key, value) => { headers[key] = value; } };
  assetHeaders(response, path.join(__dirname, '../public/ui.js'));
  assert.match(headers['Cache-Control'], /31536000, immutable/);
  response.req.query.v = 'outdated';
  assetHeaders(response, path.join(__dirname, '../public/ui.js'));
  assert.equal(headers['Cache-Control'], 'public, max-age=0, must-revalidate');
});
