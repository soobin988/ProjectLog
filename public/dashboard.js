const grid = document.querySelector('[data-dashboard]');
const edit = document.getElementById('dashboard-edit');
const status = document.querySelector('.layout-status');
const picker = document.getElementById('widget-picker');
const pickerOptions = picker.querySelector('.widget-picker-options');
const pickerList = picker.querySelector('[data-widget-list]');
const pickerEmpty = picker.querySelector('[data-widget-picker-empty]');
const dropEmpty = grid.querySelector('[data-widget-empty]');
const cards = [...grid.querySelectorAll(':scope > [data-card]')].sort((a, b) => a.dataset.slot - b.dataset.slot);
const publish = picker.querySelector('[data-layout-publish]');
const builtInVisible = cards.filter(card => !card.hidden).map(card => card.dataset.card);
let sharedDefault = JSON.parse(grid.dataset.defaultLayout || 'null');
const defaultVisible = () => sharedDefault?.visible ?? builtInVisible;
const presets = {
  12: [[0, 2], [2, 2], [4, 8], [0, 4], [4, 4], [8, 4]],
  6: [[0, 3], [3, 3], [0, 6], [0, 3], [3, 3], [3, 3]],
  1: cards.map(() => [0, 1])
};
const account = document.documentElement.dataset.themeAccount || 'local';
const baseStorageKey = 'project-log.dashboard-widgets';
const storageKey = baseStorageKey + '.' + account;
const widgets = new Map();
const preview = document.createElement('div');
preview.className = 'dashboard-snap';
preview.hidden = true;
preview.setAttribute('aria-hidden', 'true');
grid.append(preview);

let saved = {};
let legacy = {};
try {
  const useLegacy = Boolean(publish) || account === 'local';
  const previous = useLegacy ? localStorage.getItem(baseStorageKey) : null;
  saved = JSON.parse(localStorage.getItem(storageKey) ?? previous) || {};
  if (useLegacy) legacy = JSON.parse(localStorage.getItem('project-log.dashboard-positions')) || {};
} catch {
  // Browser storage is optional.
}
let drafts = {};
let visible = new Set(Array.isArray(saved.visible) ? saved.visible : defaultVisible());
let columns;
let step;
let gap;
let layout = {};
let boxes = {};
let drag;
let frame;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const widthOf = span => span * step - gap;
const panelHeight = (id, item) => item.height || widgets.get(id).card.offsetHeight;
const snapDistance = 18;
const intersects = (a, b) => a.column < b.column + b.span && b.column < a.column + a.span &&
  a.y < b.y + b.height + gap && b.y < a.y + a.height + gap;

function nearestSnap(value, candidates, min, max) {
  let nearest;
  let distance = snapDistance;
  for (const candidate of candidates) {
    const difference = Math.abs(value - candidate);
    if (candidate < min || candidate > max || difference > distance) continue;
    if (nearest === undefined || difference < distance) {
      nearest = candidate;
      distance = difference;
    }
  }
  return nearest;
}

function snapTarget(id, start, resizing, left, vertical) {
  const neighbors = Object.entries(boxes).filter(([key]) => key !== id).map(([, box]) => box);
  const height = panelHeight(id, start);
  const top = resizing ? start.y : Math.max(0, vertical);
  const bottom = resizing ? top + clamp(vertical, 104, 1400) : top + height;
  const row = neighbors.filter(box => top <= box.y + box.height + gap + snapDistance &&
    bottom >= box.y - gap - snapDistance);
  const range = resizing ? [start.column + 1, columns] : [0, columns - start.span];
  const horizontalEdges = row.flatMap(box => resizing
    ? [box.column, box.column + box.span]
    : [box.column, box.column + box.span - start.span, box.column + box.span, box.column - start.span]);
  const horizontal = nearestSnap(left, horizontalEdges.map(edge => edge * step), range[0] * step, range[1] * step);
  const edge = clamp(Math.round((horizontal ?? left) / step), ...range);
  const column = resizing ? start.column : edge;
  const span = resizing ? edge - column : start.span;
  const nearby = neighbors.filter(box => column <= box.column + box.span && box.column <= column + span);

  if (resizing) {
    const sameRow = neighbors.filter(box => Math.abs(box.y - top) <= snapDistance);
    const heights = sameRow.map(box => box.height);
    const edges = nearby.flatMap(box => [box.y + box.height - top, box.y - gap - top]);
    const snappedHeight = nearestSnap(bottom - top, heights, 104, 1400) ??
      nearestSnap(bottom - top, edges, 104, 1400);
    return { ...start, span, height: snappedHeight ?? Math.round(bottom - top) };
  }

  const rows = nearby.flatMap(box => [
    box.y, box.y + box.height - height, box.y + box.height + gap, box.y - gap - height
  ]);
  return { ...start, column, y: nearestSnap(top, [0, ...rows], 0, Infinity) ?? Math.round(top) };
}

