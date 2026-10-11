'use strict';
// Private, append-only research archive. No market collection, mail or orders.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');

const SCHEMA = 1, POLICY = 'metadata-privacy-v1';
const FRAGMENT_SCHEMA = 2, FRAGMENT_FORMAT = 'ordered-fragments-v1';
const REPOSITORY = 'Yuzora-Yu/Multi-Analyzer-data';
const MAX_BLOB = 20 * 1024 * 1024;
const MAX_PLAIN_PACK = 32 * 1024 * 1024;
const MAX_RAW_PACK = 128 * 1024 * 1024;
// Already compressed input may have almost no further compression. Keep ample
// headroom for base64/JSON/gzip overhead instead of relying on its compression ratio.
const PACK_PAYLOAD_BUDGET = 18 * 1024 * 1024;
const MAX_FILE = 20 * 1024 * 1024;
const MAX_SOURCE_FILE = 64 * 1024 * 1024;
const FRAGMENT_BYTES = 8 * 1024 * 1024;
const MAX_INFLATED = MAX_SOURCE_FILE;
const MAX_JSON_NODES = 2000000, MAX_JSON_DEPTH = 128;
const MAX_REPLY = 32 * 1024 * 1024;
const ROOT_PATHS = Object.freeze({
  'hourly-observation': '.runtime/hourly-observation',
  'demo-lab': '.runtime/demo-lab',
  'persona-trend': '../../Codex/2026-10-09/multi-analyzer-trend/outputs',
  'persona-reversion': '../../Codex/2026-10-09/multi-analyzer-reversion/outputs',
  'persona-confirmation': '../../Codex/2026-10-09/multi-analyzer-confirmation/outputs'
});
// Old generated evaluation reports only. Original snapshots/cache never qualify.
const PRUNE_PREFIXES = Object.freeze(['research-forward/']);
const TEXT_TYPES = new Set(['.json', '.jsonl', '.ndjson', '.md', '.txt', '.csv', '.tsv']);
const OMIT_COMPONENT = /^(?:node_modules|\.git|\.wrangler|smtp-receipts|worker-dryrun|diagnostic-worker-build|ui|screenshots|downloads|temp|tmp)$/i;
const OMIT_FILE = /(?:^\.env(?:\.|$)|(?:email|mail|smtp)(?:[-_.]|$)|(?:^|[-_.])(?:config|credentials|credential|secret|token|payload-response)(?:[-_.]|$)|(?:\.tmp(?:\.|$)|\.log$|\.lock$)|^LOCK$)/i;
const EMAIL = /\b[A-Z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Z0-9-]{1,63}(?:\.[A-Z0-9-]{1,63}){1,20}\b/ig;
const WINDOWS_PATH = /(?:(?<![A-Za-z0-9])[A-Za-z]:[\\/][^\r\n"<>|]*|\\\\[^\s"<>]+[\\/][^\r\n"<>|]*)/g;
const TOKENS = /(?:github_pat_[A-Za-z0-9_]{10,}|gh[pousr]_[A-Za-z0-9]{10,}|sk-(?:proj-)?[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._~+\/-]+=*)/ig;
const SECRET_ASSIGNMENT = /\b(?:api[_-]?key|access[_-]?token|password|secret|authorization|client[_-]?secret|smtp[_-]?password)\s*[:=]\s*["']?[^\s,"';}\]]+/ig;
const SENSITIVE_KEY = /^(?:authorization|cookie|set-cookie|password|passwd|secret|clientSecret|privateKey|private_key|apiKey|api_key|accessToken|access_token|refreshToken|refresh_token|token|credential|credentials|email|emailAddress|fromEmail|toEmail|messageId|message_id|recipient|recipients|sender|username|userName|accountId|account_id|hostId|host_id|threadId|thread_id|ownerThreadId|connectionId|absolutePath|workspacePath|sourcePath|localPath|filePath|outputDirectory)$|(?:^|[_-])(?:password|secret|token|credential|private[_-]?key|api[_-]?key)(?:$|[_-])|(?:password|passwd|token|secret|credential[s]?|api[_-]?key|private[_-]?key)$/i;
const PATH_METADATA_KEY = /(?:path|paths|directory|directories|workspace|cwd|root|file|files|folder|folders|location|locations|dir)$/i;
const SHA256 = /^[a-f0-9]{64}$/, GIT_SHA = /^[a-f0-9]{40}$/;

function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function gitBlobSha(bytes) { return crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'); }
function fail(code) { const e = new Error(code); e.code = code; throw e; }
function within(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}
function cleanRelative(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0') ||
      path.posix.isAbsolute(value) || value.split('/').some(s => !s || s === '.' || s === '..') ||
      /[\x00-\x1f]/.test(value) || /[A-Za-z]:/.test(value) || value.includes('@')) fail('UNSAFE_RELATIVE_PATH');
  return value;
}
function roots(workspace = __dirname) {
  const base = fs.realpathSync(workspace);
  return Object.fromEntries(Object.entries(ROOT_PATHS).map(([alias, relative]) => [alias, path.resolve(base, relative)]));
}
function checkRoot(alias, allRoots) {
  if (!Object.hasOwn(allRoots, alias)) fail('ROOT_NOT_ALLOWED');
  const root = allRoots[alias];
  if (!fs.existsSync(root)) return null;
  if (fs.lstatSync(root).isSymbolicLink() || fs.realpathSync(root) !== root) fail('ROOT_LINK_NOT_ALLOWED');
  return root;
}
function resolveSource(alias, relative, allRoots) {
  const root = checkRoot(alias, allRoots); if (!root) fail('SOURCE_ROOT_MISSING');
  cleanRelative(relative);
  const target = path.resolve(root, ...relative.split('/'));
  if (!within(root, target)) fail('SOURCE_OUTSIDE_ROOT');
  let current = root;
  for (const segment of relative.split('/')) {
    current = path.join(current, segment);
    if (fs.lstatSync(current).isSymbolicLink()) fail('SOURCE_LINK_NOT_ALLOWED');
  }
  if (!within(root, fs.realpathSync(target))) fail('SOURCE_OUTSIDE_ROOT');
  return target;
}
function excludedPath(alias, relative) {
  const parts = relative.split('/');
  if (parts.some(p => OMIT_COMPONENT.test(p) || OMIT_FILE.test(p))) return 'PRIVATE_OR_GENERATED_EXCLUDED';
  const inner = relative.endsWith('.gz') ? relative.slice(0, -3) : relative;
  if (!TEXT_TYPES.has(path.posix.extname(inner).toLowerCase())) return 'UNSUPPORTED_OR_MEDIA_FILE';
  return null;
}
function* walk(alias, allRoots) {
  const root = checkRoot(alias, allRoots); if (!root) return;
  function* descend(dir, prefix) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name, 'en'))) {
      const relative = prefix ? `${prefix}/${item.name}` : item.name;
      try { cleanRelative(relative); } catch { yield { alias, relative: null, reason: 'UNSAFE_FILENAME' }; continue; }
      if (item.isSymbolicLink()) { yield { alias, relative, reason: 'SYMLINK_EXCLUDED' }; continue; }
      if (item.isDirectory()) {
        if (OMIT_COMPONENT.test(item.name) || OMIT_FILE.test(item.name)) {
          yield { alias, relative, reason: 'EXCLUDED_DIRECTORY' }; continue;
        }
        yield* descend(path.join(dir, item.name), relative);
      } else if (item.isFile()) yield { alias, relative, reason: excludedPath(alias, relative) };
      else yield { alias, relative, reason: 'NON_REGULAR_FILE' };
    }
  }
  yield* descend(root, '');
}

