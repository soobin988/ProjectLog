const avatarForm = document.querySelector('[data-avatar-form]');
for (const form of document.querySelectorAll('form[data-confirm]')) {
  form.addEventListener('submit', event => {
    if (!window.confirm(form.dataset.confirm)) event.preventDefault();
  });
}
if (avatarForm) {
  const button = avatarForm.querySelector('[data-avatar-button]');
  const picker = avatarForm.elements.avatar;
  const image = avatarForm.querySelector('[data-avatar-image]');
  const status = avatarForm.querySelector('[data-avatar-status]');
  button.addEventListener('click', () => picker.click());
  picker.addEventListener('change', async () => {
    if (!picker.files.length) return;
    button.disabled = true;
    status.textContent = '사진 저장 중…';
    try {
      const response = await fetch(avatarForm.action, { method: 'POST', body: new FormData(avatarForm) });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || '프로필 사진을 저장하지 못했어요.');
      }
      image.src = avatarForm.action + '?v=' + Date.now();
      status.textContent = '프로필 사진을 바꿨어요.';
    } catch (error) {
      status.textContent = error.message;
    } finally {
      picker.value = '';
      button.disabled = false;
    }
  });
}

for (const project of document.querySelectorAll('[data-project]')) {
  const toggle = project.querySelector('.project-head-toggle');
  const expandable = document.getElementById(toggle.getAttribute('aria-controls'));
  let strip;
  let addNode;
  let lastCard;
  let loading;
  const status = expandable.querySelector('[data-strip-status]');
  const retry = expandable.querySelector('[data-strip-retry]');

  async function loadStrip() {
    if (strip) return true;
    if (loading) return loading;
    loading = (async () => {
      retry.hidden = true;
      status.textContent = '작업 노드를 불러오는 중…';
      try {
        const response = await fetch(project.dataset.stripUrl);
        if (!response.ok || response.redirected) throw new Error('작업 노드를 불러오지 못했어요.');
        const template = document.createElement('template');
        template.innerHTML = await response.text();
        strip = template.content.querySelector('.node-strip');
        if (!strip) throw new Error('작업 노드를 불러오지 못했어요.');
        expandable.append(strip);
        addNode = strip.querySelector('.node-add');
        lastCard = [...strip.querySelectorAll('.node-card')].at(-1);
        if (lastCard) new ResizeObserver(alignNodeAdd).observe(lastCard);
        status.textContent = '';
        alignNodeAdd();
        const target = document.getElementById(location.hash.slice(1));
        if (target && strip.contains(target)) {
          expandable.hidden = false;
          toggle.setAttribute('aria-expanded', 'true');
          requestAnimationFrame(() => target.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
        } else if (!expandable.hidden) strip.scrollLeft = strip.scrollWidth;
        return true;
      } catch (error) {
        status.textContent = error.message;
        retry.hidden = false;
        return false;
      } finally {
        loading = null;
      }
    })();
    return loading;
  }
  retry.addEventListener('click', loadStrip);
  function alignNodeAdd() {
    const height = lastCard?.offsetHeight;
    if (!height) return;
    const followEnd = strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 2;
    addNode.style.setProperty('--node-add-size', height + 'px');
    if (followEnd) strip.scrollLeft = strip.scrollWidth;
  }
  expandable.addEventListener('click', event => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const imageLink = event.target.closest('[data-open-gallery]');
    if (!imageLink) return;
    const dialog = imageLink.closest('.node-card-image').querySelector('dialog');
    if (!dialog?.showModal) return;
    event.preventDefault();
    const images = [...dialog.querySelectorAll('figure img')];
    for (const image of images) {
      if (!image.hasAttribute('src')) image.src = image.dataset.src;
    }
    dialog.showModal();
    images[Number(imageLink.dataset.openGallery)].closest('figure').scrollIntoView({ block: 'nearest' });
  });
  toggle.addEventListener('click', () => {
    const shouldOpen = expandable.hidden;
    expandable.hidden = !shouldOpen;
    toggle.setAttribute('aria-expanded', String(shouldOpen));
    if (shouldOpen) loadStrip();
  });

  if (location.hash) loadStrip();
  window.addEventListener('hashchange', () => { if (location.hash) loadStrip(); });
}

