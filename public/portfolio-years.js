(() => {
  const settings = document.querySelector('[data-portfolio-dates]');
  const toggle = settings.querySelector('input[type="checkbox"]');
  const fields = settings.querySelector('fieldset');
  const currentYear = () => new Date().getFullYear();
  const minYear = 1000;
  const maxYear = 8999;
  const clamp = year => Math.min(maxYear, Math.max(minYear, year));
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const translate = offset => `translateY(${offset}px)`;

  function syncFields() {
    fields.hidden = fields.disabled = !toggle.checked;
    if (toggle.checked) {
      for (const input of fields.querySelectorAll('input')) input.value ||= String(currentYear());
    }
  }

  toggle.addEventListener('change', syncFields);
  syncFields();

  for (const wheel of settings.querySelectorAll('[data-year-wheel]')) {
    const input = wheel.querySelector('input');
    const track = wheel.querySelector('[data-year-track]');
    const rows = track.querySelectorAll('[data-year-offset]');
    let pointer;
    let animation;
    let renderedYear;
    let blockClick = false;
    const selected = () => /^[1-8]\d{3}$/.test(input.value) ? Number(input.value) : currentYear();

    function render(year) {
      if (year === renderedYear) return;
      renderedYear = year;
      for (const row of rows) {
        const value = year + Number(row.dataset.yearOffset);
        row.textContent = value >= minYear && value <= maxYear ? String(value) : '';
      }
    }

    function setYear(year) {
      input.value = String(clamp(year));
      render(selected());
    }

    function resetTrack() {
      animation?.cancel();
      animation = undefined;
      track.style.transform = '';
      delete wheel.dataset.yearMoving;
      render(selected());
    }

    function settle(offset) {
      track.style.transform = '';
      if (!offset || reducedMotion.matches) {
        resetTrack();
        return;
      }
      animation = track.animate([translate(offset), translate(0)].map(transform => ({ transform })), {
        duration: 190,
        easing: 'cubic-bezier(.2, .75, .3, 1)'
      });
      animation.onfinish = resetTrack;
    }

    wheel.addEventListener('pointerdown', event => {
      if (event.button !== 0 || pointer) return;
      blockClick = false;
      resetTrack();
      const height = input.getBoundingClientRect().height;
      pointer = { id: event.pointerId, y: event.clientY, height, year: selected(), moved: false };
      wheel.setPointerCapture(event.pointerId);
    });
    wheel.addEventListener('pointermove', event => {
      if (pointer?.id !== event.pointerId) return;
      const distance = pointer.y - event.clientY;
      if (!pointer.moved && Math.abs(distance) < 6) return;
      pointer.moved = true;
      const steps = distance / pointer.height;
      pointer.nearest = clamp(pointer.year + Math.sign(steps) * Math.round(Math.abs(steps)));
      pointer.offset = (pointer.nearest - clamp(pointer.year + steps)) * pointer.height;
      render(pointer.nearest);
      track.style.transform = translate(pointer.offset);
      wheel.dataset.yearMoving = '';
    });
    wheel.addEventListener('pointerup', event => {
      if (pointer?.id !== event.pointerId) return;
      blockClick = pointer.moved;
      if (pointer.moved) {
        if (pointer.nearest !== pointer.year) setYear(pointer.nearest);
        settle(pointer.offset);
      }
      pointer = undefined;
    });
    const cancelDrag = event => {
      if (pointer?.id !== event.pointerId) return;
      pointer = undefined;
      resetTrack();
    };
    wheel.addEventListener('pointercancel', cancelDrag);
    wheel.addEventListener('lostpointercapture', cancelDrag);
    wheel.addEventListener('click', event => {
      if (event.target === input) return;
      if (blockClick) {
        blockClick = false;
        return;
      }
      const center = input.getBoundingClientRect();
      const offset = Math.round((event.clientY - center.top - center.height / 2) / center.height);
      if (offset) {
        setYear(selected() + offset);
      } else {
        input.focus();
        input.select();
      }
    });

    input.addEventListener('input', resetTrack);
    toggle.addEventListener('change', resetTrack);
    input.addEventListener('keydown', event => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      event.preventDefault();
      resetTrack();
      setYear(selected() + (event.key === 'ArrowUp' ? 1 : -1));
    });
    track.parentElement.hidden = false;
    wheel.dataset.yearReady = '';
    render(selected());
  }

  settings.querySelector('[data-year-hint]').hidden = false;
})();