function position(items, priority) {
  const result = {};
  const entries = Object.entries(items).sort(([, a], [, b]) => a.y - b.y || a.column - b.column);
  if (priority) entries.unshift(entries.splice(entries.findIndex(([id]) => id === priority), 1)[0]);

  for (const [id, item] of entries) {
    const box = { ...item, height: panelHeight(id, item) };
    while (true) {
      const hits = Object.values(result).filter(other => intersects(box, other));
      if (!hits.length) break;
      const right = Math.max(...hits.map(other => other.column + other.span));
      if (priority && right + box.span <= columns) {
        box.column = right;
      } else {
        box.y = Math.min(...hits.map(other => other.y + other.height + gap));
        box.column = item.column;
      }
    }
    result[id] = box;
  }
  return result;
}

function styleWidget(id, item) {
  const { wrapper } = widgets.get(id);
  wrapper.style.width = widthOf(item.span) + 'px';
  wrapper.style.setProperty('--widget-height', item.height ? item.height + 'px' : 'auto');
  wrapper.classList.toggle('dashboard-sized', Boolean(item.height));
}

function applyBoxes(placed) {
  let bottom = 0;
  for (const [id, box] of Object.entries(placed)) {
    const wrapper = widgets.get(id).wrapper;
    wrapper.style.transform = 'translate3d(' + box.column * step + 'px,' + box.y + 'px,0)';
    bottom = Math.max(bottom, box.y + box.height);
  }
  grid.style.height = bottom + (picker.hidden ? 0 : 200) + 'px';
}

function render() {
  for (const [id, { wrapper, option }] of widgets) {
    const placed = Boolean(layout[id]);
    wrapper.hidden = !placed;
    option.hidden = placed;
  }
  pickerEmpty.hidden = cards.some(card => !layout[card.dataset.card]);
  dropEmpty.hidden = picker.hidden || Object.keys(layout).length > 0;
  for (const [id, item] of Object.entries(layout)) styleWidget(id, item);
  boxes = position(layout);
  applyBoxes(boxes);
}

function presetFor(id) {
  const [column, span] = presets[columns][widgets.get(id).index];
  return { column, span, y: 0 };
}

function valid(item) {
  return item && [item.column, item.span, item.y].every(Number.isFinite) &&
    Number.isInteger(item.column) && Number.isInteger(item.span) &&
    item.column >= 0 && item.span >= 1 && item.column + item.span <= columns && item.y >= 0 &&
    (item.height === undefined || Number.isFinite(item.height) && item.height >= 104 && item.height <= 1400);
}

function loadLayout() {
  const current = drafts[columns] || saved[columns] || {};
  const old = drafts[columns] || saved.visible ? undefined : legacy[columns];
  return Object.fromEntries([...widgets.keys()].filter(id => visible.has(id)).map(id => {
    if (valid(current[id])) return [id, current[id]];
    if (valid(sharedDefault?.[columns]?.[id])) return [id, sharedDefault[columns][id]];
    const item = presetFor(id);
    // Keep explicitly resized widgets from the previous row-based layout.
    if (Number.isFinite(old?.[id]?.[4])) {
      item.span = clamp(old[id][2], 1, columns - item.column);
      item.height = clamp(old[id][4], 104, 1400);
    }
    return [id, item];
  }));
}

