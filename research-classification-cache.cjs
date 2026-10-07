/* Derived offline classifications only; never a forecast receipt or outcome cache. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const FILES = ['research-classification-cache.cjs', 'research-near-miss.cjs', 'strategy-core.js', 'flow-core.js', 'smc-core.js', 'market-feed.js', 'review-pack.js'];
const GROUPS = new Set(['unknown', 'full', 'reclaimMissingOnly', 'touchAndReclaimMissing', 'control']);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function fingerprint(root = __dirname) {
  return hash(JSON.stringify(FILES.map(name => [name, hash(fs.readFileSync(path.join(root, name)))])));
}
function open(directory, codeHash = fingerprint()) {
  if (!/^[a-f0-9]{64}$/.test(codeHash)) throw Error('Invalid classification code fingerprint');
  const file = path.join(directory, codeHash + '.json');
  let entries = Object.create(null), dirty = false;
  const stats = {hits: 0, misses: 0, invalid: 0, persisted: false};
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (saved.schema !== 1 || saved.codeHash !== codeHash || !saved.entries || typeof saved.entries !== 'object' || Array.isArray(saved.entries)) throw Error('Invalid cache');
    entries = Object.assign(Object.create(null), saved.entries);
  } catch (error) { if (error.code !== 'ENOENT') stats.invalid++; }
  return {
    stats,
    classify(raw, compute) {
      const key = hash(raw), entry = entries[key];
      if (entry && GROUPS.has(entry.group) && entry.digest === hash(codeHash + ':' + key + ':' + entry.group)) {
        stats.hits++; return entry.group;
      }
      if (entry) stats.invalid++;
      stats.misses++;
      const group = compute();
      if (!GROUPS.has(group)) throw Error('Invalid classification group');
      entries[key] = {group, digest: hash(codeHash + ':' + key + ':' + group)};
      dirty = true;
      return group;
    },
    flush() {
      if (!dirty) return;
      let temporary;
      try {
        fs.mkdirSync(directory, {recursive: true});
        temporary = file + '.' + crypto.randomUUID() + '.tmp';
        fs.writeFileSync(temporary, JSON.stringify({schema: 1, kind: 'derived-offline-classification', codeHash, entries}), {flag: 'wx'});
        fs.renameSync(temporary, file); stats.persisted = true; dirty = false;
      } catch (error) {
        // Cache failure must not discard a successfully recomputed research row.
        stats.writeError = error.code || 'CACHE_WRITE_FAILED';
        if (temporary) try { fs.unlinkSync(temporary); } catch {}
      }
    }
  };
}
module.exports = {open, fingerprint, FILES};
