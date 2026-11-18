window.enableSortableList = (list, { onChange, onCancel = () => {}, touchHandle = '' }) => {
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const scrollParent = list.closest('dialog') || document.scrollingElement;
  let drag;
  let ignoreDragClick = false;
  const cards = () => [...list.children].filter(card => !card.hidden);
  const excluded = 'input, textarea, select, label, [data-remove-file], [data-delete-category]';

  function reorder() {
    const source = drag.card;
    const others = cards().filter(card => card !== source);
    const center = drag.y - drag.offsetY + drag.height / 2;
    const top = list.getBoundingClientRect().top;
    const target = others.find(card => center < top + card.offsetTop + card.offsetHeight / 2);
    const visible = cards();
    if (visible[visible.indexOf(source) + 1] === target) return;
    const before = new Map(others.map(card => [card, card.getBoundingClientRect().top]));
    if (target) target.before(source);
    else list.append(source);
    for (const card of others) {
      for (const animation of card.getAnimations()) animation.cancel();
      const offset = before.get(card) - card.getBoundingClientRect().top;
      if (offset && !reducedMotion.matches) {
        card.animate([{ transform: 'translateY(' + offset + 'px)' }, { transform: 'translateY(0)' }],
          { duration: 160, easing: 'cubic-bezier(.2,.7,.2,1)' });
      }
    }
  }

  function followPointer() {
    if (!drag?.preview) return;
    const bounds = scrollParent.getBoundingClientRect();
    const top = scrollParent === document.scrollingElement ? 0 : Math.max(0, bounds.top);
    const bottom = scrollParent === document.scrollingElement ? innerHeight : Math.min(innerHeight, bounds.bottom);
    const edge = 48;
    const scroll = drag.y < top + edge ? -Math.min(18, (top + edge - drag.y) / 4)
      : drag.y > bottom - edge ? Math.min(18, (drag.y - bottom + edge) / 4) : 0;
    if (scroll) scrollParent.scrollTop += scroll;
    const x = Math.max(4, Math.min(innerWidth - drag.width - 4, drag.x - drag.offsetX));
    drag.preview.style.transform = 'translate3d(' + x + 'px,' + (drag.y - drag.offsetY) + 'px,0)';
    reorder();
    drag.frame = requestAnimationFrame(followPointer);
  }

  function startDrag() {
    const preview = drag.card.cloneNode(true);
    for (const attribute of [...preview.attributes]) {
      if (attribute.name.startsWith('data-')) preview.removeAttribute(attribute.name);
    }
    preview.setAttribute('aria-hidden', 'true');
    preview.inert = true;
    preview.classList.add('sortable-drag-preview');
    preview.style.width = drag.width + 'px';
    preview.style.height = drag.height + 'px';
    for (const input of preview.querySelectorAll('input, button')) {
      input.disabled = true;
      input.removeAttribute('name');
    }
    (list.closest('dialog') || document.body).append(preview);
    drag.preview = preview;
    drag.card.setAttribute('data-sort-dragging', '');
    list.setAttribute('data-sorting', '');
    list.setPointerCapture(drag.id);
    followPointer();
  }

  function finishDrag(cancelled = false) {
    if (!drag) return;
    if (drag.preview && !cancelled) reorder();
    const completed = drag;
    cancelAnimationFrame(completed.frame);
    drag = undefined;
    if (!completed.preview) return;
    if (cancelled) list.append(...completed.original);
    if (list.hasPointerCapture(completed.id)) list.releasePointerCapture(completed.id);
    list.removeAttribute('data-sorting');
    ignoreDragClick = true;
    setTimeout(() => { ignoreDragClick = false; }, 0);
    if (cancelled) onCancel();
    else if ([...list.children].some((card, index) => card !== completed.original[index])) onChange();
    const clear = () => {
      completed.preview.remove();
      completed.card.removeAttribute('data-sort-dragging');
    };
    if (reducedMotion.matches) { clear(); return; }
    const target = completed.card.getBoundingClientRect();
    completed.preview.animate([
      { transform: completed.preview.style.transform },
      { transform: 'translate3d(' + target.left + 'px,' + target.top + 'px,0)' }
    ], { duration: 140, easing: 'ease-out', fill: 'forwards' }).finished.then(clear, clear);
  }

  list.addEventListener('click', event => {
    if (!ignoreDragClick) return;
    ignoreDragClick = false;
    event.preventDefault();
    event.stopPropagation();
  }, true);
  list.addEventListener('dragstart', event => event.preventDefault());
  list.addEventListener('pointerdown', event => {
    if (event.button !== 0 || drag || event.target.closest(excluded)) return;
    if (event.pointerType === 'touch' && touchHandle && !event.target.closest(touchHandle)) return;
    const card = event.target.closest('[data-sort-item]');
    if (!card || card.parentElement !== list) return;
    const bounds = card.getBoundingClientRect();
    drag = { card, id: event.pointerId, x: event.clientX, y: event.clientY,
      startX: event.clientX, startY: event.clientY, offsetX: event.clientX - bounds.left,
      offsetY: event.clientY - bounds.top, width: bounds.width, height: bounds.height,
      original: [...list.children] };
  });
  document.addEventListener('pointermove', event => {
    if (event.pointerId !== drag?.id) return;
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (!drag.preview && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < 6) return;
    event.preventDefault();
    if (!drag.preview) startDrag();
  }, { passive: false });
  document.addEventListener('pointerup', event => {
    if (event.pointerId === drag?.id) finishDrag();
  });
  document.addEventListener('pointercancel', event => {
    if (event.pointerId === drag?.id) finishDrag(true);
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !drag) return;
    event.preventDefault();
    finishDrag(true);
  });
  list.addEventListener('keydown', event => {
    if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key) || event.target.closest(excluded)) return;
    const card = event.target.closest('[data-sort-item]');
    if (!card) return;
    event.preventDefault();
    const visible = cards();
    const step = event.key === 'ArrowUp' ? -1 : 1;
    const target = visible[visible.indexOf(card) + step];
    if (!target) return;
    const focused = document.activeElement;
    if (step < 0) target.before(card);
    else target.after(card);
    focused.focus({ preventScroll: true });
    onChange();
  });
  window.addEventListener('blur', () => finishDrag(true));
};
