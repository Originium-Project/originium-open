/* Deterministic invented records; classic script works directly from file://. */
(function (root) {
  'use strict';
  const END_DATE = '2026-09-29';
  const DAY_MS = 86400000;
  const RANGES = Object.freeze([7, 14, 30]);
  const PROVIDERS = Object.freeze([
    { name: 'OpenAI', inputRate: 3, cacheRate: 0.3, outputRate: 12 },
    { name: 'Anthropic', inputRate: 3, cacheRate: 0.3, outputRate: 15 },
    { name: 'Google', inputRate: 2, cacheRate: 0.2, outputRate: 10 }
  ]);
  const TITLES = [
    'Review the search index migration', 'Draft release notes for the editor',
    'Refactor the date formatting utility', 'Trace a failing export test',
    'Compare document retrieval strategies', 'Check keyboard navigation in settings',
    'Summarize the public changelog', 'Build fixtures for the parser',
    'Review accessibility of the filter controls', 'Document the caching interface',
    'Investigate a slow table render', 'Polish the empty-state copy'
  ];

  function makeRecords() {
    const end = Date.parse(END_DATE + 'T00:00:00Z');
    const records = [];
    for (let day = 0; day < 30; day += 1) {
      const date = new Date(end - (29 - day) * DAY_MS).toISOString().slice(0, 10);
      for (let task = 0; task < 3 + day % 4; task += 1) {
        const provider = PROVIDERS[(day + task) % PROVIDERS.length];
        const input = 14000 + ((day * 7919 + task * 4261) % 34000);
        const cached = 24000 + ((day * 6143 + task * 10103) % 64000);
        const output = 6000 + ((day * 2671 + task * 1567) % 18000);
        // Rates are invented USD per million tokens. Integer microdollars avoid sum drift.
        const costMicros = Math.round(input * provider.inputRate + cached * provider.cacheRate + output * provider.outputRate);
        records.push(Object.freeze({
          date, time: String(8 + task * 2).padStart(2, '0') + ':15',
          title: TITLES[(day * 3 + task) % TITLES.length], provider: provider.name,
          input, cached, output, costMicros, status: 'Completed'
        }));
      }
    }
    return Object.freeze(records);
  }

  function validateRecord(record) {
    if (!record || typeof record.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(record.date) ||
        !Number.isFinite(Date.parse(record.date + 'T00:00:00Z')) ||
        !['input', 'cached', 'output', 'costMicros'].every(key => Number.isSafeInteger(record[key]) && record[key] >= 0) ||
        !['title', 'time', 'provider'].every(key => typeof record[key] === 'string') || record.status !== 'Completed') {
      throw new Error('Invalid synthetic record.');
    }
  }

  function selectRange(records, days) {
    if (!RANGES.includes(days)) throw new RangeError('Choose 7, 14 or 30 days.');
    if (!Array.isArray(records)) throw new TypeError('The sample must be an array.');
    records.forEach(validateRecord);
    const end = Date.parse(END_DATE + 'T00:00:00Z');
    const start = new Date(end - (days - 1) * DAY_MS).toISOString().slice(0, 10);
    const selected = records.filter(record => record.date >= start && record.date <= END_DATE);
    const daily = Array.from({ length: days }, (_, index) => ({
      date: new Date(end - (days - 1 - index) * DAY_MS).toISOString().slice(0, 10),
      input: 0, cached: 0, output: 0, total: 0, costMicros: 0, count: 0
    }));
    const byDate = new Map(daily.map(day => [day.date, day]));
    const totals = { input: 0, cached: 0, output: 0, total: 0, costMicros: 0, count: 0 };
    for (const record of selected) {
      const day = byDate.get(record.date);
      for (const key of ['input', 'cached', 'output', 'costMicros']) {
        totals[key] += record[key];
        day[key] += record[key];
      }
      totals.count += 1;
      day.count += 1;
      day.total += record.input + record.cached + record.output;
    }
    totals.total = totals.input + totals.cached + totals.output;
    totals.cacheRate = totals.input + totals.cached ? totals.cached / (totals.input + totals.cached) : 0;
    const latest = [...selected].sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time)).slice(0, 6);
    return { days, start, end: END_DATE, daily, totals, latest };
  }

  function readPreferences(storage) {
    const defaults = { theme: 'dark', density: 'comfortable', days: 14 };
    try {
      const parsed = JSON.parse(storage.getItem('token-flow-study'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return defaults;
      return {
        theme: ['dark', 'light'].includes(parsed.theme) ? parsed.theme : defaults.theme,
        density: ['comfortable', 'compact'].includes(parsed.density) ? parsed.density : defaults.density,
        days: RANGES.includes(parsed.days) ? parsed.days : defaults.days
      };
    } catch (_) { return defaults; }
  }

  function savePreferences(storage, preferences) {
    try { storage.setItem('token-flow-study', JSON.stringify(preferences)); return true; }
    catch (_) { return false; }
  }

  const api = Object.freeze({ END_DATE, RANGES, PROVIDERS, RECORDS: makeRecords(), selectRange, readPreferences, savePreferences });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TokenFlowData = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