function redactText(text) {
  // The broad email local-part pattern otherwise backtracks on large @-free data.
  let updated = text.includes('@') ? text.replace(EMAIL, '[REDACTED_EMAIL]') : text;
  if (updated.includes(':') || updated.includes('\\\\')) updated = updated.replace(WINDOWS_PATH, '[REDACTED_LOCAL_PATH]');
  if (/github_pat_|gh[pousr]_|sk-|Bearer\s/i.test(updated)) updated = updated.replace(TOKENS, '[REDACTED_CREDENTIAL]');
  if (/key|token|password|secret|authorization/i.test(updated)) updated = updated.replace(SECRET_ASSIGNMENT, '[REDACTED_CREDENTIAL]');
  return updated;
}
function inspectJson(value, metadataKey = '') {
  // Mutate only the parsed, private working copy; original file bytes are intact.
  // Iterator frames avoid retaining one traversal item for every JSON element.
  const holder = { value }, frames = [{ parent: holder, key: 'value', metadataKey, depth: 0 }];
  let changed = false, nodes = 0;
  while (frames.length) {
    const frame = frames.at(-1);
    if (frame.iterator) {
      const next = frame.iterator.next();
      if (next.done) { frames.pop(); continue; }
      const key = next.value;
      if (++nodes > MAX_JSON_NODES) fail('JSON_STRUCTURE_BUDGET_EXCEEDED');
      if (!Array.isArray(frame.value) && SENSITIVE_KEY.test(key)) {
        if (frame.value[key] !== '[REDACTED_METADATA]') changed = true;
        frame.value[key] = '[REDACTED_METADATA]'; continue;
      }
      if (!Array.isArray(frame.value) && redactText(key) !== key) fail('UNSAFE_JSON_KEY');
      frames.push({ parent: frame.value, key, metadataKey: Array.isArray(frame.value) ? frame.metadataKey : key, depth: frame.depth + 1 });
      continue;
    }
    if (frame.depth > MAX_JSON_DEPTH) fail('JSON_STRUCTURE_BUDGET_EXCEEDED');
    const item = frame.parent[frame.key];
    if (typeof item === 'string') {
      WINDOWS_PATH.lastIndex = 0;
      if (WINDOWS_PATH.test(item)) {
        if (!PATH_METADATA_KEY.test(frame.metadataKey) || !/^(?:[A-Za-z]:[\\/]|\\\\)/.test(item)) fail('NON_METADATA_LOCAL_PATH');
        frame.parent[frame.key] = '[REDACTED_LOCAL_PATH]'; changed = true;
      } else if (redactText(item) !== item) fail('NON_METADATA_PRIVACY_DATA');
      frames.pop();
    } else if (item && typeof item === 'object') {
      frame.value = item;
      frame.iterator = (function* keys() { if (Array.isArray(item)) { for (let i = 0; i < item.length; i++) yield String(i); }
        else { for (const key in item) if (Object.hasOwn(item, key)) yield key; } })();
    } else frames.pop();
  }
  return { value: holder.value, changed };
}
function redactJson(value, metadataKey = '') { return inspectJson(value, metadataKey).value; }
function integritySensitive(alias, relative, object) {
  if (alias === 'demo-lab' && /(?:^|\/)(?:ledger-cache|preregistration[^/]*|registration[^/]*)(?:\/|\.|$)/i.test(relative)) return true;
  // A changed embedded source/transport body must never masquerade as hash evidence.
  const text = JSON.stringify(object);
  return /"(?:payloadHash|snapshotResponseText|snapshotResponseSha256|predictionHash|sourceHash|previousHash|journalHash)"\s*:/.test(text);
}
function sanitize(bytes, alias, relative) {
  if (bytes.length > MAX_SOURCE_FILE) return { reason: 'SOURCE_FILE_TOO_LARGE' };
  const gzipped = relative.endsWith('.gz');
  let plain;
  try { plain = gzipped ? zlib.gunzipSync(bytes, { maxOutputLength: MAX_INFLATED }) : bytes; }
  catch { return { reason: 'INVALID_OR_OVERSIZED_GZIP' }; }
  if (plain.length > MAX_INFLATED) return { reason: 'INFLATED_FILE_TOO_LARGE' };
  let text; try { text = new TextDecoder('utf-8', { fatal: true }).decode(plain); } catch { return { reason: 'NON_UTF8_TEXT' }; }
  if (text.includes('\0')) return { reason: 'NON_UTF8_TEXT' };
  const inner = gzipped ? relative.slice(0, -3) : relative;
  let updated, object;
  try {
    if (inner.endsWith('.json')) {
      object = JSON.parse(text); const inspected = inspectJson(object);
      updated = inspected.changed ? JSON.stringify(inspected.value) + '\n' : text;
    } else if (/\.(?:jsonl|ndjson)$/.test(inner)) {
      const lines = text.split(/\r?\n/), values = lines.filter(line => line.trim()).map(line => JSON.parse(line));
      object = values; const inspected = inspectJson(values);
      updated = inspected.changed ? inspected.value.map(v => JSON.stringify(v)).join('\n') + '\n' : text;
    } else {
      if (redactText(text) !== text) return { reason: 'TEXT_PRIVACY_REQUIRES_EXCLUSION' };
      updated = text;
    }
  } catch (error) { return { reason: error.code === 'JSON_STRUCTURE_BUDGET_EXCEEDED' ? error.code : 'INVALID_JSON_OR_UNSAFE_KEY' }; }
  const redacted = updated !== text;
  if (redacted && integritySensitive(alias, relative, object)) return { reason: 'INTEGRITY_RECORD_REQUIRES_REDACTION' };
  let stored = bytes;
  if (redacted) stored = gzipped ? zlib.gzipSync(Buffer.from(updated), { level: 6 }) : Buffer.from(updated);
  if (stored.length > MAX_SOURCE_FILE) return { reason: 'STORED_FILE_TOO_LARGE' };
  // Re-scan strings after transformation. Sensitive-key replacement is explicit metadata.
  if (redactText(updated) !== updated) return { reason: 'PRIVACY_SCAN_FAILED' };
  return { bytes: stored, originalSha256: sha256(bytes), storedSha256: sha256(stored),
    originalBytes: bytes.length, storedBytes: stored.length, redacted, exactOriginalRestorable: !redacted,
    encoding: gzipped ? 'gzip' : 'utf8', privacyPolicy: POLICY };
}
function readSafeFile(alias, relative, allRoots) {
  const target = resolveSource(alias, relative, allRoots);
  const fd = fs.openSync(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const before = fs.fstatSync(fd);
    if (!before.isFile() || before.size > MAX_SOURCE_FILE) return { reason: 'SOURCE_FILE_TOO_LARGE_OR_NON_REGULAR' };
    const bytes = fs.readFileSync(fd), after = fs.fstatSync(fd);
    if (statFingerprint(before) !== statFingerprint(after)) return { reason: 'SOURCE_CHANGED_DURING_READ' };
    if (bytes.length > MAX_SOURCE_FILE) return { reason: 'SOURCE_FILE_TOO_LARGE' };
    return { ...sanitize(bytes, alias, relative), fingerprint: statFingerprint(after) };
  } finally { fs.closeSync(fd); }
}
function statFingerprint(stat) {
  return [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs, stat.birthtimeMs].join(':');
}
function recordKey(record) { return `${record.alias}\0${record.relative}\0${record.originalSha256}\0${record.privacyPolicy}`; }
function atomicJson(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.${crypto.randomUUID()}.tmp`;
  const fd = fs.openSync(temp, 'wx');
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(temp, target);
}
async function withLock(workspace, fn) {
  const dir = path.join(workspace, '.runtime', 'git-data-store');
  fs.mkdirSync(dir, { recursive: true });
  const lock = path.join(dir, 'LOCK'); let fd;
  try { fd = fs.openSync(lock, 'wx'); } catch { fail('ARCHIVE_LOCK_BUSY'); }
  fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  fs.fsyncSync(fd);
  try { return await fn(); }
  finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}
function loadConfig(workspace = __dirname) {
  const target = path.join(workspace, '.runtime', 'git-data-store', 'config.json');
  const config = JSON.parse(fs.readFileSync(target, 'utf8'));
  if (config.repository !== REPOSITORY || config.branch !== 'main' || config.account !== 'Yuzora-Yu') fail('CONFIG_REPOSITORY_NOT_ALLOWED');
  if (Object.keys(config).some(key => /token|secret|password|authorization/i.test(key))) fail('CONFIG_MUST_NOT_CONTAIN_CREDENTIALS');
  if (config.roots && (!Array.isArray(config.roots) || config.roots.some(alias => !Object.hasOwn(ROOT_PATHS, alias)))) fail('CONFIG_ROOT_NOT_ALLOWED');
  return { ...config, roots: config.roots || Object.keys(ROOT_PATHS) };
}
function credential() {
  // GCM credential goes only to process memory; never to disk, argv or console.
  let output;
  try { output = execFileSync('git', ['credential', 'fill'], { input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000, maxBuffer: 65536,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' } }); }
  catch { fail('GITHUB_CREDENTIAL_UNAVAILABLE'); }
  const password = output.split(/\r?\n/).find(line => line.startsWith('password='))?.slice(9);
  output = undefined;
  if (!password) fail('GITHUB_CREDENTIAL_UNAVAILABLE');
  return password;
}

class GitHub {
  constructor(token, config, fetchImpl = fetch, scheduler = {}) {
    this.token = token; this.config = config; this.fetchImpl = fetchImpl;
    this.scheduler = { now: scheduler.now || Date.now, sleep: scheduler.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms))) };
    this.contentWrites = 0; this.lastWriteAt = null; this.quota = {};
  }
  async request(method, route, body) {
    if (this.quota.remaining != null && this.quota.remaining <= 10) fail('GITHUB_RATE_HEADROOM_EXHAUSTED');
    if (method !== 'GET') {
      const maximum = this.config.maxContentWrites || 80, interval = this.config.contentWriteIntervalMs || 1500;
      if (!Number.isInteger(maximum) || maximum < 1 || maximum > 100 || !Number.isInteger(interval) || interval < 1000 || interval > 60000) fail('GITHUB_WRITE_BUDGET_INVALID');
      if (this.contentWrites >= maximum) fail('GITHUB_CONTENT_WRITE_BUDGET_EXHAUSTED');
      const pause = this.lastWriteAt == null ? 0 : interval - (this.scheduler.now() - this.lastWriteAt);
      if (pause > 0) await this.scheduler.sleep(pause);
      this.lastWriteAt = this.scheduler.now(); this.contentWrites++;
    }
    let response;
    try { response = await this.fetchImpl(`https://api.github.com${route}`, { method,
      headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Multi-Analyzer-private-research',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(60000) }); }
    catch { fail('GITHUB_REQUEST_AMBIGUOUS'); }
    const integerHeader = name => { const value = response.headers?.get(name); return value != null && /^\d+$/.test(value) ? Number(value) : null; };
    this.quota = { remaining: integerHeader('x-ratelimit-remaining'), resetEpochSeconds: integerHeader('x-ratelimit-reset'),
      retryAfterSeconds: integerHeader('retry-after') };
    if (!response.ok) { const e = new Error(`GITHUB_HTTP_${response.status}`); e.status = response.status; throw e; }
    let text = '', length = 0; const decoder = new TextDecoder('utf-8', { fatal: true });
    if (response.body && response.body[Symbol.asyncIterator]) {
      for await (const chunk of response.body) {
        length += chunk.length; if (length > MAX_REPLY) fail('GITHUB_REPLY_TOO_LARGE');
        text += decoder.decode(chunk, { stream: true });
      }
      text += decoder.decode();
    } else { text = await response.text(); if (Buffer.byteLength(text) > MAX_REPLY) fail('GITHUB_REPLY_TOO_LARGE'); }
    try { return JSON.parse(text); } catch { fail('GITHUB_REPLY_INVALID_JSON'); }
  }
  base() { return `/repos/${this.config.repository}`; }
  async verifyPrivate() {
    const user = await this.request('GET', '/user');
    if (user.login?.toLowerCase() !== this.config.account.toLowerCase()) fail('GITHUB_ACCOUNT_MISMATCH');
    const repo = await this.request('GET', this.base());
    if (repo.private !== true || repo.visibility !== 'private' || repo.full_name?.toLowerCase() !== REPOSITORY.toLowerCase() ||
        repo.owner?.login?.toLowerCase() !== this.config.account.toLowerCase() || repo.permissions?.push !== true || repo.archived) fail('GITHUB_REPOSITORY_NOT_PRIVATE_WRITABLE');
    return { repository: repo.full_name, private: true, account: user.login };
  }
  async ref() {
    const value = await this.request('GET', `${this.base()}/git/ref/heads/${this.config.branch}`);
    if (!GIT_SHA.test(value.object?.sha || '') || value.object.type !== 'commit') fail('REMOTE_REF_INVALID');
    return value.object.sha;
  }
  async treeAt(commit) {
    if (!GIT_SHA.test(commit)) fail('REMOTE_COMMIT_INVALID');
    const c = await this.request('GET', `${this.base()}/git/commits/${commit}`);
    if (c.sha !== commit || !GIT_SHA.test(c.tree?.sha || '')) fail('REMOTE_COMMIT_MISMATCH');
    const tree = await this.request('GET', `${this.base()}/git/trees/${c.tree.sha}?recursive=1`);
    if (tree.truncated || tree.sha !== c.tree.sha || !Array.isArray(tree.tree)) fail('REMOTE_TREE_INCOMPLETE');
    const entries = new Map();
    for (const e of tree.tree) {
      cleanRelative(e.path);
      if (e.type === 'blob') { if (!GIT_SHA.test(e.sha)) fail('REMOTE_TREE_BLOB_INVALID'); entries.set(e.path, e.sha); }
    }
    return { commit, tree: c.tree.sha, entries };
  }
  async blob(sha) {
    if (!GIT_SHA.test(sha)) fail('REMOTE_BLOB_INVALID');
    const response = await this.request('GET', `${this.base()}/git/blobs/${sha}`);
    if (response.sha !== sha || response.encoding !== 'base64' || !Number.isSafeInteger(response.size) || response.size > MAX_BLOB) fail('REMOTE_BLOB_RESPONSE_INVALID');
    const bytes = Buffer.from(response.content || '', 'base64');
    if (bytes.length !== response.size || gitBlobSha(bytes) !== sha) fail('REMOTE_BLOB_HASH_MISMATCH');
    return bytes;
  }
  async putBlob(bytes) {
    if (bytes.length > MAX_BLOB) fail('BLOB_TOO_LARGE');
    const expected = gitBlobSha(bytes);
    const result = await this.request('POST', `${this.base()}/git/blobs`, { encoding: 'base64', content: bytes.toString('base64') });
    if (result.sha !== expected) fail('UPLOADED_BLOB_SHA_MISMATCH');
    return expected;
  }
  async append(base, additions) {
    if (!additions.length) return base.commit;
    for (const addition of additions) if (base.entries.has(addition.path) && base.entries.get(addition.path) !== addition.sha) fail('IMMUTABLE_REMOTE_PATH_CONFLICT');
    const t = await this.request('POST', `${this.base()}/git/trees`, { base_tree: base.tree,
      tree: additions.filter(e => !base.entries.has(e.path)).map(e => ({ path: e.path, mode: '100644', type: 'blob', sha: e.sha })) });
    if (!GIT_SHA.test(t.sha || '')) fail('REMOTE_NEW_TREE_INVALID');
    const c = await this.request('POST', `${this.base()}/git/commits`, { message: 'Append verified private research archive', tree: t.sha, parents: [base.commit] });
    if (!GIT_SHA.test(c.sha || '')) fail('REMOTE_NEW_COMMIT_INVALID');
    let updateError;
    try { await this.request('PATCH', `${this.base()}/git/refs/heads/${this.config.branch}`, { sha: c.sha, force: false }); }
    catch (error) { updateError = error; }
    const current = await this.ref();
    if (current !== c.sha) {
      const compare = await this.request('GET', `${this.base()}/compare/${c.sha}...${current}`);
      if (!['ahead', 'identical'].includes(compare.status)) fail(updateError ? 'REMOTE_UPDATE_CONFLICT_OR_UNRESOLVED' : 'REMOTE_REF_NOT_DESCENDANT');
    }
    const verified = await this.treeAt(current);
    for (const addition of additions) if (verified.entries.get(addition.path) !== addition.sha) fail('REMOTE_COMMIT_VERIFICATION_FAILED');
    return current;
  }
}