const progressForm = document.querySelector('[data-progress-form]');
if (progressForm) {
  const slider = progressForm.elements.progress;
  const output = document.querySelector('[data-progress-value]');
  const error = progressForm.querySelector('[data-progress-error]');
  const retry = progressForm.querySelector('[data-progress-retry]');
  let savedValue = slider.value;
  let saves = Promise.resolve();

  function saveProgress() {
    saves = saves.then(async () => {
      const value = slider.value;
      if (value === savedValue && retry.hidden) return;
      try {
        const response = await fetch(progressForm.action, {
          method: 'POST',
          headers: { Accept: 'application/json' },
          body: new URLSearchParams({ progress: value }),
          keepalive: true
        });
        if (response.status !== 204) throw new Error('진행률 저장 실패');
        savedValue = value;
        error.textContent = '';
        retry.hidden = true;
      } catch {
        error.textContent = '진행률을 저장하지 못했어요.';
        retry.hidden = false;
      }
    });
  }

  slider.addEventListener('input', () => {
    output.textContent = slider.value + '%';
    slider.setAttribute('aria-valuetext', output.textContent);
    slider.style.setProperty('--progress-fill', (slider.valueAsNumber / Number(slider.max)) * 100 + '%');
  });
  slider.addEventListener('change', saveProgress);
  progressForm.addEventListener('submit', event => {
    event.preventDefault();
    saveProgress();
  });
}

const projectTimeline = document.querySelector('[data-project-timeline]');
if (projectTimeline) {
  const addNode = projectTimeline.querySelector('.project-timeline-add');
  const lastNode = [...projectTimeline.querySelectorAll('.timeline-node')].at(-1);
  if (addNode && lastNode) {
    const track = projectTimeline.querySelector('.project-timeline-track');
    function alignAddNode() {
      const followEnd = projectTimeline.scrollLeft + projectTimeline.clientWidth >= projectTimeline.scrollWidth - 2;
      const bounds = lastNode.getBoundingClientRect();
      addNode.style.setProperty('--timeline-add-size', bounds.height + 'px');
      addNode.style.setProperty('--timeline-add-top', bounds.top - track.getBoundingClientRect().top + 'px');
      if (followEnd) projectTimeline.scrollLeft = projectTimeline.scrollWidth;
    }
    alignAddNode();
    new ResizeObserver(alignAddNode).observe(lastNode);
  }
  let scrolling;
  let ignoreDragClick = false;
  projectTimeline.addEventListener('pointerdown', event => {
    if (event.pointerType === 'touch' || event.button !== 0 || scrolling ||
        event.target.closest('button, input, textarea, select, summary')) return;
    scrolling = { id: event.pointerId, x: event.clientX, left: projectTimeline.scrollLeft, active: false };
  });
  projectTimeline.addEventListener('dragstart', event => {
    if (scrolling) event.preventDefault();
  });
  document.addEventListener('pointermove', event => {
    if (event.pointerId !== scrolling?.id) return;
    const distance = event.clientX - scrolling.x;
    if (!scrolling.active && Math.abs(distance) < 6) return;
    event.preventDefault();
    if (!scrolling.active) {
      scrolling.active = true;
      projectTimeline.setAttribute('data-drag-scrolling', '');
      projectTimeline.setPointerCapture(event.pointerId);
    }
    projectTimeline.scrollLeft = scrolling.left - distance;
  }, { passive: false });
  function stopScrolling() {
    if (!scrolling) return;
    if (scrolling.active) {
      ignoreDragClick = true;
      setTimeout(() => { ignoreDragClick = false; }, 0);
      if (projectTimeline.hasPointerCapture(scrolling.id)) projectTimeline.releasePointerCapture(scrolling.id);
    }
    projectTimeline.removeAttribute('data-drag-scrolling');
    scrolling = undefined;
  }
  document.addEventListener('pointerup', event => {
    if (event.pointerId === scrolling?.id) stopScrolling();
  });
  document.addEventListener('pointercancel', event => {
    if (event.pointerId === scrolling?.id) stopScrolling();
  });
  window.addEventListener('blur', stopScrolling);
  projectTimeline.addEventListener('click', event => {
    if (!ignoreDragClick) return;
    ignoreDragClick = false;
    event.preventDefault();
    event.stopPropagation();
  }, true);
  requestAnimationFrame(() => {
    const target = document.getElementById(location.hash.slice(1));
    if (target && projectTimeline.contains(target)) {
      const card = target.closest('.timeline-node') || target;
      projectTimeline.scrollLeft += card.getBoundingClientRect().left - projectTimeline.getBoundingClientRect().left - 4;
    } else if (projectTimeline.hasAttribute('data-follow-latest')) {
      projectTimeline.scrollLeft = projectTimeline.scrollWidth;
    }
  });
}

