const test = require('node:test');
const assert = require('node:assert/strict');
const {classify, selectNonoverlap, median} = require('../research-near-miss.cjs');

const labels = ['トレンド継続', '押し・戻り', 'EMA13再突破', 'リボン維持', '出来高', '確定H1一致', 'ADX'];
const checks = missing => labels.map(label => ({label, status: missing.includes(label) ? '未成立' : '成立'}));

test('classifies the frozen near-miss groups without score inference', () => {
  assert.equal(classify(checks([])), 'full');
  assert.equal(classify(checks(['EMA13再突破'])), 'reclaimMissingOnly');
  assert.equal(classify(checks(['押し・戻り', 'EMA13再突破'])), 'touchAndReclaimMissing');
  assert.equal(classify(checks(['出来高'])), 'control');
  assert.equal(classify([...checks([]).slice(0, 6), {label:'ADX', status:'不明'}]), 'unknown');
});

test('reserves pending windows when selecting chronological non-overlap', () => {
  const step = 900000;
  assert.deepEqual(selectNonoverlap([{bar:0,id:'a'},{bar:step,id:'b'},{bar:4*step,id:'c'}],4).map(x=>x.id), ['a','c']);
});

test('median handles odd, even, and empty samples', () => {
  assert.equal(median([3,1,2]), 2); assert.equal(median([4,1,2,3]), 2.5); assert.equal(median([]), null);
});