function validatePackReference(pack) {
  if (!SHA256.test(pack?.sha256 || '') || !GIT_SHA.test(pack?.gitSha || '') ||
      pack.path !== `packs/${pack.sha256}.json.gz` || !Number.isSafeInteger(pack.bytes) || pack.bytes < 1 || pack.bytes > MAX_BLOB) fail('MANIFEST_PACK_INVALID');
}
function manifestPacks(manifest) {
  return manifest.schema === SCHEMA ? [manifest.pack] : manifest.records.flatMap(r => r.fragments.map(f => f.pack));
}
function validateManifest(manifest, filePath) {
  const fragmented = manifest.schema === FRAGMENT_SCHEMA;
  if (![SCHEMA, FRAGMENT_SCHEMA].includes(manifest.schema) || manifest.privacyPolicy !== POLICY || !Array.isArray(manifest.records) ||
      !manifest.records.length || (fragmented && (manifest.format !== FRAGMENT_FORMAT || manifest.records.length !== 1))) fail('MANIFEST_INVALID');
  if (!fragmented) validatePackReference(manifest.pack);
  if (filePath && !/^manifests\/[a-f0-9]{64}\.json$/.test(filePath)) fail('MANIFEST_PATH_INVALID');
  for (const r of manifest.records) {
    if (!Object.hasOwn(ROOT_PATHS, r.alias) || !SHA256.test(r.originalSha256 || '') || !SHA256.test(r.storedSha256 || '') ||
        r.privacyPolicy !== POLICY || typeof r.redacted !== 'boolean' || r.exactOriginalRestorable !== !r.redacted ||
        !Number.isSafeInteger(r.storedBytes) || r.storedBytes < 0 || r.storedBytes > (fragmented ? MAX_SOURCE_FILE : MAX_FILE) ||
        !Number.isSafeInteger(r.originalBytes) || r.originalBytes < 0 || r.originalBytes > (fragmented ? MAX_SOURCE_FILE : MAX_FILE) ||
        (!r.redacted && (r.originalSha256 !== r.storedSha256 || r.originalBytes !== r.storedBytes))) fail('MANIFEST_RECORD_INVALID');
    cleanRelative(r.relative);
    if (fragmented) {
      if (r.storage !== FRAGMENT_FORMAT || !Array.isArray(r.fragments) || !r.storedBytes ||
          r.fragments.length !== Math.ceil(r.storedBytes / FRAGMENT_BYTES)) fail('MANIFEST_FRAGMENT_COUNT_INVALID');
      let offset = 0;
      for (const [index, fragment] of r.fragments.entries()) {
        if (fragment.index !== index || fragment.offset !== offset || fragment.bytes !== Math.min(FRAGMENT_BYTES, r.storedBytes - offset) ||
            !SHA256.test(fragment.sha256 || '')) fail('MANIFEST_FRAGMENT_ORDER_OR_SIZE_INVALID');
        validatePackReference(fragment.pack); offset += fragment.bytes;
      }
      if (offset !== r.storedBytes) fail('MANIFEST_FRAGMENT_TOTAL_MISMATCH');
    }
  }
  return manifest;
}
async function* manifests(api, tree) {
  for (const [name, sha] of [...tree.entries].sort((a,b) => a[0].localeCompare(b[0]))) {
    if (!name.startsWith('manifests/')) continue;
    const bytes = await api.blob(sha);
    if (name !== `manifests/${sha256(bytes)}.json`) fail('MANIFEST_CONTENT_ADDRESS_MISMATCH');
    let value; try { value = JSON.parse(bytes.toString('utf8')); } catch { fail('MANIFEST_NOT_JSON'); }
    validateManifest(value, name);
    for (const pack of manifestPacks(value)) if (tree.entries.get(pack.path) !== pack.gitSha) fail('MANIFEST_PACK_MISSING_FROM_REF');
    yield { value, path: name, gitSha: sha };
  }
}
function buildPack(records) {
  const byHash = new Map();
  for (const record of records) {
    let payload = record.payload;
    if (!payload) {
      if (!Buffer.isBuffer(record.bytes) || record.bytes.length !== record.storedBytes || sha256(record.bytes) !== record.storedSha256) fail('PACK_INPUT_HASH_MISMATCH');
      payload = zlib.gzipSync(record.bytes, { level: 6 });
    }
    if (!Buffer.isBuffer(payload) || payload.length > MAX_FILE + 65536 || !SHA256.test(record.storedSha256)) fail('PACK_GZIP_INPUT_INVALID');
    byHash.set(record.storedSha256, { sha256: record.storedSha256, size: record.storedBytes,
      gzipSha256: sha256(payload), gzipBytes: payload.length, data: payload.toString('base64') });
  }
  const rawBytes = [...byHash.values()].reduce((sum, value) => sum + value.size, 0);
  const payloadBytes = [...byHash.values()].reduce((sum, value) => sum + value.gzipBytes, 0);
  if (rawBytes > MAX_RAW_PACK) fail('RAW_PACK_TOO_LARGE');
  if (payloadBytes > PACK_PAYLOAD_BUDGET) fail('PAYLOAD_PACK_TOO_LARGE');
  const plain = Buffer.from(JSON.stringify({ schema: SCHEMA, format: 'sha256-gzip-base64-files',
    files: [...byHash].sort((a,b) => a[0].localeCompare(b[0])).map(([, value]) => value) }));
  if (plain.length > MAX_PLAIN_PACK) fail('PLAIN_PACK_TOO_LARGE');
  const bytes = zlib.gzipSync(plain, { level: 6 });
  if (bytes.length > MAX_BLOB) fail('COMPRESSED_PACK_TOO_LARGE');
  return { bytes, sha256: sha256(bytes), gitSha: gitBlobSha(bytes), plainBytes: plain.length, rawBytes, payloadBytes };
}
function unpack(bytes, expectedPack) {
  if (bytes.length !== expectedPack.bytes || sha256(bytes) !== expectedPack.sha256 || gitBlobSha(bytes) !== expectedPack.gitSha) fail('PACK_HASH_MISMATCH');
  let content;
  try { content = JSON.parse(zlib.gunzipSync(bytes, { maxOutputLength: MAX_PLAIN_PACK }).toString('utf8')); }
  catch { fail('PACK_INVALID_OR_TOO_LARGE'); }
  if (content.schema !== SCHEMA || content.format !== 'sha256-gzip-base64-files' || !Array.isArray(content.files)) fail('PACK_FORMAT_INVALID');
  const compressedFiles = new Map(); let totalRaw = 0;
  for (const f of content.files) {
    if (!SHA256.test(f.sha256 || '') || !SHA256.test(f.gzipSha256 || '') || typeof f.data !== 'string' || compressedFiles.has(f.sha256) ||
        !Number.isSafeInteger(f.size) || f.size < 0 || f.size > MAX_FILE || !Number.isSafeInteger(f.gzipBytes) || f.gzipBytes > MAX_FILE + 65536) fail('PACK_FILE_INVALID');
    const data = Buffer.from(f.data, 'base64');
    if (data.length !== f.gzipBytes || sha256(data) !== f.gzipSha256) fail('PACK_FILE_GZIP_HASH_MISMATCH');
    compressedFiles.set(f.sha256, { data, size: f.size }); totalRaw += f.size;
  }
  if (totalRaw > MAX_RAW_PACK) fail('PACK_RAW_BUDGET_EXCEEDED');
  // Retain compressed bytes, never the whole pack's expanded original files.
  return { get(sha) {
    const f = compressedFiles.get(sha); if (!f) return undefined;
    let data; try { data = zlib.gunzipSync(f.data, { maxOutputLength: MAX_FILE }); } catch { fail('PACK_FILE_GZIP_INVALID'); }
    if (data.length !== f.size || sha256(data) !== sha) fail('PACK_FILE_HASH_MISMATCH');
    return data;
  }, has: sha => compressedFiles.has(sha), size: compressedFiles.size, totalRawBytes: totalRaw };
}
async function verifiedPack(api, tree, manifest) {
  if (manifest.schema !== SCHEMA) fail('FRAGMENTS_MUST_USE_WHOLE_FILE_VERIFICATION');
  if (tree.entries.get(manifest.pack.path) !== manifest.pack.gitSha) fail('PACK_NOT_IN_CURRENT_REF');
  const files = unpack(await api.blob(manifest.pack.gitSha), manifest.pack);
  for (const record of manifest.records) {
    const data = files.get(record.storedSha256);
    if (!data || data.length !== record.storedBytes || (!record.redacted && sha256(data) !== record.originalSha256)) fail('MANIFEST_FILE_MISMATCH');
    const safety = sanitize(data, record.alias, record.relative);
    if (safety.reason || safety.redacted || safety.storedSha256 !== record.storedSha256) fail('ARCHIVED_FILE_PRIVACY_CHECK_FAILED');
  }
  return files;
}

