(() => {
  const board = document.querySelector('[data-material-board]');
  if (!board) return;
  const changeField = board.closest('form').elements.materialChanges;
  const folders = [...board.querySelectorAll('[data-material-folder]')];
  const status = board.querySelector('[data-material-status]');
  const empty = board.querySelector('[data-material-empty]');
  const selected = new Set();
  const changes = Object.create(null);
  let active = board.dataset.viewFolder;
  let dragged = [];

  const entries = [...board.querySelectorAll('[data-material-id]')].map(tile => ({
    tile, id: tile.dataset.materialId, categoryId: tile.dataset.categoryId,
    preview: tile.querySelector('[data-material-select]'),
    name: tile.querySelector('[data-material-name]'), input: tile.querySelector('[data-material-rename]')
  }));

  function render() {
    let visibleCount = 0;
    for (const entry of entries) {
      entry.tile.hidden = active !== '*' && entry.categoryId !== active;
      if (!entry.tile.hidden) visibleCount++;
      entry.preview.setAttribute('aria-pressed', String(selected.has(entry.id)));
    }
    for (const folder of folders) {
      const id = folder.dataset.materialFolder;
      folder.setAttribute('aria-pressed', String(id === active));
      folder.querySelector('[data-material-count]').textContent =
        id === '*' ? entries.length : entries.filter(entry => entry.categoryId === id).length;
    }
    empty.hidden = visibleCount > 0;
    changeField.value = JSON.stringify(changes);
    const form = board.closest('form');
    form.elements.categoryId.value = active === '*' ? '' : active;
    const action = new URL(form.action);
    if (active === '*') action.searchParams.delete('materialCategory');
    else action.searchParams.set('materialCategory', active);
    form.action = action.href;
  }

  function update(entry, patch) {
    changes[entry.id] = { ...changes[entry.id], ...patch };
  }

  function move(ids, folder) {
    const categoryId = folder.dataset.materialFolder;
    for (const entry of entries) {
      if (!ids.includes(entry.id) || entry.categoryId === categoryId) continue;
      entry.categoryId = categoryId;
      update(entry, { categoryId });
    }
    selected.clear();
    status.textContent = ids.length + '개 자료를 ' + folder.querySelector('span').textContent + ' 폴더에 넣었어요. 저장하면 반영돼요.';
    render();
  }

  function clearDropTargets() {
    for (const folder of folders) folder.removeAttribute('data-drag-over');
  }

  for (const folder of folders) {
    const id = folder.dataset.materialFolder;
    folder.addEventListener('click', () => {
      if (selected.size && id !== '*') {
        move([...selected], folder);
        return;
      }
      selected.clear();
      active = id;
      status.textContent = '자료를 선택해 폴더로 끌어 놓으세요.';
      render();
    });
    if (id === '*') continue;
    folder.addEventListener('dragover', event => {
      if (!dragged.length) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      folder.setAttribute('data-drag-over', '');
    });
    folder.addEventListener('dragleave', event => {
      if (!folder.contains(event.relatedTarget)) folder.removeAttribute('data-drag-over');
    });
    folder.addEventListener('drop', event => {
      if (!dragged.length) return;
      event.preventDefault();
      move(dragged, folder);
      dragged = [];
      clearDropTargets();
    });
  }

  for (const entry of entries) {
    entry.preview.addEventListener('click', () => {
      if (selected.has(entry.id)) selected.delete(entry.id);
      else selected.add(entry.id);
      status.textContent = selected.size
        ? selected.size + '개 선택 · 폴더로 끌거나 폴더를 누르세요.'
        : '자료를 선택해 폴더로 끌어 놓으세요.';
      render();
    });
    entry.preview.addEventListener('dragstart', event => {
      dragged = selected.has(entry.id) ? [...selected] : [entry.id];
      event.dataTransfer.setData('text/plain', entry.name.textContent);
      event.dataTransfer.effectAllowed = 'move';
    });
    entry.preview.addEventListener('dragend', () => {
      dragged = [];
      clearDropTargets();
    });
    entry.name.addEventListener('click', () => {
      entry.input.value = entry.name.textContent;
      entry.name.hidden = true;
      entry.input.hidden = false;
      entry.input.focus();
      entry.input.select();
    });
    function finishRename(save) {
      if (entry.input.hidden) return;
      const title = entry.input.value.trim();
      if (save && title && title !== entry.name.textContent) {
        entry.name.textContent = title;
        entry.name.setAttribute('aria-label', title + ' 이름 수정');
        entry.preview.setAttribute('aria-label', title);
        update(entry, { title });
        render();
      }
      entry.input.hidden = true;
      entry.name.hidden = false;
    }
    entry.input.addEventListener('blur', () => finishRename(true));
    entry.input.addEventListener('keydown', event => {
      if (!['Enter', 'Escape'].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      finishRename(event.key === 'Enter');
      entry.name.focus();
    });
  }

  render();
})();
