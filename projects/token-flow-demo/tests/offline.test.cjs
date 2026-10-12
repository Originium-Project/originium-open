'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('index.html');
const css = read('dashboard.css');
const scripts = read('app.js') + read('data.js');

test('all page assets are local and exist; classic scripts support file URLs', () => {
  const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1]).filter(value => !value.startsWith('#'));
  assert.ok(assets.includes('vendor/structural/css/tokens.css'));
  assert.ok(assets.includes('vendor/structural/css/recipes.css'));
  assert.ok(assets.includes('vendor/structural/css/responsive.css'));
  for (const asset of assets) {
    assert.doesNotMatch(asset, /^(?:[a-z]+:|\/)/i);
    assert.ok(fs.existsSync(path.join(root, asset)), asset);
  }
  assert.doesNotMatch(html, /type="module"|<iframe/i);
  assert.doesNotMatch(scripts, /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|import\s*\(/);
  assert.doesNotMatch(html + css + scripts, /https?:\/\/|@import|@font-face/);
  assert.doesNotMatch(css, /url\(/i);
  const pkg = JSON.parse(read('package.json'));
  assert.equal(Object.keys(pkg.dependencies || {}).length, 0);
  assert.equal(Object.keys(pkg.devDependencies || {}).length, 0);
});

test('navigation resolves to implemented sections and all IDs are unique', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, new Set(ids).size);
  const targets = [...html.matchAll(/href="#([^"]*)"/g)].map(match => match[1]);
  assert.ok(targets.length >= 6);
  for (const target of targets) assert.ok(ids.includes(target), 'Missing target: ' + target);
});

test('authored profile uses vendor dimensions and maintains square, flat geometry', () => {
  assert.ok((css.match(/var\(--ast-semantic-/g) || []).length > 20);
  assert.ok((css.match(/var\(--ast-foundation-/g) || []).length > 30);
  assert.match(html, /class="lead-grid ast-grid ast-dossier"/);
  assert.match(html, /class="ast-control"/);
  assert.doesNotMatch(css, /gradient\(|(?:box|text)-shadow\s*:\s*(?!none)/);
  for (const match of css.matchAll(/border-radius\s*:\s*([^;}]+)/g)) assert.equal(match[1].trim(), '0');
  assert.doesNotMatch(css, /overflow(?:-x|-y)?\s*:\s*(?:hidden|clip)/);
  assert.match(css, /min-height:\s*var\(--ast-foundation-layout-target-min\)/);
  assert.match(read('vendor/structural/css/tokens.css'), /--ast-foundation-layout-target-min: 2\.75rem/);
});

test('accessible foundations include native controls, labels, data alternatives and no-JS guidance', () => {
  assert.match(html, /<html lang="en"/);
  assert.match(html, /Skip to overview/);
  assert.match(html, /<label for="range"/);
  assert.match(html, /<noscript>/);
  assert.match(html, /View daily chart data/);
  assert.match(html, /<meter[^>]+aria-label=/);
  assert.match(html, /aria-live="polite"/);
  assert.match(css, /focus-visible/);
  assert.match(css, /prefers-reduced-motion/);
  assert.doesNotMatch(css, /text-overflow\s*:\s*ellipsis/);
});