async function verifiedFragmentRecord(api, tree, manifest) {
  validateManifest(manifest);
  if (manifest.schema !== FRAGMENT_SCHEMA) fail('EXPECTED_FRAGMENT_MANIFEST');
  const record = manifest.records[0], whole = Buffer.alloc(record.storedBytes);
  const digest = crypto.createHash('sha256');
  for (const fragment of record.fragments) {
    if (tree.entries.get(fragment.pack.path) !== fragment.pack.gitSha) fail('PACK_NOT_IN_CURRENT_REF');
    const files = unpack(await api.blob(fragment.pack.gitSha), fragment.pack);
    const bytes = files.get(fragment.sha256);
    if (!bytes || bytes.length !== fragment.bytes || sha256(bytes) !== fragment.sha256) fail('FRAGMENT_DATA_MISMATCH');
    bytes.copy(whole, fragment.offset); digest.update(bytes);
  }
  if (digest.digest('hex') !== record.storedSha256 || sha256(whole) !== record.storedSha256 ||
      (!record.redacted && record.originalSha256 !== record.storedSha256)) fail('REASSEMBLED_FILE_HASH_MISMATCH');
  // A fragment is not a JSON file or standalone privacy certificate. Inspect the
  // full reassembled file, including credentials spanning a fragment boundary.
  const safety = sanitize(whole, record.alias, record.relative);
  if (safety.reason || safety.redacted || safety.storedSha256 !== record.storedSha256) fail('ARCHIVED_FILE_PRIVACY_CHECK_FAILED');
  return whole;
}
async function verifyArchiveManifest(api, tree, manifest) {
  if (manifest.schema === SCHEMA) return verifiedPack(api, tree, manifest);
  return verifiedFragmentRecord(api, tree, manifest);
}

