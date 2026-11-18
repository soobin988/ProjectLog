const highlighter = document.querySelector('[data-feedback-highlights]');
const toolbar = highlighter.querySelector('.feedback-highlighter');
const surface = highlighter.querySelector('.feedback-highlight-surface');
const answer = highlighter.querySelector('[data-highlight-text]');
const status = toolbar.querySelector('[role="status"]');
const tools = [...toolbar.querySelectorAll('[data-highlight-mode]')];
const palettes = [...toolbar.querySelectorAll('[data-palette]')];
const swatches = [...toolbar.querySelectorAll('[data-highlight-color], [data-underline-color]')];
const layerPicker = toolbar.querySelector('[data-highlight-layers]');
const layerButtons = [...layerPicker.querySelectorAll('[data-highlight-layer]')];
const deleteButton = toolbar.querySelector('[data-highlight-delete]');
const grips = [...surface.querySelectorAll('[data-highlight-edge]')];
const text = answer.dataset.sourceText;
const segmenter = new Intl.Segmenter();
let visibleOffset = 0;
const runs = [...answer.querySelectorAll('[data-source-start]')].map(element => {
  const start = Number(element.dataset.sourceStart);
  const end = Number(element.dataset.sourceEnd);
  const value = element.textContent;
  const visibleStart = visibleOffset;
  visibleOffset += value.length;
  return { element, start, end, value, visibleStart, visibleEnd: visibleOffset, linear: end - start === value.length };
});
const boundaries = [...new Set(runs.flatMap(run => run.linear
  ? [...segmenter.segment(run.value)].map(segment => run.start + segment.index).concat(run.end)
  : [run.start, run.end]))].sort((a, b) => a - b);
const instructions = {
  idle: '형광펜이나 밑줄을 켜고 답변을 드래그하세요.',
  paint: '칠할 부분을 드래그하세요.',
  underline: '밑줄을 그을 부분을 드래그하세요.',
  edit: '지우거나 범위를 바꿀 표시를 누르세요.'
};

function readRanges(data) {
  return [
    ...data.highlights.map(range => ({ ...range, kind: 'highlight', color: range.color || 'yellow' })),
    ...data.underlines.map(range => ({ ...range, kind: 'underline', color: range.color || 'black' }))
  ];
}

let ranges = readRanges(JSON.parse(highlighter.dataset.ranges));
let mode = 'idle';
const colors = { highlight: 'yellow', underline: 'black' };
let active;
let choices = [];
let drag;
let pending = false;

function positionGrips() {
  const selected = [...answer.querySelectorAll('[data-highlight-selected]')];
  if (!selected.length) return;
  const bounds = surface.getBoundingClientRect();
  const range = document.createRange();
  range.setStartBefore(selected[0]);
  range.setEndAfter(selected.at(-1));
  const rects = [...range.getClientRects()].filter(rect => rect.width > 0);
  if (!rects.length) return;
  for (const grip of grips) {
    const first = grip.dataset.highlightEdge === 'start';
    const rect = first ? rects[0] : rects.at(-1);
    grip.style.left = (first ? rect.left : rect.right) - bounds.left - surface.clientLeft + 'px';
    grip.style.top = rect.top + rect.height / 2 - bounds.top - surface.clientTop + 'px';
  }
}

function render(list = ranges, selected = active) {
  function annotate(part, highlight, underline) {
    if (!highlight && !underline) {
      return document.createTextNode(part);
    }
    const mark = document.createElement(highlight ? 'mark' : 'span');
    mark.className = 'feedback-annotation';
    if (highlight) {
      mark.classList.add('feedback-highlight');
      mark.dataset.color = highlight.color;
      mark.dataset.highlightStart = highlight.start;
    }
    if (underline) {
      mark.classList.add('feedback-underline');
      mark.dataset.underlineColor = underline.color;
      mark.dataset.underlineStart = underline.start;
    }
    mark.toggleAttribute('data-highlight-selected', Boolean(selected && (highlight === selected || underline === selected)));
    mark.textContent = part;
    return mark;
  }
  for (const run of runs) {
    const overlapping = list.filter(range => range.start < run.end && range.end > run.start);
    if (!overlapping.length) {
      run.element.textContent = run.value;
      continue;
    }
    if (!run.linear) {
      run.element.replaceChildren(annotate(run.value, overlapping.find(range => range.kind === 'highlight'),
        overlapping.find(range => range.kind === 'underline')));
      continue;
    }
    const breaks = [...new Set([run.start, run.end, ...overlapping.flatMap(range =>
      [Math.max(run.start, range.start), Math.min(run.end, range.end)])])].sort((a, b) => a - b);
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < breaks.length - 1; index++) {
      const start = breaks[index];
      const part = run.value.slice(start - run.start, breaks[index + 1] - run.start);
      const activeRanges = overlapping.filter(range => range.start <= start && range.end > start);
      fragment.append(annotate(part, activeRanges.find(range => range.kind === 'highlight'),
        activeRanges.find(range => range.kind === 'underline')));
    }
    run.element.replaceChildren(fragment);
  }
  deleteButton.hidden = !selected;
  layerPicker.hidden = choices.length < 2;
  for (const button of layerButtons) button.setAttribute('aria-pressed', String(selected?.kind === button.dataset.highlightLayer));
  for (const grip of grips) grip.hidden = !selected;
  if (selected) positionGrips();
}

