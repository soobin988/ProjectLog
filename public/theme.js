(() => {
  const root = document.documentElement;
  const storageKey = 'project-log-theme:' + root.dataset.themeAccount;
  const feedbackPreferences = [
    { id: 'feedback-font', attribute: 'feedbackFont', values: ['default', 'serif'] },
    { id: 'feedback-font-size', attribute: 'feedbackFontSize', values: ['default', 'small', 'large', 'extra-large'] }
  ];
  let theme = 'light';
  try {
    if (localStorage.getItem(storageKey) === 'dark') theme = 'dark';
  } catch {
    // Keep switching available when browser storage is disabled.
  }
  root.dataset.theme = theme;

  for (const { id, attribute, values } of feedbackPreferences) {
    const key = 'project-log-' + id + ':' + root.dataset.themeAccount;
    const normalize = value => values.includes(value) ? value : 'default';
    try {
      root.dataset[attribute] = normalize(localStorage.getItem(key));
    } catch {
      root.dataset[attribute] = 'default';
    }
    document.addEventListener('DOMContentLoaded', () => {
      const select = document.getElementById(id);
      function apply(value) {
        root.dataset[attribute] = normalize(value);
        if (select) select.value = root.dataset[attribute];
        document.dispatchEvent(new Event('feedback-typography-change'));
      }
      if (select) {
        select.value = root.dataset[attribute];
        select.addEventListener('change', () => {
          apply(select.value);
          try {
            localStorage.setItem(key, select.value);
          } catch {
            // Keep the current page's setting when browser storage is disabled.
          }
        });
      }
      window.addEventListener('storage', event => {
        if (event.key === key) apply(event.newValue);
      });
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    const dialog = document.getElementById('settings-dialog');
    const options = dialog.querySelectorAll('input[name="theme"]');
    const readingOptions = document.querySelector('[data-feedback-reading-options]');
    if (readingOptions) readingOptions.hidden = false;

    function applyTheme(value) {
      root.dataset.theme = value;
      for (const option of options) option.checked = option.value === value;
    }

    applyTheme(theme);
    document.querySelector('[data-open-settings]').addEventListener('click', () => dialog.showModal());
    dialog.addEventListener('change', event => {
      if (event.target.name !== 'theme') return;
      applyTheme(event.target.value);
      try {
        localStorage.setItem(storageKey, event.target.value);
      } catch {
        // The current page still uses the chosen theme.
      }
    });
    window.addEventListener('storage', event => {
      if (event.key === storageKey) applyTheme(event.newValue === 'dark' ? 'dark' : 'light');
    });
  });
})();
