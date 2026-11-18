(() => {
  const gallery = document.querySelector('[data-portfolio-gallery]');
  const viewer = gallery?.querySelector('[data-portfolio-slideshow]');
  if (!viewer?.showModal) return;

  const slides = [...viewer.querySelectorAll('[data-portfolio-slide]')];
  const count = viewer.querySelector('[data-slide-count]');
  let index = 0;
  let trigger;

  function goTo(next) {
    index = (next + slides.length) % slides.length;
    const image = slides[index].querySelector('img');
    if (!image.hasAttribute('src')) image.src = image.dataset.src;
    slides.forEach((slide, position) => { slide.hidden = position !== index; });
    count.textContent = (index + 1) + ' / ' + slides.length;
  }

  for (const button of viewer.querySelectorAll('[data-slide-step]')) {
    button.addEventListener('click', () => goTo(index + Number(button.dataset.slideStep)));
  }
  gallery.addEventListener('click', event => {
    const link = event.target.closest('[data-slide-open]');
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    trigger = link;
    goTo(Number(link.dataset.slideOpen));
    viewer.showModal();
  });
  viewer.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    goTo(index + (event.key === 'ArrowLeft' ? -1 : 1));
  });
  viewer.addEventListener('close', () => trigger?.focus());
})();