function summarize() { return { scannedFiles: 0, scannedBytes: 0, acceptedFiles: 0, acceptedBytes: 0, redactedFiles: 0, fragmentedFiles: 0, fragments: 0, alreadyArchived: 0, statCacheHits: 0, exclusions: {} }; }
function exclude(summary, reason) { summary.exclusions[reason] = (summary.exclusions[reason] || 0) + 1; }
async function inventory(options = {}) {
  const allRoots = roots(options.workspace), aliases = options.aliases || Object.keys(ROOT_PATHS), summary = summarize();
  for (const alias of aliases) for (const entry of walk(alias, allRoots)) {
    if (entry.reason) { exclude(summary, entry.reason); continue; }
    const file = readSafeFile(alias, entry.relative, allRoots);
    summary.scannedFiles++; summary.scannedBytes += file.originalBytes || 0;
    if (file.reason) { exclude(summary, file.reason); continue; }
    summary.acceptedFiles++; summary.acceptedBytes += file.storedBytes; summary.redactedFiles += Number(file.redacted);
  }
  return { mode: 'INVENTORY_READ_ONLY', privacyPolicy: POLICY, ...summary };
}
async function sync(options) {
  const { api, workspace = __dirname, config, rehash = false } = options;
  return withLock(workspace, async () => {
    const verifiedRepository = await api.verifyPrivate();
    let tree = await api.treeAt(await api.ref());
    const baseCommit = tree.commit;
    const known = new Set();
    for await (const m of manifests(api, tree)) for (const record of m.value.records) known.add(recordKey(record));
    const allRoots = roots(workspace), summary = summarize(), additions = [], stagedManifests = [];
    const indexPath = path.join(workspace, '.runtime/git-data-store/INDEX.json');
    let previousIndex = {};
    if (!rehash && fs.existsSync(indexPath) && fs.statSync(indexPath).size < MAX_BLOB) {
      try {
        const value = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
        if (value.schema === SCHEMA && value.privacyPolicy === POLICY && value.files && typeof value.files === 'object') previousIndex = value.files;
      } catch { /* Invalid performance cache triggers a full read, never data loss. */ }
    }
    const nextIndex = Object.create(null);
    const batchByteLimit = config.maxBatchBytes || 256 * 1024 * 1024;
    const batchFileLimit = config.maxBatchFiles || 5000;
    if (!Number.isSafeInteger(batchByteLimit) || batchByteLimit < 1 || batchByteLimit > 1024 * 1024 * 1024 ||
        !Number.isSafeInteger(batchFileLimit) || batchFileLimit < 1 || batchFileLimit > 10000) fail('BATCH_LIMIT_INVALID');
    let batch = [], encodedEstimate = 0, rawBatchBytes = 0, payloadBatchBytes = 0, deferred = false;
    const stagedPacks = new Map();
    async function storePack(pack) {
      const packPath = `packs/${pack.sha256}.json.gz`, existing = stagedPacks.get(packPath) || tree.entries.get(packPath);
      if (existing) {
        if (existing !== pack.gitSha) fail('IMMUTABLE_PACK_CONFLICT');
      } else {
        await api.putBlob(pack.bytes); additions.push({ path: packPath, sha: pack.gitSha }); stagedPacks.set(packPath, pack.gitSha);
      }
      return { path: packPath, sha256: pack.sha256, gitSha: pack.gitSha, bytes: pack.bytes.length,
        plainBytes: pack.plainBytes, rawBytes: pack.rawBytes, payloadBytes: pack.payloadBytes };
    }
    async function storeManifest(value) {
      validateManifest(value);
      const bytes = Buffer.from(JSON.stringify(value)), manifestPath = `manifests/${sha256(bytes)}.json`;
      const manifestSha = await api.putBlob(bytes);
      additions.push({ path: manifestPath, sha: manifestSha }); stagedManifests.push({ path: manifestPath, sha: manifestSha });
    }
    async function stageFragmented(record) {
      // Entire input is already UTF-8/JSON/privacy checked before any upload.
      await flush();
      const fragments = [];
      for (let offset = 0, index = 0; offset < record.storedBytes; offset += FRAGMENT_BYTES, index++) {
        const bytes = record.bytes.subarray(offset, Math.min(offset + FRAGMENT_BYTES, record.storedBytes));
        const fragmentHash = sha256(bytes);
        const pack = await storePack(buildPack([{ bytes, storedBytes: bytes.length, storedSha256: fragmentHash }]));
        fragments.push({ index, offset, bytes: bytes.length, sha256: fragmentHash, pack });
      }
      const { bytes, fingerprint, ...metadata } = record;
      await storeManifest({ schema: FRAGMENT_SCHEMA, format: FRAGMENT_FORMAT, privacyPolicy: POLICY,
        archivedAt: new Date().toISOString(), repository: REPOSITORY,
        records: [{ ...metadata, storage: FRAGMENT_FORMAT, fragments }] });
      summary.fragmentedFiles++; summary.fragments += fragments.length;
    }
    async function flush() {
      if (!batch.length) return;
      const pack = await storePack(buildPack(batch));
      const value = { schema: SCHEMA, privacyPolicy: POLICY, archivedAt: new Date().toISOString(),
        repository: REPOSITORY, pack,
        records: batch.map(({ bytes, payload, fingerprint, ...metadata }) => metadata) };
      await storeManifest(value);
      batch = []; encodedEstimate = 0; rawBatchBytes = 0; payloadBatchBytes = 0;
    }
    outer: for (const alias of config.roots || Object.keys(ROOT_PATHS)) for (const entry of walk(alias, allRoots)) {
      if (entry.reason) { exclude(summary, entry.reason); continue; }
      const indexKey = `${alias}/${entry.relative}`, oldIndex = previousIndex[indexKey];
      if (oldIndex && known.has(recordKey({ alias, relative: entry.relative, originalSha256: oldIndex.originalSha256, privacyPolicy: POLICY }))) {
        const stat = fs.statSync(resolveSource(alias, entry.relative, allRoots));
        if (oldIndex.fingerprint === statFingerprint(stat)) {
          nextIndex[indexKey] = oldIndex; summary.alreadyArchived++; summary.statCacheHits++; continue;
        }
      }
      const file = readSafeFile(alias, entry.relative, allRoots);
      summary.scannedFiles++; summary.scannedBytes += file.originalBytes || 0;
      if (file.reason) { exclude(summary, file.reason); continue; }
      const record = { alias, relative: entry.relative, ...file };
      const key = recordKey(record);
      nextIndex[indexKey] = { fingerprint: file.fingerprint, originalSha256: file.originalSha256 };
      if (known.has(key)) { summary.alreadyArchived++; continue; }
      if (summary.acceptedFiles >= batchFileLimit || (summary.acceptedBytes && summary.acceptedBytes + file.storedBytes > batchByteLimit)) { deferred = true; break outer; }
      const payload = file.originalBytes > MAX_FILE || file.storedBytes > MAX_FILE ? null : zlib.gzipSync(file.bytes, { level: 6 });
      if (!payload || payload.length > PACK_PAYLOAD_BUDGET) {
        await stageFragmented(record); known.add(key);
        summary.acceptedFiles++; summary.acceptedBytes += file.storedBytes; summary.redactedFiles += Number(file.redacted);
        continue;
      }
      const estimate = Math.ceil(payload.length / 3) * 4 + 300;
      if (batch.length && (encodedEstimate + estimate > MAX_PLAIN_PACK - 1024 || rawBatchBytes + file.storedBytes > MAX_RAW_PACK ||
          payloadBatchBytes + payload.length > PACK_PAYLOAD_BUDGET)) await flush();
      const { bytes, ...metadata } = record;
      batch.push({ ...metadata, payload }); encodedEstimate += estimate; rawBatchBytes += file.storedBytes;
      payloadBatchBytes += payload.length; known.add(key);
      summary.acceptedFiles++; summary.acceptedBytes += file.storedBytes; summary.redactedFiles += Number(file.redacted);
    }
    await flush();
    const commit = await api.append(tree, additions);
    // Remote ref, manifest Git SHA, pack Git SHA and every stored file hash are read back.
    tree = await api.treeAt(await api.ref());
    for (const expected of stagedManifests) {
      if (tree.entries.get(expected.path) !== expected.sha) fail('REMOTE_MANIFEST_NOT_REACHABLE');
      const bytes = await api.blob(expected.sha);
      if (sha256(bytes) !== path.posix.basename(expected.path, '.json')) fail('REMOTE_MANIFEST_READBACK_MISMATCH');
      await verifyArchiveManifest(api, tree, validateManifest(JSON.parse(bytes.toString('utf8')), expected.path));
    }
    const result = { schema: SCHEMA, mode: 'SYNC_VERIFIED', completedAt: new Date().toISOString(),
      repository: verifiedRepository, baseCommit, publishedCommit: commit, verifiedRef: tree.commit,
      manifests: stagedManifests, deferred, rehash, contentWrites: api.contentWrites, quota: api.quota,
      ...summary, localOriginalsModified: false, localFilesPruned: 0 };
    // Bounded replaceable index. It is a scan optimization, never archive evidence.
    const index = { schema: SCHEMA, privacyPolicy: POLICY, verifiedRef: tree.commit, files: nextIndex };
    if (Buffer.byteLength(JSON.stringify(index)) <= MAX_BLOB) atomicJson(indexPath, index);
    atomicJson(path.join(workspace, '.runtime/git-data-store/LATEST.json'), result);
    return result;
  }).catch(error => {
    if (error.code !== 'ARCHIVE_LOCK_BUSY') atomicJson(path.join(workspace, '.runtime/git-data-store/FAILURE-LATEST.json'), {
      schema: SCHEMA, stoppedAt: new Date().toISOString(), mode: 'SYNC_STOPPED_OR_REMOTE_UNRESOLVED',
      code: safeErrorCode(error), contentWrites: api.contentWrites, quota: api.quota,
      localOriginalsModified: false, localFilesPruned: 0, noAutomaticRetry: true
    });
    throw error;
  });
}

