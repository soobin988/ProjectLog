const { Router } = require('express');
const { randomBytes, randomUUID } = require('node:crypto');
const { projects } = require('../db');
const { validAnchor } = require('../calendar');
const { projectFor, projectNodes, nodeDetailUrl, feedbackEntries, feedbackResults,
  errorStatusFor, errorStatuses, value, seoulDate } = require('./shared');
const store = require('../services/portfolio-store');
const { normalizeCover, coverFor } = require('../services/portfolio-cover');
const { materialState, materialEntries, materialsIn, isGithubUrl } = require('../services/portfolio-materials');
const { uploads, orderedFiles, removeFiles, serveFile } = require('../services/portfolio-files');
const { analyzePortfolio, analysisTags } = require('../services/portfolio-analysis');
const { openAiConfigured } = require('../services/openai-settings');
const { responseErrorMessage } = require('../services/openai-response');
const { publicOrigin } = require('../services/public-origin');

const router = Router();
const publicRouter = Router();
const statuses = { work: '작업 중', complete: '작업 완료' };
const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const itemUrl = id => '/portfolio/' + id;
const owner = req => req.user?.uid;
const displayDate = date => date ? seoulDate.format(new Date(date)) : '';
const fieldError = message => Object.assign(new Error(message), { status: 422 });
const dateError = '시작 연도와 완료 연도를 확인해 주세요. 완료 연도는 시작 연도보다 빠를 수 없어요.';
const linkLabels = { x: 'X', instagram: 'Instagram', website: '웹사이트' };

function missing(res) {
  return res.status(404).render('missing', { page: '', title: '페이지를 찾을 수 없습니다', guestsOnly: true });
}

function projectEntry(item, shared = false) {
  const project = shared ? null : projectFor(item.projectId);
  const records = project ? projectNodes(project.id) : [];
  const tech = item.technologies.length ? item.technologies : String(project?.tech || '').split(/\s+\/\s+|[,·\n]/).map(text => text.trim()).filter(Boolean);
  const start = item.startDate || [project?.startedDate, ...records.map(node => node.date)].filter(Boolean).sort()[0];
  const completed = project?.progress >= 100;
  const end = item.endDate || project?.completedDate || (completed ? records[0]?.date : '');
  const period = [...new Set([yearFor(start), yearFor(end)].filter(Boolean))].join('~');
  return {
    item, project, records, technologies: tech, period, cover: coverFor(item),
    status: item.status || (project ? (completed ? 'complete' : 'work') : ''),
    title: item.title || project?.name || '연결된 프로젝트',
    description: item.description || project?.summary || ''
  };
}

function githubUrl(input) {
  if (!input) return '';
  try {
    const url = new URL(input);
    const repository = /^\/([a-z0-9-]{1,39})\/([a-z0-9_.-]{1,100})\/?$/i.exec(url.pathname);
    if (url.protocol === 'https:' && url.host === 'github.com' && !url.username && !url.password && repository) {
      const name = repository[2].replace(/\.git$/i, '');
      if (name && !/^\.+$/.test(name)) return 'https://github.com/' + repository[1] + '/' + name;
    }
  } catch {
    // Invalid URL receives the same validation message.
  }
  throw fieldError('https://github.com/사용자/저장소 형식의 GitHub 주소를 입력해 주세요.');
}

function externalUrl(input, label) {
  if (!input) return '';
  try {
    const url = new URL(input);
    if (['http:', 'https:'].includes(url.protocol) && url.hostname && !url.username && !url.password && url.href.length <= 255) {
      return url.href;
    }
  } catch {
    // Invalid URLs use the same form error as unsupported URLs.
  }
  throw fieldError(label + ' 링크에 http:// 또는 https://로 시작하는 주소를 입력해 주세요.');
}

const resourceDraft = req => ({ url: value(req, 'materialUrl'), title: value(req, 'materialTitle') });

function addMaterialLink(draft, materials, categoryId = '') {
  const url = externalUrl(draft.url, '자료');
  if (draft.title.length > 100 || (draft.title && !url)) throw fieldError('링크 제목은 주소와 함께 100자까지 입력할 수 있어요.');
  if (!url) return false;
  if (materials.links.length >= 30) throw fieldError('자료 링크는 30개까지 추가할 수 있어요.');
  materials.links = [...materials.links, { id: randomUUID(), categoryId, url, title: draft.title || new URL(url).hostname }];
  return true;
}

