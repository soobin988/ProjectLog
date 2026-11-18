const attachments = document.querySelector('[data-feedback-attachments]');
if (attachments) {
  const items = [...attachments.querySelectorAll('[data-attachment-item]')];
  const options = [...attachments.querySelectorAll('[data-attachment-option]')];
  for (const option of options) {
    option.addEventListener('click', () => {
      for (const button of options) button.setAttribute('aria-pressed', String(button === option));
      for (const item of items) item.hidden = item.dataset.attachmentItem !== option.dataset.attachmentOption;
    });
  }
}

for (const viewer of document.querySelectorAll('[data-image-view]')) {
  const viewport = viewer.querySelector('[data-image-viewport]');
  const image = viewport.querySelector('img');
  const tools = viewer.querySelector('.feedback-image-tools');
  const scaleLabel = tools.querySelector('[data-image-scale]');
  const zoomOut = tools.querySelector('[data-image-zoom="out"]');
  const zoomIn = tools.querySelector('[data-image-zoom="in"]');
  const reset = tools.querySelector('[data-image-zoom="reset"]');
  const scales = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];
  const fitIndex = scales.indexOf(1);
  let index = fitIndex;
  let drag;

  function renderScale(keepCenter = false) {
    if (!image.naturalWidth || !viewport.offsetWidth) return;
    const x = (viewport.scrollLeft + viewport.clientWidth / 2) / viewport.scrollWidth;
    const y = (viewport.scrollTop + viewport.clientHeight / 2) / viewport.scrollHeight;
    const fit = Math.min((viewport.offsetWidth - 2) / image.naturalWidth, (viewport.offsetHeight - 2) / image.naturalHeight);
    image.style.width = image.naturalWidth * fit * scales[index] + 'px';
    viewport.setAttribute('data-zoom-ready', '');
    viewport.toggleAttribute('data-pannable', viewport.scrollWidth > viewport.clientWidth || viewport.scrollHeight > viewport.clientHeight);
    if (keepCenter) {
      viewport.scrollLeft = x * viewport.scrollWidth - viewport.clientWidth / 2;
      viewport.scrollTop = y * viewport.scrollHeight - viewport.clientHeight / 2;
    }
    scaleLabel.value = Math.round(scales[index] * 100) + '%';
    zoomOut.disabled = index === 0;
    zoomIn.disabled = index === scales.length - 1;
    reset.disabled = index === fitIndex;
    tools.hidden = false;
  }

  tools.addEventListener('click', event => {
    const button = event.target.closest('[data-image-zoom]');
    if (!button || button.disabled) return;
    const action = button.dataset.imageZoom;
    index = action === 'reset' ? fitIndex : index + (action === 'in' ? 1 : -1);
    renderScale(action !== 'reset');
  });

  image.draggable = false;
  viewport.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'mouse' || event.button !== 0 || !viewport.hasAttribute('data-pannable')) return;
    event.preventDefault();
    viewport.setPointerCapture(event.pointerId);
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
    viewport.setAttribute('data-panning', '');
  });
  viewport.addEventListener('pointermove', event => {
    if (drag?.id !== event.pointerId) return;
    viewport.scrollLeft = drag.left + drag.x - event.clientX;
    viewport.scrollTop = drag.top + drag.y - event.clientY;
  });
  viewport.addEventListener('lostpointercapture', () => {
    drag = null;
    viewport.removeAttribute('data-panning');
  });

  image.addEventListener('load', () => renderScale());
  new ResizeObserver(() => renderScale()).observe(viewport);
  renderScale();
}