function updateViewport() {
  if (!grid.clientWidth) return;
  const next = Number(getComputedStyle(grid).getPropertyValue('--layout-columns'));
  gap = parseFloat(getComputedStyle(grid).getPropertyValue('--layout-gap'));
  step = (grid.clientWidth + gap) / next;
  if (next !== columns) {
    endDrag(false);
    columns = next;
    layout = loadLayout();
  }
  if (!drag) render();
}

function previewPlacement(id, target) {
  const positioned = Object.fromEntries(Object.entries(layout).map(([key, item]) => [
    key, { ...item, column: boxes[key].column, y: boxes[key].y }
  ]));
  return position({ ...positioned, [id]: target }, id);
}

function commit(id, item) {
  visible.add(id);
  widgets.get(id).wrapper.hidden = false;
  styleWidget(id, item);
  const placed = previewPlacement(id, item);
  layout = Object.fromEntries(Object.entries(placed).map(([key, box]) => [
    key, { ...(key === id ? item : layout[key]), column: box.column, y: box.y }
  ]));
  drafts[columns] = layout;
  render();
  status.textContent = widgets.get(id).label + ' 배치가 변경되었습니다.';
}

function showPreview() {
  const { id, start, resizing, fromPicker, x, y, offsetX, offsetY, ghost } = drag;
  const rect = grid.getBoundingClientRect();
  if (ghost) {
    ghost.hidden = false;
    ghost.style.transform = 'translate3d(' + (x - offsetX) + 'px,' + (y - offsetY) + 'px,0)';
  }
  if (fromPicker && (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom)) {
    drag.target = undefined;
    preview.hidden = true;
    applyBoxes(boxes);
    return;
  }
  const horizontal = x - rect.left - (resizing ? drag.resizeOffsetX - gap : offsetX);
  const vertical = y - rect.top - offsetY - (resizing ? start.y : 0);
  const target = snapTarget(id, start, resizing, horizontal, vertical);
  drag.target = target;
  const placed = previewPlacement(id, target);
  applyBoxes(fromPicker ? placed : { ...placed, [id]: boxes[id] });
  const box = placed[id];
  preview.style.transform = 'translate3d(' + box.column * step + 'px,' + box.y + 'px,0)';
  preview.style.width = widthOf(box.span) + 'px';
  preview.style.height = box.height + 'px';
  preview.hidden = false;
}

function followPointer() {
  if (!drag) return;
  if (drag.active) {
    if (drag.y > innerHeight - 48) window.scrollBy(0, 12);
    if (drag.y < 48) window.scrollBy(0, -12);
    showPreview();
  }
  drag.frame = requestAnimationFrame(followPointer);
}

function endDrag(apply) {
  if (!drag) return;
  const { id, source, ghost, pointerId, target, frame, fromPicker } = drag;
  drag = undefined;
  cancelAnimationFrame(frame);
  ghost?.remove();
  preview.hidden = true;
  grid.classList.remove('dashboard-dragging');
  picker.classList.remove('widget-picker-dragging');
  source.classList.remove('dashboard-drag-source');
  if (fromPicker) widgets.get(id).wrapper.style.visibility = '';
  if (source.hasPointerCapture(pointerId)) source.releasePointerCapture(pointerId);
  if (apply && target) commit(id, target);
  else render();
}

