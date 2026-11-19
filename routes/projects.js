const { Router } = require('express');
const { randomUUID } = require('node:crypto');
const { projects, nodes, todos, readAlerts, saveData } = require('../db');
const { pool, ready, portfolioDb } = require('../services/mysql');
const { removeNodeFiles } = require('../services/member-removal');
const portfolioStore = require('../services/portfolio-store');
const { projectEntry } = require('./portfolio');
const { projectStatistics, projectHistory } = require('../services/workspace-statistics');
const { validAnchor } = require('../calendar');

const { defaultColor, validColor, value, seoulDate, setProject, projectUrl, base, projectNodes,
  completedTodos, timelineEntries, countIssues, countResolved, isUnresolvedIssue, feedbackAlertId } = require('./shared');

const router = Router();
router.param('projectId', setProject);

const categories = { development: '개발', drawing: '드로잉' };
const defaultCategory = 'development';
const validCategory = value => typeof value === 'string' && Object.hasOwn(categories, value);
const categoryFor = project => validCategory(project.category) ? project.category : defaultCategory;
const projectIcons = {
  file: '파일', drawing: '그림', workout: '운동', study: '공부', code: '코딩', folder: '폴더'
};
const validIcon = icon => typeof icon === 'string' && Object.hasOwn(projectIcons, icon);
const projectIconFor = project => validIcon(project.icon) ? project.icon : categoryFor(project) === 'drawing' ? 'drawing' : 'file';

function updateProject(project, fields) {
  return saveData(projects.map(item => item.id === project.id ? { ...item, ...fields } : item), nodes);
}

function renderProjects(req, res, { creating = req.query.new === '1', error = '', draft = {} } = {}) {
  const activeCategory = validCategory(req.query.category) ? req.query.category : '';
  const listUrl = activeCategory ? '/projects?category=' + activeCategory : '/projects';
  const newProjectUrl = listUrl + (activeCategory ? '&' : '?') + 'new=1';
  const visibleProjects = activeCategory ? projects.filter(project => categoryFor(project) === activeCategory) : projects;
  res.render('projects', {
    page: 'projects', title: '프로젝트', projects: visibleProjects, creating, error, draft,
    categories, categoryFor, projectIcons, projectIconFor, activeCategory, listUrl, newProjectUrl,
    selectedCategory: draft.category || activeCategory || defaultCategory, cleanupPending: req.query.cleanup === 'pending'
  });
}

router.get('/projects', (req, res) => renderProjects(req, res));
router.get(base + '/strip', (req, res) => {
  res.render('partials/project-node-strip', { project: req.project, records: projectNodes(req.project.id).reverse() });
});

function projectFields(req, project) {
  const category = req.body?.category === undefined ? categoryFor(project || {}) : value(req, 'category');
  return {
    name: value(req, 'name'), summary: value(req, 'summary'), tech: value(req, 'tech'), deadline: value(req, 'deadline'),
    category,
    icon: req.body?.icon === undefined ? projectIconFor({ category, icon: project?.icon }) : value(req, 'icon'),
    color: (value(req, 'color') || defaultColor).toLowerCase()
  };
}

function projectError(draft, start) {
  if (!draft.name) return '프로젝트 이름을 입력하세요.';
  if (!validColor(draft.color)) return '프로젝트 색을 다시 선택하세요.';
  if (!validCategory(draft.category)) return '프로젝트 카테고리를 선택하세요.';
  if (!validIcon(draft.icon)) return '프로젝트 아이콘을 선택하세요.';
  if (!validDeadline(draft.deadline, start)) return '시작일 이후의 마감일을 선택하세요.';
  return '';
}

router.post('/projects', async (req, res) => {
  const draft = projectFields(req);
  const startedDate = seoulDate.format(new Date());
  const error = projectError(draft, startedDate);
  if (error) return renderProjects(req, res.status(422), { creating: true, error, draft });
  const project = { ...draft, id: randomUUID(), progress: 0, startedDate };
  await saveData([...projects, project], nodes);
  res.redirect(`/projects/${project.id}`);
});

function validDeadline(deadline, start) {
  return !deadline || (validAnchor(deadline) && (!start || deadline >= start));
}

function projectStart(project) {
  return [project.startedDate, ...projectNodes(project.id).map(node => node.date)].filter(Boolean).sort()[0];
}

function renderProjectSettings(req, res, draft = req.project, error = '') {
  res.render('project-settings', {
    page: 'projects', title: '프로젝트 수정', draft, error, categories, selectedCategory: categoryFor(draft), projectIcons, projectIconFor,
    projectPath: projectUrl(req)
  });
}

router.get(base + '/edit', (req, res) => renderProjectSettings(req, res));
router.post(base + '/edit', async (req, res) => {
  const draft = projectFields(req, req.project);
  const error = projectError(draft, projectStart(req.project));
  if (error) return renderProjectSettings(req, res.status(422), draft, error);
  await updateProject(req.project, draft);
  res.redirect(303, projectUrl(req));
});