const breadcrumbFeedback = document.querySelector('[data-breadcrumb-feedback]');
if (breadcrumbFeedback) {
  const summary = breadcrumbFeedback.querySelector('summary');
  breadcrumbFeedback.addEventListener('pointerenter', event => {
    if (event.pointerType === 'mouse') breadcrumbFeedback.open = true;
  });
  breadcrumbFeedback.addEventListener('pointerleave', event => {
    if (event.pointerType === 'mouse' && !breadcrumbFeedback.contains(document.activeElement)) {
      breadcrumbFeedback.open = false;
    }
  });
  breadcrumbFeedback.addEventListener('focusout', event => {
    if (!breadcrumbFeedback.contains(event.relatedTarget) && !breadcrumbFeedback.matches(':hover')) {
      breadcrumbFeedback.open = false;
    }
  });
  breadcrumbFeedback.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    breadcrumbFeedback.open = false;
    summary.focus();
  });
  document.addEventListener('pointerdown', event => {
    if (!breadcrumbFeedback.contains(event.target)) breadcrumbFeedback.open = false;
  });
}

for (const picker of document.querySelectorAll('[data-artifact-picker]')) {
  const methods = picker.querySelector('.artifact-methods');
  const choices = Array.from(methods.querySelectorAll('button'), button => ({
    button,
    panel: document.getElementById(button.getAttribute('aria-controls'))
  }));
  const inputFor = panel => panel.querySelector('input, textarea, select');

  function show(panel) {
    for (const choice of choices) {
      choice.panel.hidden = choice.panel !== panel;
      choice.button.setAttribute('aria-pressed', String(choice.panel === panel));
    }
  }

  for (const { button, panel } of choices) {
    button.addEventListener('click', () => {
      const opening = panel.hidden;
      show(opening ? panel : null);
      if (opening) inputFor(panel).focus();
    });
  }
  picker.addEventListener('invalid', event => {
    const invalidPanel = choices.find(({ panel }) => panel.contains(event.target))?.panel;
    if (invalidPanel?.hidden) show(invalidPanel);
  }, true);
  const filled = choices.find(({ panel }) => inputFor(panel).value);
  show(filled?.panel);
  methods.hidden = false;
}

for (const picker of document.querySelectorAll('[data-portfolio-resources]')) {
  const status = picker.querySelector('[data-resource-status]');
  const fileButtons = [...picker.querySelectorAll('[data-resource-file]')];
  const choices = fileButtons.map(button => ({
    button,
    input: picker.closest('form').elements.namedItem(button.dataset.resourceFile),
    label: button.dataset.resourceFile === 'images' ? '이미지' : '파일'
  }));
  for (const { button, input } of choices) {
    button.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
      status.textContent = choices
        .filter(choice => choice.input.files.length)
        .map(choice => choice.label + ' ' + choice.input.files.length + '개 선택')
        .join(' · ');
    });
  }
  const linkButton = picker.querySelector('[data-resource-link]');
  const linkFields = document.getElementById(linkButton.getAttribute('aria-controls'));
  linkButton.addEventListener('click', () => {
    linkFields.hidden = false;
    linkButton.setAttribute('aria-expanded', 'true');
    linkFields.querySelector('input').focus();
  });
}