function safeErrorCode(error) {
  return error.code && /^[A-Z0-9_]+$/.test(error.code) ? error.code :
    /^GITHUB_HTTP_\d+$/.test(error.message) ? error.message : 'ARCHIVE_OPERATION_FAILED';
}

function restoreTarget(workspace, alias, relative) {
  if (!Object.hasOwn(ROOT_PATHS, alias)) fail('RESTORE_ALIAS_NOT_ALLOWED');
  cleanRelative(relative);
  const base = path.resolve(workspace, '.runtime/git-data-store/restored');
  const target = path.resolve(base, alias, ...relative.split('/'));
  if (!within(base, target)) fail('RESTORE_OUTSIDE_ALLOWED_DIRECTORY');
  let current = workspace;
  for (const part of path.relative(workspace, path.dirname(target)).split(path.sep)) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) fail('RESTORE_LINK_NOT_ALLOWED');
  }
  return target;
}
async function restore(options) {
  const { api, workspace = __dirname, alias, relative, originalSha256, allowRedacted = false } = options;
  if (!SHA256.test(originalSha256 || '')) fail('RESTORE_EXACT_VERSION_HASH_REQUIRED');
  return withLock(workspace, async () => {
    await api.verifyPrivate();
    const tree = await api.treeAt(await api.ref()); let selected;
    for await (const m of manifests(api, tree)) {
      const record = m.value.records.find(r => r.alias === alias && r.relative === relative && r.originalSha256 === originalSha256);
      if (record) { if (selected && selected.record.storedSha256 !== record.storedSha256) fail('RESTORE_VERSION_AMBIGUOUS'); selected = { ...m, record }; }
    }
    if (!selected) fail('RESTORE_VERSION_NOT_FOUND');
    if (selected.record.redacted && !allowRedacted) fail('REDACTED_COPY_IS_NOT_ORIGINAL_USE_EXPLICIT_FLAG');
    const data = selected.value.schema === FRAGMENT_SCHEMA ? await verifiedFragmentRecord(api, tree, selected.value) :
      (await verifiedPack(api, tree, selected.value)).get(selected.record.storedSha256);
    const target = restoreTarget(workspace, alias, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    // Publish only a fully written/verified file, atomically and without overwrite.
    // A same-directory exclusive hard link is atomic on the supported NTFS host.
    const temp = `${target}.${crypto.randomUUID()}.tmp`;
    const fd = fs.openSync(temp, 'wx', 0o600);
    try {
      try { fs.writeFileSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      if (sha256(fs.readFileSync(temp)) !== selected.record.storedSha256) fail('RESTORE_WRITE_HASH_MISMATCH');
      restoreTarget(workspace, alias, relative);
      fs.linkSync(temp, target);
    } finally { fs.unlinkSync(temp); }
    return { mode: 'RESTORED_VERIFIED_COPY', alias, relative, originalSha256,
      storedSha256: selected.record.storedSha256, exactOriginalRestorable: !selected.record.redacted,
      redacted: selected.record.redacted, schema: selected.value.schema,
      fragments: selected.value.schema === FRAGMENT_SCHEMA ? selected.record.fragments.length : 0,
      destination: `.runtime/git-data-store/restored/${alias}/${relative}`,
      verifiedRef: tree.commit, overwrite: false };
  });
}

function evaluationRun(relative) {
  const match = /^research-forward\/(evaluation-(\d{13})\.json(?:\.gz)?)$/.exec(relative);
  return match ? { prefix: 'research-forward/', id: match[1], at: Number(match[2]) } : null;
}
function protectedEvaluations(allRoots) {
  const root = checkRoot('hourly-observation', allRoots), protectedRuns = new Set();
  if (!root) return protectedRuns;
  for (const prefix of PRUNE_PREFIXES) {
    const dir = path.join(root, ...prefix.split('/').filter(Boolean)); if (!fs.existsSync(dir)) continue;
    if (fs.lstatSync(dir).isSymbolicLink()) fail('EVALUATION_DIRECTORY_LINK_NOT_ALLOWED');
    const children = fs.readdirSync(dir).filter(name => /^evaluation-\d{13}\.json(?:\.gz)?$/.test(name)).sort();
    for (const id of children.slice(-3)) protectedRuns.add(prefix + id);
    // Any existing LATEST*.json pointer in the evaluation parent may preserve older runs.
    for (const parent of [dir, path.dirname(dir)]) {
      for (const name of fs.readdirSync(parent).filter(n => /^latest.*\.json$/i.test(n))) {
        const pointer = path.join(parent, name);
        if (fs.lstatSync(pointer).isSymbolicLink() || fs.statSync(pointer).size > MAX_FILE) fail('LATEST_POINTER_UNSAFE');
        const text = fs.readFileSync(pointer, 'utf8');
        for (const id of children) if (text.includes(id)) protectedRuns.add(prefix + id);
      }
    }
  }
  return protectedRuns;
}
async function prune(options) {
  const { api, workspace = __dirname, apply = false, olderThanDays = 1 } = options;
  if (!Number.isFinite(olderThanDays) || olderThanDays < 1) fail('PRUNE_MINIMUM_AGE_ONE_DAY');
  return withLock(workspace, async () => {
    await api.verifyPrivate(); const tree = await api.treeAt(await api.ref());
    const allRoots = roots(workspace), protectedRuns = protectedEvaluations(allRoots);
    const cutoff = Date.now() - olderThanDays * 86400000;
    const result = { mode: apply ? 'PRUNE_VERIFIED_GENERATED_EVALUATIONS' : 'PRUNE_DRY_RUN',
      verifiedRef: tree.commit, verifiedPacks: 0, eligibleFiles: 0, eligibleBytes: 0,
      prunedFiles: 0, prunedBytes: 0, skipped: {}, originalObservationsPruned: 0 };
    const candidates = [];
    for await (const m of manifests(api, tree)) {
      // Large originals remain working inputs. This change does not enlarge the
      // deletion policy; fragment archives must first have an operational review.
      if (m.value.schema === FRAGMENT_SCHEMA) {
        result.skipped.FRAGMENTED_ORIGINAL_RETAINED = (result.skipped.FRAGMENTED_ORIGINAL_RETAINED || 0) + m.value.records.length;
        continue;
      }
      const records = m.value.records.filter(r => {
        const run = r.alias === 'hourly-observation' && evaluationRun(r.relative);
        return run && run.at < cutoff && !protectedRuns.has(run.prefix + run.id) && !r.redacted && r.exactOriginalRestorable;
      });
      if (!records.length) continue;
      // Already pruned/protected working copies do not need a pack read-back.
      // This is only a prefilter: resolve/stat/hash/bytes are checked again after
      // the network await, and once more before deletion. No local cache is proof.
      const localRecords = [];
      for (const record of records) {
        let target;
        try { target = resolveSource(record.alias, record.relative, allRoots); }
        catch (error) { if (error.code === 'ENOENT') continue; throw error; }
        if (fs.lstatSync(target).mtimeMs < cutoff) localRecords.push(record);
      }
      if (!localRecords.length) continue;
      // Verify every candidate against actual remote bytes before allowing any deletion.
      const data = await verifiedPack(api, tree, m.value);
      result.verifiedPacks++;
      for (const record of localRecords) {
        let target;
        try { target = resolveSource(record.alias, record.relative, allRoots); }
        catch (error) { if (error.code === 'ENOENT') continue; throw error; }
        const stat = fs.lstatSync(target);
        if (stat.mtimeMs >= cutoff) continue;
        const local = fs.readFileSync(target);
        if (sha256(local) !== record.originalSha256 || !local.equals(data.get(record.storedSha256))) { exclude({ exclusions: result.skipped }, 'LOCAL_VERSION_CHANGED'); continue; }
        if (!candidates.some(c => c.target === target)) {
          candidates.push({ target, record, stat }); result.eligibleFiles++; result.eligibleBytes += local.length;
        }
      }
    }
    if (apply) {
      // Fail before deletions if ref/repository changed after verification.
      await api.verifyPrivate(); if (await api.ref() !== tree.commit) fail('REMOTE_REF_CHANGED_BEFORE_PRUNE');
      const protectedNow = protectedEvaluations(allRoots);
      for (const c of candidates) {
        const run = evaluationRun(c.record.relative);
        if (protectedNow.has(run.prefix + run.id)) continue;
        const target = resolveSource(c.record.alias, c.record.relative, allRoots), stat = fs.lstatSync(target);
        if (stat.mtimeMs !== c.stat.mtimeMs || stat.size !== c.stat.size || stat.ino !== c.stat.ino ||
            sha256(fs.readFileSync(target)) !== c.record.originalSha256) continue;
        fs.unlinkSync(target); result.prunedFiles++; result.prunedBytes += stat.size;
      }
    }
    atomicJson(path.join(workspace, '.runtime/git-data-store/PRUNE-LATEST.json'), result);
    return result;
  });
}

async function main(argv = process.argv.slice(2)) {
  const command = argv[0] || 'inventory';
  if (command === 'inventory' || command === 'dry-run') return inventory();
  const config = loadConfig(), api = new GitHub(credential(), config);
  try {
    if (command === 'sync') return await sync({ api, config, rehash: argv.includes('--rehash') });
    if (command === 'prune') {
      const at = argv.indexOf('--older-than-days');
      return await prune({ api, apply: argv.includes('--apply'), olderThanDays: at < 0 ? 1 : Number(argv[at+1]) });
    }
    if (command === 'restore') {
      const [alias, relative, originalSha256] = argv.slice(1);
      return await restore({ api, alias, relative, originalSha256, allowRedacted: argv.includes('--allow-redacted') });
    }
    fail('UNKNOWN_ARCHIVE_COMMAND');
  } finally { api.token = undefined; }
}
if (require.main === module) main().then(result => console.log(JSON.stringify(result))).catch(error => {
  // Never print transport exception objects, credential stderr, source body or user paths.
  console.error(JSON.stringify({ ok: false, code: safeErrorCode(error), originalsPreservedBySync: true }));
  process.exitCode = 1;
});
module.exports = { SCHEMA, FRAGMENT_SCHEMA, FRAGMENT_FORMAT, POLICY, REPOSITORY, MAX_BLOB, MAX_PLAIN_PACK, MAX_RAW_PACK,
  PACK_PAYLOAD_BUDGET, MAX_FILE, MAX_SOURCE_FILE, FRAGMENT_BYTES, MAX_INFLATED, MAX_JSON_NODES, MAX_JSON_DEPTH, ROOT_PATHS, PRUNE_PREFIXES,
  sha256, gitBlobSha, within, cleanRelative, roots, resolveSource, excludedPath, walk, redactText, redactJson,
  sanitize, readSafeFile, recordKey, withLock, loadConfig, GitHub, validateManifest, manifests, buildPack,
  unpack, verifiedPack, verifiedFragmentRecord, verifyArchiveManifest, manifestPacks,
  inventory, sync, restoreTarget, restore, evaluationRun, protectedEvaluations, prune };
