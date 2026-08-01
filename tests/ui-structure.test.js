const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

test('UI IDs are unique and all literal app.js references exist', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'duplicate HTML id detected');

  const references = [...app.matchAll(/\$\('([^']+)'\)/g)].map(match => match[1]);
  const idSet = new Set(ids);
  const missing = [...new Set(references)].filter(id => !idSet.has(id));
  assert.deepEqual(missing, []);
});

test('chart viewport is bounded and cannot grow from chart children', () => {
  assert.match(css, /\.app-shell\s*\{[^}]*height:\s*100dvh/s);
  assert.match(css, /\.terminal-main\s*\{[^}]*min-height:\s*0/s);
  assert.match(css, /\.chart-stage\s*\{[^}]*height:\s*100%[^}]*min-height:\s*0/s);
  assert.match(css, /\.chart-container\s*\{[^}]*position:\s*absolute[^}]*inset:\s*0[^}]*contain:\s*strict/s);
  assert.doesNotMatch(css, /chart-container[^}]*height:\s*calc\(100%\s*-\s*59px\)/s);
});

test('chart resize and fit operations are guarded', () => {
  assert.match(app, /state\.chartSize\.width === width && state\.chartSize\.height === height/);
  assert.match(app, /if \(!state\.chartFitted\)/);
  assert.match(app, /state\.chartResizeObserver\.disconnect\(\)/);
});