function yearFor(date) {
  if (typeof date !== 'string') return '';
  return /^[1-8]\d{3}$/.test(date) || validAnchor(date) ? date.slice(0, 4) : '';
}

function selectedYear(req, key, previous = '') {
  if (value(req, 'dateSettings') === 'checkbox' && value(req, 'datesEnabled') !== '1') return '';
  if (req.body?.[key] === undefined) return previous;
  const input = value(req, key);
  const year = yearFor(input);
  return year && year === yearFor(previous) ? previous : year || input;
}

function fields(req, item) {
  return {
    ...item,
    projectId: value(req, 'projectId'),
    title: value(req, 'title'), description: value(req, 'description'), role: item.role || '',
    status: item.status || '',
    startDate: selectedYear(req, 'startDate', item.startDate),
    endDate: selectedYear(req, 'endDate', item.endDate),
    isPublic: value(req, 'visibility') === 'public', github: value(req, 'github'),
    links: Object.fromEntries(Object.keys(linkLabels).map(key => [
      key, req.body?.[key] === undefined ? item.links?.[key] || '' : value(req, key)
    ])),
    contact: {
      email: req.body?.email === undefined ? item.contact?.email || '' : value(req, 'email'),
      details: req.body?.contactDetails === undefined ? item.contact?.details || '' : value(req, 'contactDetails')
    },
    technologies: [...new Set(value(req, 'technologies').split(/[,·\n]/).map(text => text.trim()).filter(Boolean))]
  };
}

function validate(item) {
  if (item.projectId && !projectFor(item.projectId)) throw fieldError('연결할 프로젝트를 다시 선택해 주세요.');
  if (!item.title && (!item.projectId || item.isPublic)) throw fieldError('포트폴리오 제목을 입력해 주세요.');
  if (item.title.length > 160 || item.description.length > 4000) {
    throw fieldError('제목은 160자, 설명은 4,000자까지 입력할 수 있어요.');
  }
  if (item.technologies.length > 20 || item.technologies.some(tech => tech.length > 80)) {
    throw fieldError('기술은 20개까지 등록할 수 있으며 각 이름은 80자 이하여야 해요.');
  }
  if (item.contact.email.length > 254 || (item.contact.email && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(item.contact.email))) {
    throw fieldError('이메일 주소를 확인해 주세요.');
  }
  if (item.contact.details.length > 2000) throw fieldError('추가 정보는 2,000자까지 입력할 수 있어요.');
  const startYear = yearFor(item.startDate);
  const endYear = yearFor(item.endDate);
  if ((item.startDate && !startYear) || (item.endDate && !endYear) ||
    (startYear && endYear && endYear < startYear)) {
    throw fieldError(dateError);
  }
}

function formFiles(req, previous) {
  const removed = new Set([req.body?.removeFiles].flat());
  const rank = file => Number(value(req, 'order_' + file.id)) || previous.indexOf(file) + 1;
  return previous.filter(file => !removed.has(file.id)).sort((a, b) => rank(a) - rank(b)).map(file => {
    const key = 'caption_' + file.id;
    if (file.type !== 'image' || req.body?.[key] === undefined) return file;
    const caption = value(req, key);
    if (caption.length > 200) throw fieldError('이미지 설명은 200자까지 입력할 수 있어요.');
    return { ...file, caption };
  });
}

function renderForm(res, item, error = '', addedLink = {}) {
  res.render('portfolio-form', {
    page: 'portfolio', title: item.id ? 'Portfolio 수정' : 'New Portfolio', item,
    projects: [...projects], error, linkLabels, addedLink,
    datesEnabled: Boolean(item.startDate || item.endDate || error === dateError),
    startYear: yearFor(item.startDate), endYear: yearFor(item.endDate), cover: normalizeCover(item.cover, item.files)
  });
}

function materialCategoryFor(req, categories) {
  const selected = req.query.materialCategory;
  return selected === '' || categories.some(category => category.id === selected) ? selected : '*';
}

function materialRedirect(req, id, categories, editor = '') {
  const current = materialCategoryFor(req, categories);
  const query = new URLSearchParams();
  if (current !== '*') query.set('materialCategory', current);
  if (editor) query.set(editor, '1');
  return itemUrl(id) + (query.size ? '?' + query : '') + '#portfolio-materials';
}