function setMode(nextMode) {
  if (pending || drag) return;
  mode = nextMode;
  active = null;
  choices = [];
  highlighter.dataset.mode = mode;
  for (const tool of tools) tool.setAttribute('aria-pressed', String(tool.dataset.highlightMode === mode));
  const visiblePalette = mode === 'edit' ? null : (mode === 'underline' ? 'underline' : 'highlight');
  for (const palette of palettes) palette.hidden = palette.dataset.palette !== visiblePalette;
  for (const swatch of swatches) {
    const selected = swatch.dataset.highlightColor === colors.highlight || swatch.dataset.underlineColor === colors.underline;
    swatch.setAttribute('aria-pressed', String(selected));
  }
  status.textContent = instructions[mode];
  window.getSelection()?.removeAllRanges();
  render();
}

function offsetAt(node, offsetInNode, edge) {
  if (!node || !answer.contains(node)) return null;
  const prefix = document.createRange();
  prefix.selectNodeContents(answer);
  prefix.setEnd(node, offsetInNode);
  const offset = prefix.toString().length;
  const run = edge === 'start'
    ? runs.find(item => offset >= item.visibleStart && offset < item.visibleEnd) || runs.at(-1)
    : runs.find(item => offset > item.visibleStart && offset <= item.visibleEnd) || runs[0];
  if (!run) return null;
  if (offset <= run.visibleStart) return run.start;
  if (offset >= run.visibleEnd) return run.end;
  return run.linear ? run.start + offset - run.visibleStart : edge === 'start' ? run.start : run.end;
}

function finishPaint() {
  if ((mode !== 'paint' && mode !== 'underline') || pending) return;
  const kind = mode === 'underline' ? 'underline' : 'highlight';
  const selection = window.getSelection();
  const range = selection?.rangeCount === 1 ? selection.getRangeAt(0) : null;
  if (!range || range.collapsed || !range.toString().trim()) return;
  const start = offsetAt(range.startContainer, range.startOffset, 'start');
  const end = offsetAt(range.endContainer, range.endOffset, 'end');
  if (start === null || end === null || end <= start) return;
  selection.removeAllRanges();
  save('add', { start, end, kind, color: colors[kind] });
}

async function save(operation, range, original) {
  pending = true;
  try {
    const body = new URLSearchParams({ operation, ...range });
    if (original) {
      body.set('originalStart', original.start);
      body.set('originalEnd', original.end);
    }
    const response = await fetch(highlighter.dataset.feedbackHighlights, { method: 'POST', body });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '표시를 저장하지 못했어요.');
    ranges = readRanges(result);
    active = operation === 'resize'
      ? ranges.find(item => item.kind === range.kind && item.start <= range.start && item.end >= range.end)
      : null;
    choices = [];
    status.textContent = { add: '표시를 저장했어요.', remove: '표시를 삭제했어요.', resize: '표시 범위를 바꿨어요.' }[operation];
  } catch (error) {
    status.textContent = error.message || '표시를 저장하지 못했어요.';
  } finally {
    pending = false;
    render();
  }
}

function adjust(range, edge, offset) {
  if (edge === 'start' && offset < range.end && text.slice(offset, range.end).trim()) {
    return { ...range, start: offset };
  }
  if (edge === 'end' && offset > range.start && text.slice(range.start, offset).trim()) {
    return { ...range, end: offset };
  }
  return range;
}

