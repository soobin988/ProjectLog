const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

function element() {
  return {
    children: [], dataset: {}, attributes: {}, listeners: {}, hidden: false,
    append(...items) { this.children.push(...items); },
    replaceChildren(...items) { this.children = items; },
    querySelectorAll() { return this.children.filter(child => child.open); },
    setAttribute(key, value) { this.attributes[key] = value; },
    getAttribute(key) { return this.attributes[key]; },
    addEventListener(name, handler) { this.listeners[name] = handler; },
    focus() {}
  };
}

test('update history appends cursor pages, retries failed pages and avoids repeated opens', async () => {
  const list = element(), status = element(), retry = element(), more = element(), opener = element();
  const panels = { general: element(), updates: element() };
  const tabs = Object.keys(panels).map(name => {
    const tab = element(); tab.dataset.settingsTab = name;
    tab.setAttribute('aria-controls', name);
    return tab;
  });
  const dialog = element();
  dialog.querySelectorAll = () => tabs;
  dialog.querySelector = selector => ({ '[data-updates-list]': list, '[data-updates-status]': status,
    '[data-retry-updates]': retry, '[data-more-updates]': more })[selector];
  const calls = [];
  let fail = false;
  const update = id => ({ id, version:'1.0.0', title:id, content:'test', publishedAt:'2026-11-19T00:00:00Z' });
  const context = {
    document: {
      getElementById: id => id === 'settings-dialog' ? dialog : panels[id] || null,
      querySelector: () => opener, createElement: element
    },
    fetch: async url => {
      calls.push(url);
      if (fail) throw new Error('network');
      return { ok:true, json:async()=>({updates:[update(url)],nextCursor:url.includes('?') ? '' : 'older-page'}) };
    }, Intl, Date, Set, encodeURIComponent
  };
  vm.runInNewContext(readFileSync(require.resolve('../public/updates.js'),'utf8'),context);
  tabs[1].listeners.click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(list.children.length,1);
  assert.equal(more.hidden,false);
  opener.listeners.click();
  assert.equal(calls.length,1);
  fail = true;
  await more.listeners.click();
  assert.equal(retry.hidden,false);
  assert.equal(list.children.length,1);
  fail = false;
  await retry.listeners.click();
  assert.equal(calls.at(-1),'/updates?cursor=older-page');
  assert.equal(list.children.length,2);
  assert.equal(more.hidden,true);
  assert.equal(more.disabled,false);
});