function newMaterialCategory(materials, rawName) {
  const name = rawName.replace(/\s+/g, ' ').normalize('NFC');
  if (!name || [...name].length > 40 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw fieldError('세부 카테고리 이름을 1~40자로 입력해 주세요.');
  }
  if (['전체', '미분류'].includes(name) || materials.categories.some(category => category.name.toLowerCase() === name.toLowerCase())) {
    throw fieldError('이미 있는 카테고리 이름이에요.');
  }
  if (materials.categories.length >= 30) throw fieldError('세부 카테고리는 30개까지 만들 수 있어요.');
  const category = { id: randomBytes(10).toString('hex'), name };
  materials.categories = [...materials.categories, category];
  return category.id;
}

function renderDetail(req, res, entry, { shared = false, materialError = '', categoryError = '', analysisError = '', addedLink = {} } = {}) {
  const sharePath = '/portfolio/shared/' + entry.item.id;
  const shareHref = !shared && entry.item.isPublic
    ? (publicOrigin ? new URL(sharePath, publicOrigin).href : sharePath)
    : '';
  const materials = materialState(entry.item);
  const categories = shared ? materials.categories.filter(({ id }) =>
    materialsIn(entry.item, id).links.length ||
    entry.item.files.some(file => file.type === 'image' && materials.files[file.id] === id)) : materials.categories;
  const materialCategory = materialCategoryFor(req, categories);
  const visibleMaterials = materialsIn(entry.item, materialCategory);
  res.render('portfolio-detail', {
    page: 'portfolio', title: entry.title, entry, shared, guestsOnly: shared, sharePath, shareHref,
    materials, materialEntries: shared ? [] : materialEntries(entry.item, materials),
    materialCategories: categories, materialCategory, visibleMaterials,
    githubLinks: visibleMaterials.links.filter(link => isGithubUrl(link.url)),
    materialError, categoryError, analysisError, analysisTags, addedLink,
    reopenMaterialEditor: req.query.materialEditor === '1',
    reopenCategoryEditor: req.query.categoryEditor === '1',
    statuses, linkLabels,
    displayDate, errorStatusFor, errorStatuses, nodeDetailUrl, feedbackEntries, feedbackResults,
    openAiEnabled: openAiConfigured()
  });
}

const defaultPage = { heading: 'Portfolio', description: '내 프로젝트와 작업물을 모아 분석하고 관리합니다.' };

async function renderList(req, res, { draft, headerError = '' } = {}) {
  const uid = owner(req);
  const [items, settings] = await Promise.all([store.list(uid), store.pageSettings(uid)]);
  const header = settings || defaultPage;
  res.render('portfolio', {
    page: 'portfolio', title: 'Portfolio', entries: items.map(item => projectEntry(item)),
    header, headerDraft: draft || header, headerError
  });
}

async function ownerOnly(req, res, next, id) {
  if (!uuidPattern.test(id)) return missing(res);
  req.portfolio = await store.get(owner(req), id);
  if (!req.portfolio) return missing(res);
  next();
}

router.param('portfolioId', ownerOnly);
const itemRoute = '/portfolio/:portfolioId';
router.get('/portfolio', (req, res) => renderList(req, res));

router.post('/portfolio/settings', async (req, res) => {
  const draft = { heading: value(req, 'heading'), description: value(req, 'description') };
  if (!draft.heading || draft.heading.length > 80 || draft.description.length > 300) {
    return renderList(req, res.status(422), { draft, headerError: '제목은 1~80자, 설명은 300자까지 입력할 수 있어요.' });
  }
  await store.savePageSettings(owner(req), draft, req.memberGeneration);
  res.redirect(303, '/portfolio');
});

router.get('/portfolio/new', (req, res) => {
  renderForm(res, {
    projectId: typeof req.query.project === 'string' && projectFor(req.query.project) ? req.query.project : '',
    technologies: [], files: []
  });
});