function preview(draft) {
  const visible = [draft];
  for (const range of ranges) {
    if (range === active) continue;
    if (range.kind !== draft.kind || range.end <= draft.start || range.start >= draft.end) visible.push(range);
    else {
      if (range.start < draft.start) visible.push({ ...range, end: draft.start });
      if (range.end > draft.end) visible.push({ ...range, start: draft.end });
    }
  }
  render(visible.sort((a, b) => a.start - b.start), draft);
}

for (const tool of tools) {
  tool.addEventListener('click', () => setMode(mode === tool.dataset.highlightMode ? 'idle' : tool.dataset.highlightMode));
}
for (const swatch of swatches) {
  swatch.addEventListener('click', () => {
    if (pending || drag) return;
    const kind = swatch.dataset.underlineColor ? 'underline' : 'highlight';
    colors[kind] = swatch.dataset.underlineColor || swatch.dataset.highlightColor;
    setMode(kind === 'underline' ? 'underline' : 'paint');
  });
}

document.addEventListener('pointerup', () => requestAnimationFrame(finishPaint));
document.addEventListener('keyup', event => {
  if (event.key === 'Escape') setMode('idle');
  else if (event.shiftKey && event.key.startsWith('Arrow')) finishPaint();
});
answer.addEventListener('click', event => {
  if (mode !== 'idle' && event.target.closest('a')) event.preventDefault();
  if (mode !== 'edit' || pending) return;
  const mark = event.target.closest('.feedback-annotation');
  choices = mark ? ranges.filter(range => range.start === Number(mark.dataset[range.kind + 'Start'])) : [];
  active = choices.at(-1) || null;
  status.textContent = active ? '양쪽 손잡이로 범위를 조절하거나 삭제하세요.' : instructions.edit;
  render();
});
layerPicker.addEventListener('click', event => {
  const kind = event.target.closest('[data-highlight-layer]')?.dataset.highlightLayer;
  const next = choices.find(range => range.kind === kind);
  if (!next || pending || drag) return;
  active = next;
  render();
});
deleteButton.addEventListener('click', () => {
  if (active && !pending && !drag) save('remove', active);
});

for (const grip of grips) {
  const edge = grip.dataset.highlightEdge;
  grip.addEventListener('pointerdown', event => {
    if (!active || pending || drag || event.button !== 0) return;
    event.preventDefault();
    grip.setPointerCapture(event.pointerId);
    drag = { pointerId: event.pointerId, draft: active };
    surface.toggleAttribute('data-highlight-dragging', true);
  });
  grip.addEventListener('pointermove', event => {
    if (drag?.pointerId !== event.pointerId) return;
    const position = document.caretPositionFromPoint?.(event.clientX, event.clientY);
    const fallback = position ? null : document.caretRangeFromPoint?.(event.clientX, event.clientY);
    const offset = offsetAt(position?.offsetNode || fallback?.startContainer, position?.offset ?? fallback?.startOffset, edge);
    if (offset === null) return;
    const draft = adjust(drag.draft, edge, offset);
    if (draft.start === drag.draft.start && draft.end === drag.draft.end) return;
    drag.draft = draft;
    preview(draft);
  });
  function finishDrag(event, commit) {
    if (drag?.pointerId !== event.pointerId) return;
    const { draft } = drag;
    drag = null;
    surface.removeAttribute('data-highlight-dragging');
    if (commit && (draft.start !== active.start || draft.end !== active.end)) save('resize', draft, active);
    else render();
  }
  grip.addEventListener('pointerup', event => finishDrag(event, true));
  grip.addEventListener('lostpointercapture', event => finishDrag(event, false));
  grip.addEventListener('keydown', event => {
    if (!active || pending || drag || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const offset = event.key === 'ArrowLeft'
      ? boundaries.findLast(point => point < active[edge])
      : boundaries.find(point => point > active[edge]);
    if (offset === undefined) return;
    const draft = adjust(active, edge, offset);
    if (draft !== active) save('resize', draft, active);
  });
}

new ResizeObserver(positionGrips).observe(surface);
document.addEventListener('feedback-typography-change', () => requestAnimationFrame(positionGrips));
document.fonts.addEventListener('loadingdone', positionGrips);
toolbar.hidden = false;
render();
