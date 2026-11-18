(() => {
  const list = document.querySelector('[data-portfolio-edit-files]');
  if (!list) return;
  const form = list.closest('form');
  const status = form.querySelector('[data-edit-files-status]');

  function update() {
    const cards = [...list.children].filter(card => !card.hidden);
    for (const [index, card] of cards.entries()) {
      card.querySelector('input[type="hidden"]').value = index + 1;
      const preview = card.querySelector('[data-select-thumbnail]');
      if (preview) preview.setAttribute('aria-pressed', String(card.querySelector('[name="thumbnail"]').checked));
    }
  }

  for (const card of list.children) {
    const radio = card.querySelector('[name="thumbnail"]');
    const preview = card.querySelector('[data-select-thumbnail]');
    preview?.addEventListener('click', () => {
      radio.checked = true;
      radio.dispatchEvent(new Event('change', { bubbles: true }));
      update();
    });
    card.querySelector('[data-remove-file]').addEventListener('click', () => {
      const removed = card.querySelector('[name="removeFiles"]');
      removed.checked = true;
      card.hidden = true;
      if (radio?.checked) {
        radio.checked = false;
        const next = [...list.querySelectorAll('[name="thumbnail"]')].find(input => !input.closest('[data-edit-file]').hidden);
        if (next) {
          next.checked = true;
          next.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      removed.dispatchEvent(new Event('change', { bubbles: true }));
      update();
      status.textContent = '자료를 삭제 목록에 넣었어요. 저장하면 반영돼요.';
    });
  }
  enableSortableList(list, {
    touchHandle: '.portfolio-file-preview',
    onChange() {
      update();
      status.textContent = '순서를 바꿨어요. 저장하면 반영돼요.';
    },
    onCancel() { status.textContent = '순서 변경을 취소했어요.'; }
  });
  update();
})();
