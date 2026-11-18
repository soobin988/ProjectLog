function materialState(item) {
  const { categories = [], files = {}, links = [], github } = item.materials || {};
  return {
    categories, links,
    ...(item.github && github ? { github } : {}),
    files: Object.fromEntries(item.files.filter(file => Object.hasOwn(files, file.id)).map(file => [file.id, files[file.id]]))
  };
}

const isGithubUrl = url => ['github.com', 'www.github.com'].includes(new URL(url).hostname);

function materialEntries(item, materials = materialState(item)) {
  return [
    ...item.files.map(file => ({ id: file.id, title: file.name, categoryId: materials.files[file.id] || '',
      kind: file.type === 'image' ? 'image' : 'file' })),
    ...(item.github ? [{ id: 'github', title: materials.github?.title || 'GitHub Repository',
      categoryId: materials.github?.categoryId || '', kind: 'github' }] : []),
    ...materials.links.map(link => ({ ...link, kind: isGithubUrl(link.url) ? 'github' : 'link' }))
  ];
}

function materialsIn(item, categoryId = '*') {
  const materials = materialState(item);
  return {
    files: item.files.filter(file => categoryId === '*' || (materials.files[file.id] || '') === categoryId),
    links: [
      ...materials.links,
      ...(item.github ? [{ id: 'github', title: materials.github?.title || 'GitHub Repository',
        categoryId: materials.github?.categoryId || '', url: item.github }] : [])
    ].filter(link => categoryId === '*' || (link.categoryId || '') === categoryId)
  };
}

module.exports = { materialState, materialEntries, materialsIn, isGithubUrl };
