const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const Cache = require('../research-classification-cache.cjs'), Near = require('../research-near-miss.cjs');
function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ma-classification-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  return directory;
}
test('classification reuse requires identical source bytes and code; corrupt entries are recomputed', t => {
  const dir = temporary(t), code = 'a'.repeat(64); let computed = 0;
  const compute = () => { computed++; return 'control'; };
  let c = Cache.open(dir, code);
  assert.equal(c.classify(Buffer.from('source'), compute), 'control'); c.flush();
  c = Cache.open(dir, code); c.classify(Buffer.from('source'), compute);
  assert.equal(computed, 1); assert.equal(c.stats.hits, 1);
  c.classify(Buffer.from('source changed'), compute); assert.equal(computed, 2);
  Cache.open(dir, 'b'.repeat(64)).classify(Buffer.from('source'), compute); assert.equal(computed, 3);
  const file = path.join(dir, code + '.json'), saved = JSON.parse(fs.readFileSync(file));
  Object.values(saved.entries)[0].group = 'full'; fs.writeFileSync(file, JSON.stringify(saved));
  c = Cache.open(dir, code); c.classify(Buffer.from('source'), compute);
  assert.equal(computed, 4); assert.equal(c.stats.invalid, 1);
  fs.writeFileSync(file, 'broken'); c = Cache.open(dir, code); c.classify(Buffer.from('source'), compute);
  assert.equal(computed, 5); assert.equal(c.stats.invalid, 1);
});
test('every listed dependency participates in the code fingerprint', t => {
  const dir = temporary(t);
  for (const name of Cache.FILES) fs.writeFileSync(path.join(dir, name), name);
  const original = Cache.fingerprint(dir);
  for (const name of Cache.FILES) {
    fs.appendFileSync(path.join(dir, name), 'changed'); assert.notEqual(Cache.fingerprint(dir), original);
    fs.writeFileSync(path.join(dir, name), name);
  }
});
test('cache write failure preserves recomputed classification', t => {
  const dir = temporary(t), blocked = path.join(dir, 'file'); fs.writeFileSync(blocked, 'not a directory');
  const c = Cache.open(blocked, 'a'.repeat(64));
  assert.equal(c.classify('source', () => 'full'), 'full'); c.flush();
  assert.equal(c.stats.persisted, false); assert.ok(c.stats.writeError);
});
test('cached and recomputed rows match; outcomes, metadata and eligibility remain fresh', t => {
  const dir = temporary(t), snapshotDir = path.join(dir, 'snapshots'); fs.mkdirSync(snapshotDir);
  const cutoff = Date.UTC(2026, 9, 7, 12), STEP = 900000;
  const bars = m => {const end = Math.floor(cutoff / (m * 60000)) * m * 60000; return Array.from({length: 300}, (_, i) => [end - (300 - i) * m * 60000, 100 + i / 10, 102 + i / 10, 99 + i / 10, 101 + i / 10, 10]);};
  const snapshot = {asset: 'btc', version: require('../strategy-core').VERSION, symbol: 'BTCUSDT', createdAt: cutoff + 100, settings: {now: cutoff, market: 'spot'}, bars: {m15: bars(15), h1: bars(60), h4: bars(240)}};
  snapshot.id = `btc-${cutoff - STEP}-${snapshot.version}`;
  const file = path.join(snapshotDir, 'source.json'); fs.writeFileSync(file, JSON.stringify({snapshot, firstObservedAt: cutoff + 100}));
  let sample = {id: snapshot.id, bar: cutoff - STEP, heldDirection: 1, regime: 'initial', vetoes: []};
  const saveSample = () => fs.writeFileSync(path.join(dir, 'samples.jsonl'), JSON.stringify(sample) + '\n'); saveSample();
  const saveOutcome = outcomes => fs.writeFileSync(path.join(dir, 'outcomes.json'), JSON.stringify([{id: snapshot.id, outcomes}])); saveOutcome([]);
  const options = {directory: dir, cacheDirectory: path.join(dir, 'cache')}, spec = {startAfterBar: cutoff - 2 * STEP};
  const coldStats = {}, warmStats = {};
  const cold = Near.loadRows(spec, {...options, cacheStats: coldStats});
  assert.deepEqual(Near.loadRows(spec, {...options, useCache: false}), cold);
  assert.deepEqual(Near.loadRows(spec, {...options, cacheStats: warmStats}), cold);
  assert.equal(coldStats.misses, 1); assert.equal(warmStats.hits, 1);
  sample = {...sample, heldDirection: -1, regime: 'updated', vetoes: ['fresh']}; saveSample(); saveOutcome([{status: 'resolved', horizon: 4, returnBps: 11}]);
  const updated = Near.loadRows(spec, options);
  assert.deepEqual(updated, Near.loadRows(spec, {...options, useCache: false}));
  assert.equal(updated[0].direction, -1); assert.equal(updated[0].outcomes[0].returnBps, 11); assert.equal(updated[0].regime, 'updated');
  assert.deepEqual(Near.loadRows({startAfterBar: cutoff}, options), []);
  fs.writeFileSync(file, JSON.stringify({snapshot, firstObservedAt: cutoff - 100}));
  const changed = {}; Near.loadRows(spec, {...options, cacheStats: changed}); assert.equal(changed.misses, 1);
});
