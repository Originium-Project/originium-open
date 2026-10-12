'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const data = require('../data.js');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');

// A small DOM boundary double for control wiring, not a browser/layout simulator.
class Node {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.dataset = {};
    this.style = { setProperty(name, value) { this[name] = value; } };
    this.className = '';
    this.classList = { toggle: (name, enabled) => {
      const names = new Set(this.className.split(' ').filter(Boolean));
      if (enabled) names.add(name); else names.delete(name);
      this.className = [...names].join(' ');
    } };
  }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return (this.text || '') + this.children.map(node => node.textContent).join(''); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.text = ''; this.children = nodes; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  fire(name) { assert.ok(this.listeners[name], `Missing handler: ${name}`); this.listeners[name](); }
}
function boot({ records = data.RECORDS, missingData = false, denied = false, saved = null } = {}) {
  const nodes = new Map([...html.matchAll(/<([a-z0-9]+)\b[^>]*\bid="([^"]+)"[^>]*>/g)].map(match => [match[2], new Node(match[1])]));
  for (const id of ['theme-toggle', 'density-toggle', 'range']) nodes.get(id).disabled = true;
  const document = { getElementById: id => nodes.get(id), createElement: tag => new Node(tag), documentElement: new Node('html'), body: new Node('body') };
  let written = saved;
  const window = { TokenFlowData: missingData ? undefined : { ...data, RECORDS: records } };
  Object.defineProperty(window, 'localStorage', { get() {
    if (denied) throw new Error('Storage access denied');
    return { getItem() { return written; }, setItem(key, value) { written = value; } };
  } });
  vm.runInNewContext(source, { window, document, Intl, Date, Number, String, Error });
  return { node: id => nodes.get(id), document, saved: () => written };
}

test('app starts dark and comfortable, renders the 14-day data, and enables controls', () => {
  const app = boot();
  assert.equal(app.document.documentElement.dataset.theme, 'dark');
  assert.match(app.document.body.className, /ast-density-comfortable/);
  assert.equal(app.node('range').value, '14');
  assert.equal(app.node('bars').children.length, 14);
  const selected = data.RECORDS.filter(record => record.date >= '2026-09-16');
  const total = selected.reduce((sum, record) => sum + record.input + record.cached + record.output, 0);
  assert.equal(app.node('tokens-note').textContent, new Intl.NumberFormat('en-US').format(total) + ' tokens, all types');
  assert.equal(app.node('task-count').textContent, String(selected.length));
  assert.equal(app.node('app-status').textContent, '');
  for (const id of ['theme-toggle', 'density-toggle', 'range']) assert.equal(app.node(id).disabled, false);
});

test('theme, density, range and design-token navigation update their real targets', () => {
  const app = boot();
  app.node('theme-toggle').fire('click');
  assert.equal(app.document.documentElement.dataset.theme, 'light');
  assert.equal(app.node('theme-toggle').attributes['aria-pressed'], 'true');
  app.node('density-toggle').fire('click');
  assert.match(app.document.body.className, /ast-density-compact/);
  assert.doesNotMatch(app.document.body.className, /ast-density-comfortable/);
  assert.equal(app.node('density-toggle').attributes['aria-pressed'], 'true');
  assert.equal(app.node('profile-name').textContent, 'Light · Compact');
  for (const days of [7, 30, 14]) {
    app.node('range').value = String(days);
    app.node('range').fire('change');
    const view = data.selectRange(data.RECORDS, days);
    assert.equal(app.node('bars').children.length, days);
    assert.equal(app.node('task-count').textContent, String(view.totals.count));
    assert.equal(app.node('total-cost').textContent, new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(view.totals.costMicros / 1e6));
    assert.ok(app.node('period').textContent.includes(days + ' days'));
    assert.ok(app.node('app-status').textContent.includes(days + ' days'));
    assert.equal(app.node('daily-data').children[0].children[2].children.length, days);
    assert.equal(app.node('activity-data').children[0].children[2].children.length, 6);
  }
  assert.deepEqual(JSON.parse(app.saved()), { theme: 'light', density: 'compact', days: 14 });
  app.node('tokens-link').fire('click');
  assert.equal(app.node('token-disclosure').open, true);
  app.node('theme-toggle').fire('click');
  app.node('density-toggle').fire('click');
  assert.equal(app.document.documentElement.dataset.theme, 'dark');
  assert.equal(app.node('density-toggle').attributes['aria-pressed'], 'false');
});

test('chart bars use the same daily totals and scale as the numeric alternative', () => {
  const app = boot();
  const view = data.selectRange(data.RECORDS, 14);
  const ceiling = Math.ceil(Math.max(...view.daily.map(day => day.total)) / 100000) * 100000;
  app.node('bars').children.forEach((bar, index) => {
    assert.equal(parseFloat(bar.style['--bar-height']), view.daily[index].total / ceiling * 100);
  });
  assert.ok(app.node('chart-summary').textContent.includes(new Intl.NumberFormat('en-US').format(view.totals.total)));
});

test('denied storage and corrupt saved values still allow interactions', () => {
  for (const settings of [{ denied: true }, { saved: '{bad json' }, { saved: '{"days":999}' }]) {
    const app = boot(settings);
    app.node('theme-toggle').fire('click');
    app.node('range').value = '7';
    app.node('range').fire('change');
    assert.equal(app.node('bars').children.length, 7);
    assert.equal(app.document.documentElement.dataset.theme, 'light');
  }
  const restored = boot({ saved: '{"theme":"light","density":"compact","days":30}' });
  assert.equal(restored.node('bars').children.length, 30);
  assert.equal(restored.node('profile-name').textContent, 'Light · Compact');
});

test('empty data renders zero totals and explicit empty activity without NaN', () => {
  const app = boot({ records: [] });
  assert.equal(app.node('total-tokens').textContent, '0');
  assert.equal(app.node('cache-rate').textContent, '—');
  assert.equal(app.node('task-count').textContent, '0');
  assert.match(app.node('activity-data').textContent, /No tasks/);
  assert.match(app.node('chart-summary').textContent, /No task data/);
  assert.ok(app.node('bars').children.every(bar => bar.style['--bar-height'] === '0%'));
});

test('missing or malformed dataset produces visible recovery guidance and disabled data controls', () => {
  for (const settings of [{ missingData: true }, { records: [{}] }]) {
    const app = boot(settings);
    assert.equal(app.node('app-status').hidden, false);
    assert.equal(app.node('app-status').className, 'notice');
    assert.match(app.node('app-status').textContent, /could not be loaded/);
    assert.equal(app.node('range').disabled, true);
    app.node('tokens-link').fire('click');
    assert.equal(app.node('token-disclosure').open, true);
  }
});
