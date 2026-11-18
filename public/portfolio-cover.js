(() => {
  const editor = document.querySelector('[data-cover-editor]');
  if (!editor) return;

  const form = editor.form;
  const settings = JSON.parse(editor.dataset.coverSettings);
  const savedImages = JSON.parse(editor.dataset.coverImages);
  const preview = editor.querySelector('[data-cover-preview]');
  const title = editor.querySelector('[data-cover-title]');
  const mode = editor.querySelector('[data-cover-mode]');
  const color = editor.querySelector('[data-cover-color]');
  const crop = editor.querySelector('[data-cover-crop]');
  const imagePicker = editor.querySelector('[data-cover-image]');
  const adjustments = editor.querySelector('[data-cover-adjustments]');
  const ranges = [...adjustments.querySelectorAll('[data-cover-value]')];
  const buttons = [...editor.querySelectorAll('[data-cover-slot]')];
  const tiles = [...preview.querySelectorAll('[data-cover-tile]')];
  const upload = form.elements.images;
  let active = 0;
  let added = [];
  let images = [];
  let drag;

  const positionDefaults = { x: 50, y: 50, zoom: 1 };
  const bound = value => Math.max(0, Math.min(100, value));
  const imageFor = id => images.find(image => image.id === id);
  const visibleSlots = () => settings.slots.map(slot => imageFor(slot?.id) ? slot : null);

  function automaticTile() {
    const picked = form.querySelector('input[name="thumbnail"]:checked')?.value;
    const image = imageFor(picked) || images.find(item => item.thumbnail) || images[0];
    return image ? { id: image.id, ...positionDefaults } : null;
  }

  function render() {
    const editingImages = settings.mode === 'images';
    const selected = editingImages ? visibleSlots() : [];
    const count = selected.filter(Boolean).length;
    const layout = settings.mode === 'title' || count > 0 ? selected : [automaticTile()];
    const grid = count > 1;
    preview.classList.toggle('portfolio-cover-grid', grid);
    preview.style.setProperty('--cover-color', settings.color);
    title.hidden = layout.some(Boolean);
    const project = form.elements.projectId.selectedOptions[0];
    title.textContent = form.elements.title.value.trim() || (project?.value ? project.text : '') || '포트폴리오 제목';
    for (const [index, tile] of tiles.entries()) {
      const slot = layout[index];
      tile.hidden = !grid && !slot;
      const editable = Boolean(editingImages && selected[index]);
      tile.toggleAttribute('data-crop-draggable', editable);
      tile.toggleAttribute('data-crop-active', editable && index === active);
      const img = tile.querySelector('img');
      img.hidden = !slot;
      if (!slot) { img.removeAttribute('src'); continue; }
      const source = imageFor(slot.id).src;
      if (img.getAttribute('src') !== source) img.src = source;
      img.style.setProperty('--cover-x', slot.x + '%');
      img.style.setProperty('--cover-y', slot.y + '%');
      img.style.setProperty('--cover-zoom', slot.zoom);
    }
    crop.hidden = !editingImages;
    const slot = selected[active];
    buttons.forEach((button, index) => button.setAttribute('aria-pressed', String(index === active)));
    imagePicker.value = slot?.id || '';
    adjustments.hidden = !slot;
    if (slot) for (const range of ranges) range.value = slot[range.dataset.coverValue];
    form.elements.cover.value = JSON.stringify({ ...settings, slots: visibleSlots() });
  }

  function updateImages() {
    const removed = new Set([...form.querySelectorAll('input[name="removeFiles"]:checked')].map(input => input.value));
    images = [...savedImages.filter(image => !removed.has(image.id)), ...added];
    imagePicker.replaceChildren(new Option(images.length ? '이 칸 비우기' : '작업물에 이미지를 먼저 추가하세요', ''),
      ...images.map(image => new Option(image.name, image.id)));
    imagePicker.disabled = !images.length;
    render();
  }

  upload.addEventListener('change', () => {
    for (const image of added) URL.revokeObjectURL(image.src);
    settings.slots = settings.slots.map(slot => slot?.id.startsWith('upload:') ? null : slot);
    added = [...upload.files].map((file, index) => ({ id: 'upload:' + index, src: URL.createObjectURL(file), name: file.name }));
    updateImages();
  });
  form.addEventListener('change', event => {
    if (event.target.name === 'removeFiles') updateImages();
    if (event.target.name === 'thumbnail' && event.target.checked) {
      if (settings.mode !== 'auto') {
        settings.mode = 'images';
        mode.value = 'images';
        const image = automaticTile();
        if (settings.slots[active]?.id !== image?.id) settings.slots[active] = image;
      }
      render();
    }
    if (event.target.name === 'projectId') render();
  });
  form.elements.title.addEventListener('input', render);
  mode.addEventListener('change', () => {
    settings.mode = mode.value;
    if (settings.mode === 'images' && !visibleSlots().some(Boolean)) settings.slots[0] = automaticTile();
    render();
  });
  color.addEventListener('input', () => {
    settings.color = color.value;
    render();
  });
  buttons.forEach((button, index) => button.addEventListener('click', () => {
    active = index;
    render();
  }));
  imagePicker.addEventListener('change', () => {
    settings.slots[active] = imagePicker.value ? { id: imagePicker.value, ...positionDefaults } : null;
    render();
  });
  for (const range of ranges) range.addEventListener('input', () => {
    settings.slots[active][range.dataset.coverValue] = Number(range.value);
    render();
  });

  for (const [index, tile] of tiles.entries()) {
    tile.addEventListener('pointerdown', event => {
      if (event.button !== 0 || drag || !tile.hasAttribute('data-crop-draggable')) return;
      active = index;
      const { width, height } = tile.getBoundingClientRect();
      const { naturalWidth, naturalHeight } = tile.querySelector('img');
      if (!naturalWidth || !naturalHeight) { render(); return; }
      const { x, y, zoom } = settings.slots[index];
      const scale = Math.max(width / naturalWidth, height / naturalHeight) * zoom;
      drag = {
        pointerId: event.pointerId, index, x, y, clientX: event.clientX, clientY: event.clientY,
        travelX: Math.max(0, scale * naturalWidth - width),
        travelY: Math.max(0, scale * naturalHeight - height)
      };
      tile.setPointerCapture(event.pointerId);
      render();
    });
    tile.addEventListener('pointermove', event => {
      if (event.pointerId !== drag?.pointerId) return;
      const slot = settings.slots[drag.index];
      if (drag.travelX > 1) slot.x = bound(drag.x - (event.clientX - drag.clientX) * 100 / drag.travelX);
      if (drag.travelY > 1) slot.y = bound(drag.y - (event.clientY - drag.clientY) * 100 / drag.travelY);
      render();
    });
    tile.addEventListener('lostpointercapture', () => { drag = undefined; });
  }

  mode.value = settings.mode;
  color.value = settings.color;
  form.elements.cover.disabled = false;
  updateImages();
  editor.hidden = false;
})();
