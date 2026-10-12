(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const status = $('app-status');
  const data = window.TokenFlowData;
  const integer = new Intl.NumberFormat('en-US');
  const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 });
  const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const dateLabel = date => dateFormat.format(new Date(date + 'T00:00:00Z'));
  let storage;
  try { storage = window.localStorage; } catch (_) { /* file:// storage may be denied. */ }

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function makeTable(className, caption, headings) {
    const table = element('table', undefined, className);
    // Explicit roles preserve table relationships when rows reflow to CSS grid on mobile.
    table.setAttribute('role', 'table');
    table.append(element('caption', caption));
    const head = element('thead');
    head.setAttribute('role', 'rowgroup');
    const row = element('tr');
    row.setAttribute('role', 'row');
    headings.forEach((heading, index) => {
      const th = element('th', heading, index > 1 ? 'numeric' : '');
      th.scope = 'col';
      th.setAttribute('role', 'columnheader');
      row.append(th);
    });
    head.append(row);
    const body = element('tbody');
    body.setAttribute('role', 'rowgroup');
    table.append(head, body);
    return { table, body };
  }

  function renderDaily(view) {
    const { table, body } = makeTable('daily-table', 'Daily totals · ' + view.days + ' days · UTC · synthetic data. USD rounded per row; total calculated before rounding.', ['Date', 'Tasks', 'Tokens', 'USD']);
    view.daily.forEach(day => {
      const row = element('tr');
      row.setAttribute('role', 'row');
      const date = element('th', dateLabel(day.date));
      date.scope = 'row';
      date.setAttribute('role', 'rowheader');
      row.append(date);
      [integer.format(day.count), integer.format(day.total), currency.format(day.costMicros / 1e6)].forEach((value, index) => {
        const cell = element('td', value, index > 0 ? 'numeric' : '');
        cell.setAttribute('role', 'cell');
        row.append(cell);
      });
      body.append(row);
    });
    const foot = element('tfoot');
    const row = element('tr');
    const label = element('th', 'Total');
    label.scope = 'row';
    row.append(label, element('td', integer.format(view.totals.count)), element('td', integer.format(view.totals.total), 'numeric'), element('td', currency.format(view.totals.costMicros / 1e6), 'numeric'));
    foot.append(row);
    table.append(foot);
    $('daily-data').replaceChildren(table);
  }

  function renderActivity(view) {
    $('activity-count').textContent = 'Latest ' + view.latest.length + ' of ' + view.totals.count + ' completed tasks';
    if (!view.latest.length) {
      $('activity-data').replaceChildren(element('p', 'No tasks in this sample period. Choose another period to explore the data.', 'empty-state'));
      return;
    }
    const { table, body } = makeTable('activity-table', 'Invented task names · ' + dateLabel(view.start) + '–' + dateLabel(view.end) + ' 2026 · API costs in USD', ['Task / completed (UTC)', 'Provider', 'Tokens', 'API spend / USD']);
    view.latest.forEach(record => {
      const row = element('tr');
      row.setAttribute('role', 'row');
      const title = element('th', record.title);
      title.scope = 'row';
      title.setAttribute('role', 'rowheader');
      title.append(element('span', dateLabel(record.date) + ' · ' + record.time + ' UTC · ' + record.status, 'task-meta'));
      row.append(title);
      const values = [record.provider, integer.format(record.input + record.cached + record.output), currency.format(record.costMicros / 1e6)];
      ['Provider', 'Tokens', 'API spend / USD'].forEach((label, index) => {
        const cell = element('td', undefined, index > 0 ? 'numeric' : '');
        cell.setAttribute('role', 'cell');
        const mobileLabel = element('span', label, 'mobile-label');
        mobileLabel.setAttribute('aria-hidden', 'true');
        cell.append(mobileLabel, element('span', values[index]));
        row.append(cell);
      });
      body.append(row);
    });
    $('activity-data').replaceChildren(table);
  }

  function render(view) {
    const { totals, daily } = view;
    $('period').textContent = dateLabel(view.start) + ' – ' + dateLabel(view.end) + ' 2026 · ' + view.days + ' days · UTC';
    $('total-tokens').textContent = compact.format(totals.total);
    $('tokens-note').textContent = integer.format(totals.total) + ' tokens, all types';
    $('total-cost').textContent = currency.format(totals.costMicros / 1e6);
    $('cache-rate').textContent = totals.input + totals.cached ? (totals.cacheRate * 100).toFixed(1) + '%' : '—';
    $('task-count').textContent = integer.format(totals.count);
    $('tasks-note').textContent = 'Completed in ' + view.days + ' sample days';
    $('daily-average').textContent = compact.format(totals.total / view.days) + ' / day on average';
    const peak = daily.reduce((best, day) => day.total > best.total ? day : best, daily[0]);
    const ceiling = Math.max(100000, Math.ceil(peak.total / 100000) * 100000);
    $('axis-top').textContent = compact.format(ceiling);
    $('axis-middle').textContent = compact.format(ceiling / 2);
    $('bars').style.setProperty('--bar-count', String(view.days));
    $('bars').replaceChildren(...daily.map(day => {
      const bar = element('span', undefined, 'bar');
      bar.style.setProperty('--bar-height', (day.total / ceiling * 100) + '%');
      return bar;
    }));
    $('chart-dates').replaceChildren(element('span', dateLabel(view.start)), element('span', dateLabel(view.end)));
    $('chart-summary').textContent = totals.count
      ? integer.format(totals.total) + ' tokens across ' + view.days + ' days. Peak: ' + integer.format(peak.total) + ' on ' + dateLabel(peak.date) + '. Includes uncached input, cached input and output.'
      : 'No task data in this period. Daily totals are zero; cache hit rate is not applicable.';
    const parts = [['Uncached input', totals.input], ['Cached input', totals.cached], ['Output', totals.output]];
    $('composition-track').replaceChildren(...parts.map(([, value]) => {
      const segment = element('span');
      segment.style.flexGrow = String(value);
      return segment;
    }));
    $('composition-values').replaceChildren(...parts.map(([label, value]) => {
      const group = element('div');
      const valueNode = element('dd', integer.format(value));
      valueNode.append(element('span', totals.total ? (value / totals.total * 100).toFixed(1) + '%' : '0%'));
      group.append(element('dt', label), valueNode);
      return group;
    }));
    renderDaily(view);
    renderActivity(view);
  }

  try {
    if (!data) throw new Error('Missing local data script.');
    const preferences = data.readPreferences(storage);
    function applyPreferences() {
      document.documentElement.dataset.theme = preferences.theme;
      document.body.classList.toggle('ast-density-compact', preferences.density === 'compact');
      document.body.classList.toggle('ast-density-comfortable', preferences.density === 'comfortable');
      $('theme-toggle').setAttribute('aria-pressed', String(preferences.theme === 'light'));
      $('density-toggle').setAttribute('aria-pressed', String(preferences.density === 'compact'));
      $('profile-name').textContent = (preferences.theme === 'dark' ? 'Dark' : 'Light') + ' · ' + (preferences.density === 'compact' ? 'Compact' : 'Comfortable');
      $('range').value = String(preferences.days);
      data.savePreferences(storage, preferences);
    }
    function updateRange(announce) {
      render(data.selectRange(data.RECORDS, preferences.days));
      status.className = 'sr-only';
      status.textContent = announce ? 'Showing ' + preferences.days + ' days of synthetic data. Capacity is a separate fixed snapshot.' : '';
    }
    applyPreferences();
    updateRange(false);
    $('theme-toggle').disabled = false;
    $('density-toggle').disabled = false;
    $('range').disabled = false;
    $('theme-toggle').addEventListener('click', () => {
      preferences.theme = preferences.theme === 'dark' ? 'light' : 'dark';
      applyPreferences();
    });
    $('density-toggle').addEventListener('click', () => {
      preferences.density = preferences.density === 'comfortable' ? 'compact' : 'comfortable';
      applyPreferences();
    });
    $('range').addEventListener('change', () => {
      const nextDays = Number($('range').value);
      if (!data.RANGES.includes(nextDays)) return;
      preferences.days = nextDays;
      updateRange(true);
      applyPreferences();
    });
  } catch (_) {
    status.className = 'notice';
    status.hidden = false;
    status.textContent = 'The local sample could not be loaded. Reopen index.html with data.js and app.js in the same folder. The capacity snapshot and design notes are still available.';
    ['theme-toggle', 'density-toggle', 'range'].forEach(id => { $(id).disabled = true; });
  }
  $('tokens-link').addEventListener('click', () => { $('token-disclosure').open = true; });
})();