for (const form of document.querySelectorAll('[data-feedback-form]')) {
  const button = form.querySelector('button');
  const content = form.closest('[data-feedback-request-content]');
  const overlay = document.querySelector('[data-feedback-analysis-overlay]');
  function positionOverlay() {
    overlay.style.setProperty('--feedback-overlay-top', Math.max(0, document.querySelector('.topbar').getBoundingClientRect().bottom) + 'px');
    overlay.style.setProperty('--feedback-overlay-left', Math.max(0, document.querySelector('.shell').getBoundingClientRect().left) + 'px');
  }
  function setPending(pending) {
    button.disabled = pending;
    button.toggleAttribute('data-pending', pending);
    content.inert = pending;
    content.setAttribute('aria-busy', String(pending));
    document.documentElement.classList.toggle('feedback-is-pending', pending);
    overlay.hidden = !pending;
    if (pending) {
      positionOverlay();
      overlay.focus({ preventScroll: true });
    }
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (button.disabled) {
      return;
    }
    const body = new URLSearchParams(new FormData(form));
    let errorMessage = form.parentElement.querySelector('[role="alert"]');
    if (errorMessage) errorMessage.hidden = true;
    setPending(true);
    try {
      const response = await fetch(form.action || location.href, {
        method: 'POST', headers: { Accept: 'application/json' }, body
      });
      if (response.status === 401) throw new Error('로그인이 만료됐어요. 다시 로그인해 주세요.');
      const result = await response.json().catch(() => ({}));
      if (result.recoveredText) {
        form.querySelector('[data-recovered-text]').value = result.recoveredText;
        form.querySelector('[data-feedback-recovery]').hidden = false;
      }
      if (!response.ok || !result.url) throw new Error(result.error || 'AI 응답을 처리하지 못했어요. 다시 요청해 주세요.');
      location.assign(new URL(result.url, location.href).href);
    } catch (error) {
      setPending(false);
      if (!errorMessage) {
        errorMessage = document.createElement('p');
        errorMessage.className = 'error';
        errorMessage.setAttribute('role', 'alert');
        form.before(errorMessage);
      }
      errorMessage.textContent = error instanceof TypeError ? '서버 연결이 끊겼어요. 연결을 확인하고 다시 요청해 주세요.' : error.message;
      errorMessage.hidden = false;
      errorMessage.scrollIntoView({ block: 'nearest' });
    }
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted) setPending(false);
  });
  window.addEventListener('resize', () => {
    if (!overlay.hidden) positionOverlay();
  });
}

