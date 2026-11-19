(() => {
  const dialog = document.getElementById('settings-dialog');
  const tabs = [...dialog.querySelectorAll('[data-settings-tab]')];
  const list = dialog.querySelector('[data-updates-list]');
  const status = dialog.querySelector('[data-updates-status]');
  const more = dialog.querySelector('[data-more-updates]');
  let nextCursor = '';
  let loadedAt = 0;
  let retryAppend = false;
  const retry = dialog.querySelector('[data-retry-updates]');
  const date = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium' });
  let loading = false;

  async function loadUpdates(append = false) {
    if (!append && Date.now() - loadedAt < 30000) return;
    if (loading) return;
    loading = true;
    retry.hidden = true;
    more.disabled = true;
    retryAppend = append;
    status.textContent = '업데이트 내역을 불러오는 중…';
    try {
      const response = await fetch('/updates' + (append && nextCursor ? '?cursor=' + encodeURIComponent(nextCursor) : ''));
      if (!response.ok) throw new Error('업데이트 내역을 불러오지 못했어요.');
      const { updates, nextCursor: cursor } = await response.json();
      const open = new Set([...list.querySelectorAll('details[open]')].map(card => card.dataset.updateId));
      const cards = updates.map(update => {
        const card = document.createElement('details');
        card.className = 'settings-update-card';
        card.dataset.updateId = update.id;
        card.open = open.has(update.id);
        const summary = document.createElement('summary');
        const version = document.createElement('span');
        version.className = 'settings-update-version';
        version.textContent = 'v' + update.version;
        const title = document.createElement('strong');
        title.textContent = update.title;
        const time = document.createElement('time');
        time.dateTime = new Date(update.publishedAt).toISOString();
        time.textContent = date.format(new Date(update.publishedAt));
        const content = document.createElement('div');
        content.className = 'settings-update-content';
        content.textContent = update.content;
        summary.append(version, title, time);
        card.append(summary, content);
        return card;
      });
      if (append) list.append(...cards);
      else list.replaceChildren(...cards);
      nextCursor = cursor || '';
      more.hidden = !nextCursor;
      if (!append) loadedAt = Date.now();
      status.textContent = updates.length ? '' : '아직 등록된 업데이트 내역이 없어요.';
    } catch {
      status.textContent = '업데이트 내역을 불러오지 못했어요.';
      retry.hidden = false;
    } finally {
      loading = false;
      more.disabled = false;
    }
  }

  function select(tab) {
    for (const item of tabs) {
      const active = item === tab;
      item.setAttribute('aria-selected', String(active));
      item.tabIndex = active ? 0 : -1;
      document.getElementById(item.getAttribute('aria-controls')).hidden = !active;
    }
    if (tab.dataset.settingsTab === 'updates') loadUpdates();
  }
  for (const tab of tabs) {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const target = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1) : tabs.find(item => item !== tab);
      select(target);
      target.focus();
    });
  }
  retry.addEventListener('click', () => loadUpdates(retryAppend));
  more.addEventListener('click', () => loadUpdates(true));
  document.querySelector('[data-open-settings]').addEventListener('click', () => {
    if (tabs.find(tab => tab.dataset.settingsTab === 'updates').getAttribute('aria-selected') === 'true') loadUpdates();
  });
  const publisher = document.getElementById('update-publisher');
  if (publisher) {
    document.querySelector('[data-open-update-publisher]').addEventListener('click', () => publisher.showModal());
    if (publisher.hasAttribute('data-reopen')) publisher.showModal();
  }
})();