router.post(base + '/delete', async (req, res) => {
  if (pool) await portfolioDb();
  const project = req.project;
  const records = projectNodes(project.id);
  const deletedAlerts = new Set(records.flatMap(node => [
    'issue-' + node.id, ...node.feedback.map((feedback, index) => feedbackAlertId(node, feedback, index))
  ]));
  const nextNodes = nodes.filter(node => node.projectId !== project.id).map(node => {
    if (node.previousFeedback?.projectId !== project.id) return node;
    const { previousFeedback, ...remaining } = node;
    return remaining;
  });
  const nextTodos = todos.map(todo => {
    const remaining = { ...todo };
    if (todo.projectId === project.id) remaining.projectId = '';
    if (todo.feedbackSource?.projectId === project.id) delete remaining.feedbackSource;
    return remaining;
  });
  await saveData(projects.filter(item => item.id !== project.id), nextNodes, nextTodos,
    readAlerts.filter(id => !deletedAlerts.has(id)), {
      generation: req.memberGeneration,
      beforePersist: async connection => {
        // The member lock also serializes Portfolio saves, including newly linked entries.
        const linked = (await portfolioStore.list(req.user.uid, connection)).filter(item => item.projectId === project.id);
        for (const item of linked) {
          const entry = projectEntry(item);
          await portfolioStore.save(req.user.uid, {
            ...item, projectId: '', title: entry.title, description: entry.description, technologies: entry.technologies,
            status: entry.status, startDate: item.startDate || projectStart(project) || '',
            endDate: item.endDate || project.completedDate || (project.progress >= 100 ? records[0]?.date || '' : '')
          }, req.memberGeneration, connection);
        }
      }
    });
  const files = records.flatMap(node => (node.revision?.files || []).map(file => file.id));
  const failed = await removeNodeFiles(pool ? await ready() : null, files);
  if (failed) console.error('Project attachment cleanup incomplete (%d files)', failed);
  res.redirect(303, '/projects' + (failed ? '?cleanup=pending' : ''));
});

const nodeFilters = [
  ['issues', '미해결 문제', isUnresolvedIssue],
  ['feedback', 'AI 피드백', node => node.feedback.length > 0],
  ['artifacts', '작업물 있음', node => {
    const revision = node.revision;
    return Boolean(revision && (revision.github || revision.link || revision.code || revision.files?.length));
  }]
];

function nodeMatches(node, term) {
  const fields = [node.title, node.note, node.action, node.result, node.revision?.github, node.revision?.link,
    ...(node.revision?.files || []).map(file => file.name), ...node.feedback.map(item => item.text)];
  return fields.some(field => typeof field === 'string' && field.normalize().toLowerCase().includes(term));
}

function renderDetail(req, res) {
  const query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 120) : '';
  const requested = [req.query.filter].flat();
  const active = nodeFilters.filter(([key]) => requested.includes(key));
  const searching = Boolean(query || active.length);
  const term = query.normalize().toLowerCase();
  const records = projectNodes(req.project.id).reverse().filter(node =>
    (!term || nodeMatches(node, term)) && active.every(([, , matches]) => matches(node)));
  const completions = searching ? [] : completedTodos().filter(todo => todo.projectId === req.project.id).reverse();
  const entries = timelineEntries(records, completions).sort((a, b) => a.date.localeCompare(b.date));
  const groups = Object.groupBy(entries, entry => entry.date);
  res.render('detail', {
    page: 'projects', title: req.project.name, groups,
    query, nodeFilters, activeFilters: active.map(([key]) => key), searching, resultCount: records.length
  });
}

router.get(base, (req, res) => renderDetail(req, res));

router.post(base + '/category', async (req, res) => {
  const category = value(req, 'category');
  if (!validCategory(category)) {
    return renderProjectSettings(req, res.status(422), req.project, '프로젝트 카테고리를 선택하세요.');
  }
  await updateProject(req.project, { category });
  res.redirect(303, projectUrl(req));
});

router.post(base + '/color', async (req, res) => {
  const color = value(req, 'color');
  if (!validColor(color)) {
    return renderProjectSettings(req, res.status(422), req.project, '프로젝트 색을 다시 선택하세요.');
  }
  await updateProject(req.project, { color: color.toLowerCase() });
  res.redirect(303, projectUrl(req));
});

router.post(base + '/deadline', async (req, res) => {
  const deadline = value(req, 'deadline');
  if (!validDeadline(deadline, projectStart(req.project))) {
    return renderProjectSettings(req, res.status(422), req.project, '시작일 이후의 마감일을 선택하세요.');
  }
  await updateProject(req.project, { deadline });
  res.redirect(303, projectUrl(req));
});

router.post(base + '/progress', async (req, res) => {
  const progress = value(req, 'progress');
  const valid = /^\d{1,3}$/.test(progress) && Number(progress) < 100 && req.project.progress < 100;
  if (valid && Number(progress) !== req.project.progress) {
    await updateProject(req.project, { progress: Number(progress) });
  }
  if (req.get('Accept') === 'application/json') return res.sendStatus(valid ? 204 : 422);
  res.redirect(projectUrl(req));
});

router.post(base + '/complete', async (req, res) => {
  if (req.project.progress < 100) {
    await updateProject(req.project, { progress: 100, completedDate: seoulDate.format(new Date()) });
  }
  res.redirect(projectUrl(req) + '/report');
});

router.get(base + '/statistics', async (req, res) => {
  if (!pool) return res.status(503).json({ error: '통계는 MySQL 모드에서 사용할 수 있어요.' });
  const db = await ready();
  const [statistics] = await projectStatistics(db, req.user.uid, req.project.id);
  res.json({ ...statistics, history: await projectHistory(db, req.user.uid, req.project.id) });
});

router.get(base + '/report', async (req, res) => {
  if (req.project.progress < 100) return res.redirect(projectUrl(req));
  const records = projectNodes(req.project.id);
  const statistics = pool ? (await projectStatistics(await ready(), req.user.uid, req.project.id))[0] : null;
  const issueCount = statistics ? statistics.issueCount : countIssues(records);
  const resolvedCount = statistics ? statistics.resolvedCount : countResolved(records);
  const dates = [...new Set(records.map(node => node.date))].sort();
  res.render('report', {
    page: 'projects', title: '완료 리포트', records, dates, issueCount, resolvedCount,
    feedbackCount: statistics ? statistics.feedbackCount : records.reduce((total, node) => total + node.feedback.length, 0)
  });
});

module.exports = router;