const miniNotifications = document.querySelector('.mini-notifications');
if (miniNotifications) {
  const bell = miniNotifications.querySelector('summary');
  const count = bell.querySelector('.bell-count');
  const error = miniNotifications.querySelector('.mini-alert-error');
  document.addEventListener('pointerdown', event => {
    if (!miniNotifications.contains(event.target)) miniNotifications.open = false;
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !miniNotifications.open) return;
    miniNotifications.open = false;
    bell.focus();
  });
  let pending = false;
  miniNotifications.addEventListener('submit', async event => {
    const form = event.target;
    if (!form.matches('[data-mini-alert]')) return;
    event.preventDefault();
    if (pending) return;
    pending = true;
    const button = form.querySelector('button');
    button.disabled = true;
    error.textContent = '';
    try {
      const response = await fetch(form.action, { method: 'POST', headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('Unable to mark notification as read');
      const { unread } = await response.json();
      form.closest('.notification').classList.add('notification-read');
      form.querySelector('.notification-state').textContent = '✓ 확인함';
      count.textContent = unread;
      count.hidden = !unread;
      bell.setAttribute('aria-label', unread ? '알림, 미확인 ' + unread + '건' : '알림');
    } catch {
      button.disabled = false;
      error.textContent = '알림을 확인하지 못했습니다. 다시 눌러 주세요.';
    } finally {
      pending = false;
    }
  });
}

for (const input of document.querySelectorAll('[data-color-input]')) {
  input.addEventListener('input', () => {
    input.nextElementSibling.textContent = input.value.toUpperCase();
  });
}

const calendarTodoDialog = document.getElementById('calendar-todo-dialog');
if (typeof calendarTodoDialog?.showModal === 'function') {
  const form = calendarTodoDialog.querySelector('form');
  const dateLabel = calendarTodoDialog.querySelector('[data-calendar-todo-date]');
  let trigger;
  document.getElementById('calendar').addEventListener('click', event => {
    const link = event.target.closest('[data-calendar-add]');
    if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    trigger = link;
    form.reset();
    form.action = link.href;
    const [year, month, day] = link.dataset.calendarAdd.split('-').map(Number);
    dateLabel.textContent = year + '년 ' + month + '월 ' + day + '일';
    calendarTodoDialog.showModal();
  });
  calendarTodoDialog.querySelector('[data-calendar-todo-close]').addEventListener('click', () => calendarTodoDialog.close());
  calendarTodoDialog.addEventListener('close', () => trigger?.focus());
}

const todoGroups = document.querySelector('[data-todo-groups]');
if (todoGroups) {
  const toggleError = document.querySelector('[data-todo-toggle-error]');
  let updating = false;

  function revealLinkedTodo() {
    const target = document.getElementById(location.hash.slice(1));
    const history = target?.closest('[data-todo-history]');
    if (history && !history.open) {
      history.open = true;
      target.scrollIntoView({ block: 'nearest' });
    }
  }

  revealLinkedTodo();
  window.addEventListener('hashchange', revealLinkedTodo);
  todoGroups.addEventListener('submit', async event => {
    const form = event.target;
    if (!form.matches('[data-todo-toggle]')) return;
    event.preventDefault();
    if (updating) return;
    updating = true;
    toggleError.hidden = true;

    try {
      const url = new URL(form.action);
      const completedOn = new URLSearchParams(location.search).get('completedOn');
      if (completedOn) url.searchParams.set('completedOn', completedOn);
      const currentPage = new URLSearchParams(location.search).get('page');
      if (currentPage) url.searchParams.set('page', currentPage);
      const response = await fetch(url, { method: 'POST' });
      if (!response.ok) throw new Error('Could not update todo');
      const page = new DOMParser().parseFromString(await response.text(), 'text/html');
      const groups = page.querySelector('[data-todo-groups]');
      const timeline = page.querySelector('[data-todo-timeline]');
      if (!groups || !timeline) throw new Error('Todo list is unavailable');

      const scroll = window.scrollY;
      const row = form.closest('.todo-row');
      const nearbyRow = row.nextElementSibling || row.previousElementSibling;
      const restoreFocus = form.contains(document.activeElement);
      const editRow = todoGroups.querySelector('.todo-edit-form')?.closest('.todo-row');
      if (editRow) page.getElementById(editRow.id)?.replaceWith(editRow);
      for (const history of document.querySelectorAll('[data-todo-history][open]')) {
        const updatedHistory = page.getElementById(history.id);
        if (updatedHistory) updatedHistory.open = true;
      }
      todoGroups.replaceChildren(...groups.children);
      document.querySelector('[data-todo-timeline]').replaceWith(timeline);
      document.querySelector('[data-todo-pagination]').replaceWith(page.querySelector('[data-todo-pagination]'));
      if (restoreFocus) {
        const nextCheck = nearbyRow && document.getElementById(nearbyRow.id)?.querySelector('.todo-check');
        (nextCheck || document.querySelector('.todo-add input')).focus({ preventScroll: true });
      }
      window.scrollTo({ top: scroll, behavior: 'instant' });
    } catch {
      toggleError.textContent = '할 일 상태를 갱신하지 못했어요. 새로고침 후 다시 시도해 주세요.';
      toggleError.hidden = false;
    } finally {
      updating = false;
    }
  });
}

for (const trigger of document.querySelectorAll('[data-open-portfolio-analysis], [data-open-portfolio-materials], [data-open-portfolio-page], [data-open-portfolio-categories]')) {
  const dialog = document.getElementById(trigger.getAttribute('aria-controls'));
  trigger.addEventListener('click', () => dialog.showModal());
  if (dialog.hasAttribute('data-reopen')) dialog.showModal();
}

for (const form of document.querySelectorAll('[data-category-manager]')) {
  const list = form.querySelector('[data-category-list]');
  const status = form.querySelector('[data-category-save-status]');
  const retry = form.querySelector('[data-category-save-retry]');
  const submitButtons = [...form.querySelectorAll('button[type="submit"], button:not([type])')];
  let savedOrder = form.elements.categoryOrder.value;
  let saving = false;
  let needsReload = false;
  let pendingAcknowledgement = false;

  function updateOrder() {
    form.elements.categoryOrder.value = JSON.stringify([...list.children].map(row => row.dataset.categoryId));
  }

  function updateVersion(version) {
    for (const input of document.querySelectorAll('input[name="version"]')) input.value = version;
  }

  function reflectOrder() {
    const nav = document.querySelector('.portfolio-material-categories');
    const gear = nav.querySelector('[data-open-portfolio-categories]');
    const folders = document.querySelector('.portfolio-material-folders');
    const selects = [...document.querySelectorAll('select[name="categoryId"], select[name="analysisCategory"]')];
    const selected = selects.map(select => select.value);
    for (const row of list.children) {
      const id = row.dataset.categoryId;
      nav.insertBefore(nav.querySelector('[data-material-category-link="' + id + '"]'), gear);
      folders.append(folders.querySelector('[data-material-folder="' + id + '"]'));
      for (const select of selects) select.append(select.querySelector('option[value="' + id + '"]'));
    }
    selects.forEach((select, index) => { select.value = selected[index]; });
  }

  async function saveOrder() {
    updateOrder();
    if (saving) return;
    saving = true;
    retry.hidden = true;
    form.setAttribute('aria-busy', 'true');
    for (const button of submitButtons) button.disabled = true;
    let conflicts = 0;
    try {
      while (form.elements.categoryOrder.value !== savedOrder || pendingAcknowledgement) {
        status.textContent = '순서를 저장하는 중…';
        const order = form.elements.categoryOrder.value;
        pendingAcknowledgement = true;
        const response = await fetch(form.action, {
          method: 'POST', headers: { Accept: 'application/json' },
          body: new URLSearchParams({ version: form.elements.version.value, categoryOrder: order })
        });
        const result = await response.json();
        if (response.status === 409) {
          const ids = JSON.parse(order);
          needsReload = result.categories.length !== ids.length || result.categories.some(category => !ids.includes(category.id));
          if (needsReload) throw new Error('카테고리 목록이 변경됐어요. 새로고침해 주세요.');
          if (++conflicts > 2) throw new Error('다른 화면에서 변경 중이에요. 잠시 후 다시 저장해 주세요.');
          updateVersion(result.version);
          continue;
        }
        if (!response.ok) throw new Error(result.error || '순서를 저장하지 못했어요.');
        pendingAcknowledgement = false;
        updateVersion(result.version);
        savedOrder = order;
        reflectOrder();
      }
      status.textContent = '순서를 저장했어요.';
    } catch (error) {
      status.textContent = error instanceof TypeError ? '순서를 저장하지 못했어요. 다시 저장해 주세요.' : error.message;
      retry.textContent = needsReload ? '새로고침' : '다시 저장';
      retry.hidden = false;
    } finally {
      saving = false;
      form.removeAttribute('aria-busy');
      for (const button of submitButtons) button.disabled = false;
    }
  }

  enableSortableList(list, { onChange: saveOrder });
  retry.addEventListener('click', () => needsReload ? location.reload() : saveOrder());
  form.addEventListener('submit', event => {
    updateOrder();
    if (saving) {
      event.preventDefault();
      return;
    }
    const name = event.submitter?.dataset.deleteCategory;
    if (name && !confirm('“' + name + '” 카테고리를 삭제하시겠습니까? 담긴 자료는 미분류로 이동합니다.')) {
      event.preventDefault();
    }
  });
  updateOrder();
}

const portfolioInfo = document.querySelector('[data-portfolio-info]');
if (portfolioInfo) {
  const trigger = portfolioInfo.querySelector('button');
  const card = document.getElementById(trigger.getAttribute('aria-controls'));
  let pinned = false;
  function show(open) {
    card.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
    if (open) {
      card.style.removeProperty('translate');
      const bounds = card.getBoundingClientRect();
      const shift = Math.max(12 - bounds.left, Math.min(0, innerWidth - bounds.right - 12));
      card.style.translate = shift + 'px 0';
    }
  }
  function close() {
    pinned = false;
    show(false);
  }
  portfolioInfo.addEventListener('pointerenter', event => {
    if (event.pointerType === 'mouse') show(true);
  });
  portfolioInfo.addEventListener('pointerleave', () => {
    if (!pinned && !card.contains(document.activeElement)) show(false);
  });
  trigger.addEventListener('click', () => {
    pinned = !pinned;
    show(pinned);
  });
  portfolioInfo.addEventListener('focusout', event => {
    if (!portfolioInfo.contains(event.relatedTarget) && !portfolioInfo.matches(':hover')) close();
  });
  document.addEventListener('pointerdown', event => {
    if (!portfolioInfo.contains(event.target)) close();
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || card.hidden) return;
    if (card.contains(document.activeElement)) trigger.focus();
    close();
  });
}

