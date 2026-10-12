'use strict';

// Offline ledger reconstruction. The plan selects exact saved envelopes; it is
// a later input roster, not a forecast, preregistration or trusted timestamp.
const fs = require('node:fs');
const path = require('node:path');
const Archive = require('./research-git-store.cjs');
const Demo = require('./demo-review.cjs');
const Input = require('./demo-archive-input.cjs');
const Version = require('./demo-version.cjs');
const SourceAudit = require('./demo-source-audit.cjs');
const Core = require('./strategy-core.js');
const SHA = /^[a-f0-9]{64}$/;
function fail(code) { const error = new Error(code); error.code = code; throw error; }
function partition(asset, sequence, auditAt) {
  if (!['gold', 'btc'].includes(asset) || !Number.isSafeInteger(sequence) || sequence < 1 || sequence > 1023)
    fail('ARCHIVE_LEDGER_PARTITION_INVALID');
  if (!Number.isSafeInteger(auditAt) || auditAt < 0 || auditAt > Date.now()) fail('ARCHIVE_LEDGER_AUDIT_TIME_INVALID');
}
function codeCheck(expected) {
  const identity = Version.identity(), sourceAudit = SourceAudit.audit(__dirname, identity.hash);
  if (identity.hash !== expected || !sourceAudit.valid) fail('ARCHIVE_LEDGER_EXECUTION_IDENTITY_CHANGED');
  return { identity, sourceAudit };
}
function envelope(bytes, descriptor, auditAt) {
  if (!Buffer.isBuffer(bytes) || Archive.sha256(bytes) !== descriptor.originalSha256)
    fail('ARCHIVE_LEDGER_FILE_HASH_MISMATCH');
  let saved; try { saved = JSON.parse(bytes.toString('utf8')); } catch { fail('ARCHIVE_LEDGER_ENVELOPE_INVALID'); }
  if (!saved?.original || saved.payloadHash !== descriptor.payloadHash || saved.payloadHash !== Demo.hash(saved.original) ||
      !Number.isFinite(saved.firstRetrievedAt) || saved.firstRetrievedAt < 0 || saved.firstRetrievedAt > auditAt)
    fail('ARCHIVE_LEDGER_ENVELOPE_INVALID');
  return saved;
}
function requests(plan) {
  partition(plan?.asset, plan?.sequence, plan?.auditAt);
  if (plan.schemaVersion !== 1 || plan.kind !== 'LATER_EXACT_LEDGER_INPUT_ROSTER' ||
      !SHA.test(plan.codeHash || '') || !SHA.test(plan.view?.payloadHash || '') ||
      !Array.isArray(plan.journal) || plan.journal.length !== plan.sequence ||
      !Array.isArray(plan.sources) || !plan.sources.length || plan.sources.length > plan.sequence)
    fail('ARCHIVE_LEDGER_PLAN_INVALID');
  const prefix = `ledger-cache/${plan.asset}/demo-v1`, result = [];
  const add = (relative, descriptor) => {
    if (!SHA.test(descriptor?.payloadHash || '') || !SHA.test(descriptor?.originalSha256 || ''))
      fail('ARCHIVE_LEDGER_EXACT_HASH_REQUIRED');
    result.push({ alias: 'demo-lab', relative, originalSha256: descriptor.originalSha256 });
  };
  add(`${prefix}/views/${String(plan.sequence).padStart(10, '0')}-${plan.view.payloadHash}.json`, plan.view);
  for (const [index, item] of plan.journal.entries()) {
    if (item?.sequence !== index + 1) fail('ARCHIVE_LEDGER_JOURNAL_ROSTER_GAP');
    add(`${prefix}/journal/${String(item.sequence).padStart(10, '0')}.json`, item);
  }
  const ids = new Set();
  for (const source of plan.sources) {
    if (source?.asset !== plan.asset || source.payloadHash !== source.sourceHash || ids.has(source.snapshotId))
      fail('ARCHIVE_LEDGER_SOURCE_ROSTER_INVALID');
    ids.add(source.snapshotId); result.push(Input.sourceRequest(source));
  }
  if (result.length > 1024) fail('ARCHIVE_LEDGER_INPUT_COUNT_EXCEEDED');
  return result;
}
function buildPlan({ asset, sequence, auditAt, viewHash, workspace = __dirname }) {
  partition(asset, sequence, auditAt);
  const identity = Version.identity(); codeCheck(identity.hash);
  const allRoots = Archive.roots(workspace), prefix = `ledger-cache/${asset}/demo-v1`;
  // Resolve every actual input through the existing symlink/path allowlist.
  const viewFolder = Archive.resolveSource('demo-lab', `${prefix}/views`, allRoots);
  const candidates = fs.readdirSync(viewFolder).filter(name => new RegExp(`^${String(sequence).padStart(10, '0')}-[a-f0-9]{64}\\.json$`).test(name))
    .filter(name => !viewHash || name.endsWith(`-${viewHash}.json`));
  if (candidates.length !== 1) fail('ARCHIVE_LEDGER_VIEW_VERSION_REQUIRED');
  const load = relative => {
    const file = Archive.resolveSource('demo-lab', relative, allRoots);
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > Archive.MAX_SOURCE_FILE) fail('ARCHIVE_LEDGER_LOCAL_INPUT_TOO_LARGE');
    const bytes = fs.readFileSync(file);
    let saved; try { saved = JSON.parse(bytes.toString('utf8')); } catch { fail('ARCHIVE_LEDGER_ENVELOPE_INVALID'); }
    const descriptor = { payloadHash: saved?.payloadHash, originalSha256: Archive.sha256(bytes) };
    envelope(bytes, descriptor, auditAt); return { descriptor, saved };
  };
  const selectedView = load(`${prefix}/views/${candidates[0]}`), journal = [], sources = new Map();
  if (selectedView.saved.original.codeHash !== identity.hash) fail('ARCHIVE_LEDGER_EXECUTION_IDENTITY_CHANGED');
  for (let seq = 1; seq <= sequence; seq++) {
    const item = load(`${prefix}/journal/${String(seq).padStart(10, '0')}.json`), record = item.saved.original;
    if (record.sequence !== seq) fail('ARCHIVE_LEDGER_JOURNAL_ROSTER_GAP');
    journal.push({ sequence: seq, ...item.descriptor });
    if (sources.has(record.snapshotId)) {
      if (sources.get(record.snapshotId).sourceHash !== record.sourceHash) fail('ARCHIVE_LEDGER_SOURCE_BINDING_MISMATCH');
      continue;
    }
    const source = load(`${prefix}/sources/${Demo.hash(record.snapshotId)}.json`);
    const descriptor = { asset, snapshotId: record.snapshotId, sourceHash: record.sourceHash, ...source.descriptor };
    Input.decodeSourceInput(descriptor, fs.readFileSync(Archive.resolveSource('demo-lab', Input.sourceRequest(descriptor).relative, allRoots)));
    sources.set(record.snapshotId, descriptor);
  }
  const plan = { schemaVersion: 1, kind: 'LATER_EXACT_LEDGER_INPUT_ROSTER', createdAt: Date.now(),
    asset, sequence, auditAt, codeHash: identity.hash, view: selectedView.descriptor, journal, sources: [...sources.values()] };
  requests(plan); return plan;
}
async function replay(plan, { expectedPlanHash, ...options } = {}) {
  if (!SHA.test(expectedPlanHash || '') || Demo.hash(plan) !== expectedPlanHash) fail('ARCHIVE_LEDGER_PLAN_HASH_MISMATCH');
  const inputs = requests(plan), before = codeCheck(plan.codeHash);
  const read = await Archive.readExactSet({ ...options, inputs });
  if (read.values?.length !== inputs.length) fail('ARCHIVE_LEDGER_INPUT_SET_INCOMPLETE');
  const descriptors = [plan.view, ...plan.journal, ...plan.sources];
  const envelopes = read.values.map((value, index) => {
    const request = inputs[index];
    if (value.alias !== request.alias || value.relative !== request.relative || value.originalSha256 !== request.originalSha256)
      fail('ARCHIVE_LEDGER_INPUT_ORDER_MISMATCH');
    return envelope(value.data, descriptors[index], plan.auditAt);
  });
  const view = envelopes[0].original, records = envelopes.slice(1, plan.sequence + 1).map(e => e.original);
  if (view.asset !== plan.asset || view.sequence !== plan.sequence || view.protocol?.version !== 'demo-v1' ||
      view.codeHash !== plan.codeHash || view.engineVersion !== Core.VERSION) fail('ARCHIVE_LEDGER_VIEW_IDENTITY_MISMATCH');
  const sources = new Map();
  for (const [index, descriptor] of plan.sources.entries()) {
    const value = read.values[plan.sequence + 1 + index];
    sources.set(descriptor.snapshotId, Input.decodeSourceInput(descriptor, value.data).source);
  }
  const referenced = new Set();
  for (const [index, record] of records.entries()) {
    if (record.sequence !== index + 1 || record.asset !== plan.asset ||
        !sources.has(record.snapshotId) || Demo.hash(sources.get(record.snapshotId)) !== record.sourceHash)
      fail('ARCHIVE_LEDGER_SOURCE_BINDING_MISMATCH');
    referenced.add(record.snapshotId);
  }
  if (referenced.size !== sources.size) fail('ARCHIVE_LEDGER_UNREFERENCED_SOURCE');
  const audit = Demo.audit(view, records, sources, { now: plan.auditAt });
  const after = codeCheck(plan.codeHash);
  if (after.sourceAudit.sourceHash !== before.sourceAudit.sourceHash) fail('ARCHIVE_LEDGER_EXECUTION_IDENTITY_CHANGED');
  if (!audit.valid) fail('ARCHIVE_LEDGER_AUDIT_FAILED');
  return { mode: 'ARCHIVE_LEDGER_RECONSTRUCTION', planHash: expectedPlanHash, verifiedRef: read.verifiedRef,
    inputCount: inputs.length, catalogManifests: read.catalogManifests, catalogBytes: read.catalogBytes,
    packFetches: read.packFetches, fetchedPackBytes: read.fetchedPackBytes, returnedBytes: read.returnedBytes,
    audit, sourceAudit: after.sourceAudit, datasetCopiesWritten: read.datasetCopiesWritten, gitWrites: read.gitWrites,
    scope: 'Later reconstruction of a fixed saved ledger cutoff. Not a new prediction, timestamp certificate, trading edge or authorization to delete active inputs.' };
}
module.exports = { requests, buildPlan, replay };