function bindPointerDrag(source, id, fromPicker = false) {
  const { wrapper, card, resize } = widgets.get(id);
  let dragged = false;
  source.addEventListener('pointerdown', event => {
    if (picker.hidden || event.button !== 0 || drag || event.target.closest('.dashboard-remove')) return;
    dragged = false;
    const bounds = source.getBoundingClientRect();
    const resizing = !fromPicker && event.target.closest('.dashboard-resize') === resize;
    const start = fromPicker ? presetFor(id) : { ...layout[id], column: boxes[id].column, y: boxes[id].y };
    const offsetX = fromPicker ? 16 : event.clientX - bounds.left;
    const offsetY = fromPicker ? 16 : event.clientY - (resizing ? bounds.bottom : bounds.top);
    if (fromPicker) {
      wrapper.style.visibility = 'hidden';
      wrapper.hidden = false;
      styleWidget(id, start);
    }
    let ghost;
    if (!resizing) {
      ghost = card.cloneNode(true);
      ghost.removeAttribute('id');
      ghost.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'));
      ghost.classList.add('dashboard-drag-ghost');
      ghost.inert = true;
      ghost.hidden = true;
      ghost.style.width = widthOf(start.span) + 'px';
      if (start.height) ghost.style.height = start.height + 'px';
      document.body.append(ghost);
    }
    drag = {
      id, source, ghost, resizing, fromPicker, pointerId: event.pointerId, start, offsetX, offsetY,
      resizeOffsetX: event.clientX - bounds.right,
      x: event.clientX, y: event.clientY, initialX: event.clientX, initialY: event.clientY
    };
    source.setPointerCapture(event.pointerId);
    source.classList.add('dashboard-drag-source');
    grid.classList.add('dashboard-dragging');
    followPointer();
  });
  source.addEventListener('pointermove', event => {
    if (drag?.pointerId !== event.pointerId) return;
    drag.x = event.clientX;
    drag.y = event.clientY;
    dragged ||= Math.hypot(drag.x - drag.initialX, drag.y - drag.initialY) > 3;
    if (dragged && !drag.active) {
      drag.active = true;
      picker.classList.add('widget-picker-dragging');
    }
  });
  source.addEventListener('pointerup', event => {
    if (drag?.pointerId !== event.pointerId) return;
    dragged ||= Math.hypot(event.clientX - drag.initialX, event.clientY - drag.initialY) > 3;
    if (dragged) {
      drag.x = event.clientX;
      drag.y = event.clientY;
      showPreview();
    }
    endDrag(dragged);
  });
  const cancelPointer = event => {
    if (drag?.pointerId === event.pointerId) {
      dragged = true;
      endDrag(false);
    }
  };
  source.addEventListener('pointercancel', cancelPointer);
  source.addEventListener('lostpointercapture', cancelPointer);
  if (fromPicker) {
    source.addEventListener('click', event => {
      if ((dragged && event.detail) || picker.hidden || layout[id]) return;
      const bottom = Math.max(0, ...Object.values(boxes).map(box => box.y + box.height + gap));
      commit(id, { ...presetFor(id), y: bottom });
      widgets.get(id).wrapper.focus();
    });
  }
}

for (const [index, card] of cards.entries()) {
  const id = card.dataset.card;
  const label = card.dataset.label;
  const wrapper = document.createElement('div');
  wrapper.className = 'dashboard-card';
  wrapper.setAttribute('role', 'group');
  wrapper.setAttribute('aria-label', label);
  const resize = document.createElement('button');
  resize.type = 'button';
  resize.className = 'button dashboard-resize';
  resize.textContent = '↘';
  resize.setAttribute('aria-label', label + ' 크기 조절');
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'button dashboard-remove';
  remove.textContent = '×';
  remove.setAttribute('aria-label', label + ' 대시보드에서 빼기');
  const option = document.createElement('button');
  option.type = 'button';
  option.className = 'button widget-option';
  const thumbnail = document.createElement('img');
  thumbnail.src = '/widget-previews/' + id + '.png';
  thumbnail.alt = '';
  thumbnail.loading = 'lazy';
  thumbnail.draggable = false;
  const optionLabel = document.createElement('span');
  optionLabel.textContent = label;
  option.append(thumbnail, optionLabel);
  option.setAttribute('aria-label', label + ' 위젯 추가');
  option.dataset.widgetOption = id;
  pickerList.append(option);
  resize.hidden = remove.hidden = true;
  card.hidden = false;
  wrapper.append(card, resize, remove);
  widgets.set(id, { wrapper, card, resize, remove, option, label, index });
  grid.append(wrapper);

  bindPointerDrag(wrapper, id);
  bindPointerDrag(option, id, true);
  remove.addEventListener('click', () => {
    if (drag) return;
    visible.delete(id);
    delete layout[id];
    drafts[columns] = layout;
    render();
    status.textContent = label + ' 위젯을 목록으로 돌려보냈어요.';
    (pickerOptions.open ? option : pickerOptions.querySelector('summary')).focus({ preventScroll: true });
  });
  card.addEventListener('click', event => {
    if (!picker.hidden) event.preventDefault();
  });

  for (const [control, resizing] of [[wrapper, false], [resize, true]]) {
    control.addEventListener('keydown', event => {
      if (picker.hidden || event.target !== control) return;
      if (event.key === 'Escape') endDrag(false);
      const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
      if (!direction || drag) return;
      event.preventDefault();
      const [dx, dy] = direction;
      const { column, y, span, height } = boxes[id];
      const item = { ...layout[id], column, y };
      if (resizing) {
        item.span = clamp(span + dx, 1, columns - column);
        item.height = clamp(height + dy * 32, 104, 1400);
      } else {
        item.column = clamp(column + dx, 0, columns - span);
        item.y = Math.max(0, y + dy * (columns === 1 ? height + gap : 32));
      }
      commit(id, item);
      control.focus();
    });
  }
}