for (const form of document.querySelectorAll('[data-portfolio-analysis]')) {
  form.addEventListener('submit', event => {
    if (form.getAttribute('aria-busy') === 'true') return event.preventDefault();
    form.setAttribute('aria-busy', 'true');
    const button = form.querySelector('button');
    button.disabled = true;
    form.querySelector('[data-analysis-status]').hidden = false;
    window.addEventListener('pageshow', () => {
      form.removeAttribute('aria-busy');
      button.disabled = false;
      form.querySelector('[data-analysis-status]').hidden = true;
    }, { once: true });
  });
}

const portfolioCopy = document.querySelector('[data-portfolio-copy]');
if (portfolioCopy) {
  const shareField = document.getElementById('portfolio-share-link');
  const status = document.querySelector('[data-portfolio-copy-status]');
  shareField.value = new URL(shareField.value, location.origin).href;
  portfolioCopy.hidden = false;
  portfolioCopy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(shareField.value);
      status.textContent = '공개 링크를 복사했어요.';
    } catch {
      shareField.focus();
      shareField.select();
      status.textContent = '선택된 링크를 복사해 주세요.';
    }
  });
}
document.querySelector('[data-portfolio-delete]')?.addEventListener('submit', event => {
  if (!window.confirm('이 포트폴리오의 첨부 자료와 분석 내역도 삭제할까요?')) event.preventDefault();
});
document.querySelector('[data-project-delete]')?.addEventListener('submit', event => {
  if (!window.confirm('프로젝트를 정말 삭제하시겠습니까? 작업 기록과 피드백도 함께 삭제됩니다. 할 일과 포트폴리오는 연결을 해제해 보관합니다.')) event.preventDefault();
});
document.querySelector('[data-feedback-delete]')?.addEventListener('submit', event => {
  if (!window.confirm('이 피드백을 정말 삭제하시겠습니까?')) event.preventDefault();
});
