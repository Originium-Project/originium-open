'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const data = require('../data.js');
const sum = (rows, key) => rows.reduce((total, row) => total + row[key], 0);

test('sample is deterministic, fixed-date, complete and synthetic', () => {
  assert.equal(data.RECORDS.length, 133);
  assert.equal(new Set(data.RECORDS.map(record => record.date)).size, 30);
  assert.equal(data.RECORDS[0].date, '2026-08-31');
  assert.equal(data.RECORDS.at(-1).date, data.END_DATE);
  assert.deepEqual([...new Set(data.RECORDS.map(record => record.provider))].sort(), ['Anthropic', 'Google', 'OpenAI']);
  assert.ok(data.RECORDS.every(record => record.status === 'Completed'));
  assert.ok(Object.isFrozen(data.RECORDS));
});

for (const days of data.RANGES) {
  test(`${days}-day view conserves tokens, cost and tasks across all representations`, () => {
    const view = data.selectRange(data.RECORDS, days);
    const selected = data.RECORDS.filter(record => record.date >= view.start && record.date <= view.end);
    assert.equal(view.daily.length, days);
    assert.equal(Date.parse(view.end) - Date.parse(view.start), (days - 1) * 86400000);
    assert.equal(view.totals.count, selected.length);
    assert.equal(sum(view.daily, 'count'), selected.length);
    for (const key of ['input', 'cached', 'output', 'costMicros']) {
      assert.equal(view.totals[key], sum(selected, key));
      assert.equal(view.totals[key], sum(view.daily, key));
    }
    assert.equal(view.totals.total, view.totals.input + view.totals.cached + view.totals.output);
    assert.equal(sum(view.daily, 'total'), view.totals.total);
    assert.equal(view.totals.cacheRate, view.totals.cached / (view.totals.input + view.totals.cached));
    assert.equal(view.latest.length, 6);
    assert.ok(view.latest.every(record => selected.includes(record)));
    assert.ok(view.latest.every((record, index, rows) => index === 0 || rows[index - 1].date + rows[index - 1].time >= record.date + record.time));
    assert.equal(view.daily[0].date, view.start);
    assert.equal(view.daily.at(-1).date, view.end);
  });
}

test('range boundaries are inclusive and exclude records outside the range', () => {
  const base = data.RECORDS[0];
  const records = ['2026-09-22', '2026-09-23', '2026-09-29', '2026-09-30'].map(date => ({ ...base, date }));
  const view = data.selectRange(records, 7);
  assert.equal(view.totals.count, 2);
  assert.equal(view.daily[0].count, 1);
  assert.equal(view.daily.at(-1).count, 1);
  assert.equal(view.daily[1].count, 0);
});

test('spending follows declared invented per-provider rates, with integer microdollars', () => {
  for (const record of data.RECORDS) {
    const provider = data.PROVIDERS.find(provider => provider.name === record.provider);
    assert.equal(record.costMicros, Math.round(record.input * provider.inputRate + record.cached * provider.cacheRate + record.output * provider.outputRate));
    assert.ok(Number.isSafeInteger(record.costMicros));
  }
});

test('longer ranges strictly increase aggregates without mutating the source', () => {
  const original = JSON.stringify(data.RECORDS);
  const views = data.RANGES.map(days => data.selectRange(data.RECORDS, days));
  for (let index = 1; index < views.length; index += 1) {
    for (const key of ['total', 'costMicros', 'count']) assert.ok(views[index].totals[key] > views[index - 1].totals[key]);
  }
  assert.equal(JSON.stringify(data.RECORDS), original);
});

test('empty ranges produce zero-filled days and finite aggregates', () => {
  const view = data.selectRange([], 14);
  assert.equal(view.daily.length, 14);
  assert.ok(view.daily.every(day => day.total === 0 && day.count === 0));
  assert.equal(view.totals.cacheRate, 0);
  assert.equal(view.totals.total, 0);
  assert.deepEqual(view.latest, []);
});

test('unsupported ranges and corrupt records fail explicitly', () => {
  for (const days of [0, 1, 31, NaN, '7', null]) assert.throws(() => data.selectRange(data.RECORDS, days), RangeError);
  assert.throws(() => data.selectRange(null, 7), TypeError);
  for (const input of [-1, NaN, 0.5, '42', Infinity]) assert.throws(() => data.selectRange([{ ...data.RECORDS[0], input }], 7), /Invalid synthetic record/);
  assert.throws(() => data.selectRange([{ ...data.RECORDS[0], date: 'bad date' }], 7), /Invalid synthetic record/);
});

test('preferences tolerate unavailable, denied, corrupt and unrecognized storage', () => {
  const defaults = { theme: 'dark', density: 'comfortable', days: 14 };
  assert.deepEqual(data.readPreferences(undefined), defaults);
  assert.deepEqual(data.readPreferences({ getItem() { throw new Error('denied'); } }), defaults);
  for (const stored of ['{oops', 'null', '[]', '4', '{"theme":"pink","density":"tiny","days":90}']) {
    assert.deepEqual(data.readPreferences({ getItem() { return stored; } }), defaults);
  }
  const preferences = { theme: 'light', density: 'compact', days: 30 };
  let written;
  const storage = { getItem() { return written; }, setItem(key, value) { assert.equal(key, 'token-flow-study'); written = value; } };
  assert.equal(data.savePreferences(storage, preferences), true);
  assert.deepEqual(data.readPreferences(storage), preferences);
  assert.equal(data.savePreferences(undefined, preferences), false);
  assert.equal(data.savePreferences({ setItem() { throw new Error('denied'); } }, preferences), false);
});