function setEditing(editing) {
  endDrag(false);
  picker.hidden = !editing;
  if (editing) pickerOptions.open = true;
  edit.setAttribute('aria-expanded', String(editing));
  grid.classList.toggle('dashboard-editing', editing);
  for (const { wrapper, resize, remove } of widgets.values()) {
    resize.hidden = remove.hidden = !editing;
    if (editing) wrapper.tabIndex = 0;
    else wrapper.removeAttribute('tabindex');
  }
  updateViewport();
  if (!editing) edit.focus();
}

function cancel() {
  drafts = {};
  visible = new Set(Array.isArray(saved.visible) ? saved.visible : defaultVisible());
  layout = loadLayout();
  status.textContent = '';
  setEditing(false);
}

edit.addEventListener('click', () => {
  if (!picker.hidden) return cancel();
  status.textContent = '';
  setEditing(true);
});
picker.querySelector('[data-layout-reset]').addEventListener('click', () => {
  visible = new Set(defaultVisible());
  drafts = {};
  for (const key of Object.keys(presets)) drafts[key] = {};
  layout = drafts[columns] = loadLayout();
  render();
});
publish?.addEventListener('click', async () => {
  endDrag(false);
  const current = Object.fromEntries(Object.entries(layout).map(([id, item]) => [
    id, { ...item, column: boxes[id].column, y: boxes[id].y }
  ]));
  const snapshot = { ...sharedDefault, ...saved, ...drafts, visible: [...visible], [columns]: current };
  publish.disabled = true;
  try {
    const response = await fetch('/developer/dashboard-default', {
      method: 'POST',
      body: new URLSearchParams({ layout: JSON.stringify(snapshot) })
    });
    if (response.status !== 204) throw new Error('Unable to save the default layout');
    sharedDefault = snapshot;
    status.textContent = '모든 계정의 기본 위젯 배치로 저장했습니다.';
  } catch {
    status.textContent = '공통 기본 배치를 저장하지 못했습니다.';
  } finally {
    publish.disabled = false;
  }
});
picker.querySelector('[data-layout-cancel]').addEventListener('click', cancel);
picker.querySelector('[data-layout-save]').addEventListener('click', () => {
  saved = { ...saved, ...drafts, visible: [...visible] };
  drafts = {};
  try {
    localStorage.setItem(storageKey, JSON.stringify(saved));
    status.textContent = '위젯 구성과 배치를 저장했습니다.';
  } catch {
    status.textContent = '현재 화면에 배치를 적용했습니다. 브라우저에 저장할 수 없습니다.';
  }
  setEditing(false);
});

grid.classList.add('dashboard-positioned');
updateViewport();
const observer = new ResizeObserver(() => {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(updateViewport);
});
for (const { card } of widgets.values()) observer.observe(card);
window.addEventListener('resize', updateViewport);
edit.hidden = false;