async function saveForm(req, res) {
  const previous = req.portfolio;
  let added = [];
  let draft = previous || { technologies: [], files: [] };
  try {
    added = await uploads(req, res);
    if (previous && req.body?.version !== undefined && value(req, 'version') !== String(previous.version)) {
      throw Object.assign(new Error('Portfolio changed'), { status: 409 });
    }
    draft = fields(req, draft);
    let requestedCover = draft.cover;
    if (req.body?.cover !== undefined) {
      try {
        requestedCover = JSON.parse(value(req, 'cover'));
      } catch {
        throw fieldError('표지 설정을 다시 선택해 주세요.');
      }
    }
    draft.cover = normalizeCover(requestedCover, draft.files);
    validate(draft);
    draft.github = githubUrl(draft.github);
    draft.links = Object.fromEntries(Object.entries(linkLabels).map(([key, label]) => [key, externalUrl(draft.links[key], label)]));
    const retained = formFiles(req, previous?.files || []);
    const files = orderedFiles([...retained, ...added], value(req, 'thumbnail'));
    const item = { ...draft, id: previous?.id || randomUUID(), files, cover: normalizeCover(requestedCover, files, added) };
    item.materials = materialState(item);
    addMaterialLink(resourceDraft(req), item.materials);
    if (!item.projectId && !item.github && !files.length && !item.materials.links.length) {
      throw fieldError('기존 프로젝트, 이미지, 링크, 파일 중 하나 이상을 등록해 주세요.');
    }
    await store.save(owner(req), item, req.memberGeneration);
    await removeFiles((previous?.files || []).filter(file => !files.some(current => current.id === file.id)));
    res.redirect(303, itemUrl(item.id));
  } catch (error) {
    await removeFiles(added);
    if (error.status !== 422) throw error;
    renderForm(res.status(422), draft, error.message, resourceDraft(req));
  }
}

router.post('/portfolio', saveForm);
router.get(itemRoute, (req, res) => renderDetail(req, res, projectEntry(req.portfolio)));
router.get(itemRoute + '/edit', (req, res) => renderForm(res, req.portfolio));
router.post(itemRoute + '/edit', saveForm);
router.post(itemRoute + '/delete', async (req, res) => {
  await store.remove(owner(req), req.portfolio);
  await removeFiles(req.portfolio.files);
  res.redirect(303, '/portfolio');
});

function applyMaterialChanges(req, previous, materials, categoryId) {
  let changes;
  try {
    changes = JSON.parse(value(req, 'materialChanges') || '{}');
  } catch {
    throw fieldError('자료 변경 내용을 다시 확인해 주세요.');
  }
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw fieldError('자료 변경 내용을 다시 확인해 주세요.');
  // Accept the selection submitted by an already-open older editor.
  for (const id of [req.body?.materialId].flat().filter(Boolean)) {
    Object.defineProperty(changes, id, { value: { categoryId }, enumerable: true });
  }
  const entries = new Map(materialEntries(previous, materials).map(entry => [entry.id, entry]));
  const names = new Map();
  for (const [id, edit] of Object.entries(changes)) {
    const entry = entries.get(id);
    if (!entry || !edit || typeof edit !== 'object' || Array.isArray(edit)) throw fieldError('이 포트폴리오의 자료를 선택해 주세요.');
    const group = edit.categoryId ?? entry.categoryId;
    if (group !== '' && !materials.categories.some(category => category.id === group)) {
      throw fieldError('이 포트폴리오의 세부 카테고리를 선택해 주세요.');
    }
    const title = typeof edit.title === 'string' ? edit.title.trim() : entry.title;
    const limit = entry.kind === 'image' || entry.kind === 'file' ? 200 : 100;
    if (!title || title.length > limit || /[\u0000-\u001f\u007f]/.test(title)) {
      throw fieldError('자료 이름은 1~' + limit + '자로 입력해 주세요.');
    }
    if (id === 'github') {
      materials.github = { title, categoryId: group };
    } else if (entry.kind === 'image' || entry.kind === 'file') {
      if (group) materials.files[id] = group;
      else delete materials.files[id];
      names.set(id, title);
    } else {
      materials.links = materials.links.map(link => link.id === id ? { ...link, title, categoryId: group } : link);
    }
  }
  return { names, changed: Object.keys(changes).length > 0 };
}

