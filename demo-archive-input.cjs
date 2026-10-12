'use strict';

// Analysis-only reconstruction from exact archived immutable source envelopes.
// No collector, new forecast, cache rewrite, ledger mutation or adoption path.
const Archive = require('./research-git-store.cjs');
const Demo = require('./demo-review.cjs');
const Core = require('./strategy-core.js');
const Feed = require('./market-feed.js');
const Version = require('./demo-version.cjs');
const SourceAudit = require('./demo-source-audit.cjs');
const SHA = /^[a-f0-9]{64}$/;
function fail(code) { const error = new Error(code); error.code = code; throw error; }
function sourceRequest(input) {
  if (!input || !['gold', 'btc'].includes(input.asset)) fail('ARCHIVE_SOURCE_ASSET_INVALID');
  if (!SHA.test(input.sourceHash || '') || !SHA.test(input.originalSha256 || '')) fail('ARCHIVE_SOURCE_EXACT_HASH_REQUIRED');
  const suffix = '-' + Core.VERSION;
  if (typeof input.snapshotId !== 'string' || !input.snapshotId.startsWith(input.asset + '-') ||
      !input.snapshotId.endsWith(suffix) || !/^\d{13}$/.test(input.snapshotId.slice(input.asset.length + 1, -suffix.length)))
    fail('ARCHIVE_SOURCE_ID_INVALID');
  return { alias: 'demo-lab', relative: `ledger-cache/${input.asset}/demo-v1/sources/${Demo.hash(input.snapshotId)}.json`,
    originalSha256: input.originalSha256 };
}
function decodeSourceInput(input, bytes) {
  sourceRequest(input);
  if (!Buffer.isBuffer(bytes) || Archive.sha256(bytes) !== input.originalSha256) fail('ARCHIVE_SOURCE_FILE_HASH_MISMATCH');
  let envelope; try { envelope = JSON.parse(bytes.toString('utf8')); } catch { fail('ARCHIVE_SOURCE_ENVELOPE_INVALID'); }
  const source = envelope?.original;
  if (!Number.isFinite(envelope?.firstRetrievedAt) || envelope.firstRetrievedAt < 0 ||
      !source || envelope.payloadHash !== Demo.hash(source) || envelope.payloadHash !== input.sourceHash)
    fail('ARCHIVE_SOURCE_PAYLOAD_HASH_MISMATCH');
  const market = input.asset === 'gold' ? 'futures' : 'spot';
  const last = source.bars?.m15?.at(-1), openedAt = Array.isArray(last) ? last[0] : last?.time;
  if (source.asset !== input.asset || source.id !== input.snapshotId || source.version !== Core.VERSION ||
      source.symbol !== Feed.instruments[input.asset].symbol || source.settings?.market !== market ||
      !Number.isSafeInteger(openedAt) || openedAt % 900000 !== 0 || source.id !== `${input.asset}-${openedAt}-${Core.VERSION}` ||
      source.settings?.now !== openedAt + 900000 + 1) fail('ARCHIVE_SOURCE_IDENTITY_MISMATCH');
  return { source, firstRetrievedAt: envelope.firstRetrievedAt };
}
async function analyzeArchivedSources(inputs, options = {}) {
  if (!Array.isArray(inputs) || !inputs.length || inputs.length > 16) fail('ARCHIVE_SOURCE_COUNT_INVALID');
  const requests = inputs.map(sourceRequest);
  const identity = Version.identity(), sourceAudit = SourceAudit.audit(__dirname, identity.hash);
  if (!sourceAudit.valid) fail('ARCHIVE_SOURCE_EXECUTION_IDENTITY_CHANGED');
  const read = await Archive.readExactBatch({ ...options, inputs: requests });
  const values = read.values.map((value, index) => {
    const decoded = decodeSourceInput(inputs[index], value.data);
    const analysis = Core.analyzeMarket(Feed.input(decoded.source), decoded.source.settings);
    return { asset: inputs[index].asset, snapshotId: decoded.source.id, source: decoded.source,
      firstRetrievedAt: decoded.firstRetrievedAt, analysis, originalSha256: value.originalSha256,
      sourceHash: inputs[index].sourceHash, manifestPath: value.manifestPath, manifestGitSha: value.manifestGitSha };
  });
  return { mode: 'ARCHIVE_ANALYSIS_RECONSTRUCTION', verifiedRef: read.verifiedRef,
    codeHash: identity.hash, sourceAudit, catalogManifests: read.catalogManifests, catalogBytes: read.catalogBytes,
    packFetches: read.packFetches, returnedBytes: read.returnedBytes, values,
    datasetCopiesWritten: read.datasetCopiesWritten, gitWrites: read.gitWrites,
    scope: 'Recomputed at each original snapshot cutoff. Not a new prospective forecast, fictional fill or proof of profit.' };
}
module.exports = { sourceRequest, decodeSourceInput, analyzeArchivedSources };
