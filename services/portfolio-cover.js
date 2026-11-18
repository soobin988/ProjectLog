const defaultColor = '#3d526a';

function normalizeCover(settings, files, uploaded = []) {
  const mode = ['title', 'images'].includes(settings?.mode) ? settings.mode : 'auto';
  const color = typeof settings?.color === 'string' && /^#[0-9a-f]{6}$/i.test(settings.color)
    ? settings.color : defaultColor;
  const images = new Set(files.filter(file => file.type === 'image').map(file => file.id));
  const newImages = uploaded.filter(file => file.type === 'image');
  const limit = (value, min, max, fallback) => Number.isFinite(value)
    ? Math.round(Math.max(min, Math.min(max, value)) * 10) / 10 : fallback;
  const slots = Array.from({ length: 4 }, (_, index) => {
    const slot = settings?.slots?.[index];
    if (typeof slot?.id !== 'string') return null;
    const upload = /^upload:([0-9]{1,2})$/.exec(slot.id);
    const id = upload ? newImages[Number(upload[1])]?.id : slot.id;
    if (!images.has(id)) return null;
    return { id, x: limit(slot.x, 0, 100, 50), y: limit(slot.y, 0, 100, 50), zoom: limit(slot.zoom, 1, 5, 1) };
  });
  return { mode, color, slots };
}

function coverFor(item) {
  const { mode, color, slots } = normalizeCover(item.cover, item.files);
  if (mode === 'title') return { color, tiles: [] };
  if (mode === 'images' && slots.some(Boolean)) return { color, tiles: slots };
  const image = item.files.find(file => file.type === 'image' && file.thumbnail) || item.files.find(file => file.type === 'image');
  return { color, tiles: image ? [{ id: image.id, x: 50, y: 50, zoom: 1 }] : [] };
}

module.exports = { normalizeCover, coverFor };