router.post(itemRoute + '/materials', async (req, res) => {
  const previous = req.portfolio;
  let added = [];
  try {
    added = await uploads(req, res);
    if (value(req, 'version') !== String(previous.version)) {
      throw Object.assign(new Error('Portfolio changed'), { status: 409 });
    }
    const materials = materialState(previous);
    let categoryId = value(req, 'categoryId');
    const name = value(req, 'newCategory');
    const addingCategory = value(req, 'addCategory') === '1';
    if (addingCategory && !name) throw fieldError('새 카테고리 이름을 입력해 주세요.');
    if (name) {
      categoryId = newMaterialCategory(materials, name);
    } else if (categoryId && !materials.categories.some(category => category.id === categoryId)) {
      throw fieldError('이 포트폴리오의 세부 카테고리를 선택해 주세요.');
    }
    const { names, changed } = applyMaterialChanges(req, previous, materials, categoryId);
    const files = orderedFiles([...previous.files.map(file => names.has(file.id) ? { ...file, name: names.get(file.id) } : file), ...added]);
    if (categoryId) for (const file of added) materials.files[file.id] = categoryId;
    const linkAdded = addMaterialLink(resourceDraft(req), materials, categoryId);
    if (!name && !added.length && !linkAdded && !changed) {
      throw fieldError('새 카테고리 이름을 입력하거나 추가·분류할 자료를 선택해 주세요.');
    }
    await store.save(owner(req), { ...previous, files, materials }, req.memberGeneration);
    res.redirect(303, materialRedirect(req, previous.id, materials.categories, addingCategory ? 'materialEditor' : ''));
  } catch (error) {
    await removeFiles(added);
    if (error.status !== 422) throw error;
    renderDetail(req, res.status(422), projectEntry(previous), { materialError: error.message, addedLink: resourceDraft(req) });
  }
});

router.post(itemRoute + '/categories', async (req, res) => {
  const previous = req.portfolio;
  try {
    if (value(req, 'version') !== String(previous.version)) {
      throw Object.assign(new Error('Portfolio changed'), { status: 409 });
    }
    const materials = materialState(previous);
    let order;
    try {
      order = JSON.parse(value(req, 'categoryOrder'));
    } catch {
      throw fieldError('카테고리 순서를 다시 확인해 주세요.');
    }
    const existing = new Map(materials.categories.map(category => [category.id, category]));
    if (!Array.isArray(order) || order.length !== existing.size || new Set(order).size !== existing.size ||
        order.some(id => !existing.has(id))) throw fieldError('카테고리 순서를 다시 확인해 주세요.');
    materials.categories = order.map(id => existing.get(id));
    const removed = value(req, 'deleteCategory');
    if (removed) {
      if (!materials.categories.some(category => category.id === removed)) throw fieldError('삭제할 카테고리를 다시 선택해 주세요.');
      materials.categories = materials.categories.filter(category => category.id !== removed);
      materials.files = Object.fromEntries(Object.entries(materials.files).filter(([, id]) => id !== removed));
      materials.links = materials.links.map(link => link.categoryId === removed ? { ...link, categoryId: '' } : link);
      if (materials.github?.categoryId === removed) materials.github = { ...materials.github, categoryId: '' };
    } else if (value(req, 'addCategory') === '1') {
      newMaterialCategory(materials, value(req, 'newCategory'));
    }
    await store.save(owner(req), { ...previous, materials }, req.memberGeneration);
    if (req.get('Accept') === 'application/json') return res.json({ version: previous.version + 1 });
    res.redirect(303, materialRedirect(req, previous.id, materials.categories, 'categoryEditor'));
  } catch (error) {
    if (req.get('Accept') === 'application/json') {
      if (error.status === 409) {
        const current = await store.get(owner(req), previous.id);
        if (!current) return res.status(404).json({ error: '포트폴리오를 찾을 수 없어요.' });
        return res.status(409).json({ version: current.version, categories: materialState(current).categories });
      }
      if (error.status === 422) return res.status(422).json({ error: error.message });
    }
    if (error.status !== 422) throw error;
    renderDetail(req, res.status(422), projectEntry(previous), { categoryError: error.message });
  }
});

router.get(itemRoute + '/files/:fileId', (req, res, next) => {
  const file = req.portfolio.files.find(file => file.id === req.params.fileId);
  if (!file) return missing(res);
  serveFile(res, file, next);
});

router.post(itemRoute + '/files', async (req, res) => {
  let added = [];
  try {
    added = await uploads(req, res);
    if (!added.length) throw fieldError('추가할 이미지 또는 파일을 선택해 주세요.');
    const item = { ...req.portfolio, files: orderedFiles([...req.portfolio.files, ...added]) };
    await store.save(owner(req), item, req.memberGeneration);
    res.redirect(303, itemUrl(item.id));
  } catch (error) {
    await removeFiles(added);
    if (error.status !== 422) throw error;
    renderForm(res.status(422), req.portfolio, error.message);
  }
});

