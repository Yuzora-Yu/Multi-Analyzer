/* Prospective, analysis-only near-miss cohort. Never changes alerts or trading rules. */
const fs = require('node:fs');
const path = require('node:path');
const Core = require('./strategy-core');
const Feed = require('./market-feed');
const Review = require('./review-pack');

const STEP = 15 * 60 * 1000;
const DIR = path.join(__dirname, '.runtime', 'hourly-observation', 'cohort-v1');

function classify(checks) {
  const values = Object.fromEntries(checks.map(check => [check.label, check.status]));
  const labels = ['トレンド継続', '押し・戻り', 'EMA13再突破', 'リボン維持', '出来高', '確定H1一致', 'ADX'];
  if (labels.some(label => !['成立', '未成立'].includes(values[label]))) return 'unknown';
  const pass = label => values[label] === '成立';
  if (labels.every(pass)) return 'full';
  if (!pass('EMA13再突破') && labels.filter(label => label !== 'EMA13再突破').every(pass)) return 'reclaimMissingOnly';
  if (!pass('押し・戻り') && !pass('EMA13再突破') && labels.filter(label => !['押し・戻り', 'EMA13再突破'].includes(label)).every(pass)) return 'touchAndReclaimMissing';
  return 'control';
}

function selectNonoverlap(rows, horizon) {
  let reservedUntil = -Infinity;
  return rows.slice().sort((a, b) => a.bar - b.bar).filter(row => {
    if (row.bar < reservedUntil) return false;
    reservedUntil = row.bar + horizon * STEP;
    return true;
  });
}

function median(values) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function loadRows(spec) {
  const outcomes = new Map(JSON.parse(fs.readFileSync(path.join(DIR, 'outcomes.json'), 'utf8')).map(row => [row.id, row]));
  const samples = new Map(fs.readFileSync(path.join(DIR, 'samples.jsonl'), 'utf8').trim().split(/\r?\n/).filter(Boolean).map(line => {
    const row = JSON.parse(line); return [row.id, row];
  }));
  const snapshotDir = path.join(DIR, 'snapshots');
  return fs.readdirSync(snapshotDir).filter(name => name.endsWith('.json')).map(name => JSON.parse(fs.readFileSync(path.join(snapshotDir, name), 'utf8')))
    .map(({snapshot, firstObservedAt}) => {
      const sample = samples.get(snapshot.id);
      if (!sample || sample.bar <= spec.startAfterBar || !sample.heldDirection) return null;
      const signal = Core.analyzeMarket(Feed.input(snapshot), snapshot.settings);
      const decision = Review.decision({snapshot, signal}, firstObservedAt);
      return {id: snapshot.id, asset: snapshot.asset, bar: sample.bar, firstObservedAt, observedBeforeEntry: firstObservedAt <= sample.bar + STEP,
        direction: sample.heldDirection, regime: sample.regime, group: classify(decision.checks), vetoes: sample.vetoes, outcomes: outcomes.get(snapshot.id)?.outcomes || []};
    }).filter(Boolean);
}

function summarize(rows, spec) {
  const report = {};
  for (const asset of ['gold', 'btc']) {
    report[asset] = {};
    for (const group of Object.keys(spec.groups)) {
      report[asset][group] = {};
      const candidates = rows.filter(row => row.asset === asset && row.group === group);
      for (const horizon of [spec.primaryHorizonBars, ...spec.secondary]) {
        const selected = selectNonoverlap(candidates, horizon);
        const resolved = selected.map(row => ({row, outcome: row.outcomes.find(outcome => outcome.horizon === horizon)})).filter(x => x.outcome?.status === 'resolved');
        report[asset][group][horizon] = {candidates: candidates.length, selected: selected.length, resolved: resolved.length,
          observedBeforeEntry: resolved.filter(x => x.row.observedBeforeEntry).length,
          period: resolved.length ? {from: Math.min(...resolved.map(x => x.row.bar)), to: Math.max(...resolved.map(x => x.row.bar))} : null,
          regimes: Object.fromEntries([...new Set(resolved.map(x => x.row.regime))].map(regime => [regime, resolved.filter(x => x.row.regime === regime).length])),
          costs: Object.fromEntries(spec.costBps.map(cost => {
            const net = resolved.map(x => (x.row.direction > 0 ? x.outcome.returnBps : -x.outcome.returnBps) - cost);
            const adverse = resolved.map(x => x.row.direction > 0 ? -x.outcome.longMaeBps : x.outcome.longMfeBps);
            return [cost, {meanBps: net.length ? net.reduce((a, b) => a + b, 0) / net.length : null, medianBps: median(net), wins: net.filter(x => x > 0).length,
              maxAdverseBps: adverse.length ? Math.max(...adverse) : null}];
          }))};
      }
    }
  }
  return report;
}

function run({quiet = false} = {}) {
  const spec = JSON.parse(fs.readFileSync(path.join(DIR, 'near-miss-spec-v1.json'), 'utf8'));
  const rows = loadRows(spec);
  const result = {generatedAt: new Date().toISOString(), specCreatedAt: spec.createdAt, startAfterBar: spec.startAfterBar,
    note: '前向き分類の分析専用集計。未観測の仮想エントリ、少数例、重複除外後の件数を分け、本番条件は変更しない。', rows: rows.length, report: summarize(rows, spec)};
  fs.writeFileSync(path.join(DIR, 'near-miss-report-v1.json'), JSON.stringify(result, null, 2));
  if (!quiet) console.log(JSON.stringify({generatedAt: result.generatedAt, rows: result.rows, report: result.report}, null, 2));
  return result;
}

if (require.main === module) run();
module.exports = {classify, selectNonoverlap, median, summarize, run};