router.post(itemRoute + '/github', async (req, res) => {
  try {
    const github = githubUrl(value(req, 'github'));
    if (!github && !req.portfolio.projectId && !req.portfolio.files.length && !materialState(req.portfolio).links.length) throw fieldError('등록된 자료가 하나 이상 필요해요.');
    await store.save(owner(req), { ...req.portfolio, github }, req.memberGeneration);
    res.redirect(303, itemUrl(req.portfolio.id));
  } catch (error) {
    if (error.status !== 422) throw error;
    renderForm(res.status(422), req.portfolio, error.message);
  }
});

const pendingAnalyses = new Set();
router.get(itemRoute + '/analysis', async (req, res) => {
  const entry = projectEntry(req.portfolio);
  const recent = await store.analysisHistory(owner(req), entry.item.id);
  res.render('portfolio-analysis', { page: 'portfolio', title: 'AI 분석 결과', entry, recent });
});

async function analyze(req, res) {
  const uid = owner(req);
  const entry = projectEntry(req.portfolio);
  const fail = (status, error) => renderDetail(req, res.status(status), entry, { analysisError: error });
  const scope = value(req, 'analysisCategory') || '*';
  const category = materialState(entry.item).categories.find(item => item.id === scope);
  if (scope !== '*' && !category) return fail(422, '이 포트폴리오의 세부 카테고리를 선택해 주세요.');
  const { files, links } = materialsIn(entry.item, scope);
  const submitted = [req.body?.analysisTags].flat().filter(Boolean);
  const tags = [...new Set(submitted)];
  if (!tags.length || tags.some(tag => typeof tag !== 'string' || !Object.hasOwn(analysisTags, tag))) {
    return fail(422, '분석할 관점 태그를 하나 이상 선택해 주세요.');
  }
  if (scope !== '*' && !files.length && !links.length) return fail(422, '선택한 카테고리에 분석할 자료가 없어요.');
  if (!openAiConfigured()) return fail(503, '서버에 OpenAI API 키를 설정하면 포트폴리오 분석을 사용할 수 있어요.');
  if (pendingAnalyses.has(uid)) return fail(409, '이미 포트폴리오를 분석 중이에요.');
  pendingAnalyses.add(uid);
  try {
    const scopeLabel = category?.name || '전체';
    const scopedEntry = {
      ...entry, materialLinks: links,
      ...(scope !== '*' ? { records: [], description: '', technologies: [] } : {}),
      item: { ...entry.item, files, ...(scope !== '*' ? { github: '' } : {}) }
    };
    let analysis;
    try {
      analysis = await analyzePortfolio([scopedEntry], scopeLabel, tags, uid, req.memberGeneration);
    } catch (error) {
      console.error('Portfolio analysis failed:', error.status || error.code || error.name);
      return fail(502, responseErrorMessage(error));
    }
    const markdownText = text => text.replace(/[\\`*_{}\[\]()#+\-.!<>|]/g, '\\$&');
    const heading = '분석 대상: ' + markdownText(entry.title) + ' · ' + markdownText(scopeLabel);
    const selected = tags.map(tag => analysisTags[tag].label).join(' · ');
    await store.addAnalysis(uid, { id: randomUUID(), portfolioId: entry.item.id, text: heading + '\n\n분석 관점: ' + selected + '\n\n' + analysis }, req.memberGeneration);
    res.redirect(303, itemUrl(entry.item.id) + '/analysis#portfolio-analysis');
  } finally {
    pendingAnalyses.delete(uid);
  }
}

router.post(itemRoute + '/analyze', analyze);

publicRouter.param('sharedId', async (req, res, next, id) => {
  res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
  if (!uuidPattern.test(id)) return missing(res);
  req.sharedPortfolio = await store.shared(id);
  if (!req.sharedPortfolio) return missing(res);
  next();
});
publicRouter.get('/portfolio/shared/:sharedId', (req, res) => renderDetail(req, res, projectEntry(req.sharedPortfolio, true), { shared: true }));
publicRouter.get('/portfolio/shared/:sharedId/files/:fileId', (req, res, next) => {
  const file = req.sharedPortfolio.files.find(file => file.type === 'image' && file.id === req.params.fileId);
  if (!file) return missing(res);
  serveFile(res, file, next);
});

module.exports = { router, publicRouter, projectEntry };
