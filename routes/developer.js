const { Router } = require('express');
const { recordActivity, recordActivitySlots, memberUsage, usageSummary, dailyUsage } = require('../services/member-usage');
const { maxMemberLimit, readMemberLimit, setMemberLimit } = require('../services/membership');
const { findMember, removeMemberData } = require('../services/member-removal');
const { normalizeLayout, saveDashboardDefault } = require('../services/dashboard-default');
const { publishUpdate } = require('../services/updates');

const { pageNumber } = require('../services/notifications');
const router = Router();
const periods = { '7': '최근 7일', '30': '최근 30일', all: '전체 기간' };
const number = new Intl.NumberFormat('ko-KR');
const dateTime = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short'
});
const units = value => number.format(Number(value) || 0);
const periodFor = req => typeof req.query.period === 'string' && Object.hasOwn(periods, req.query.period) ? req.query.period : '30';
const daysFor = period => period === 'all' ? 0 : Number(period);

function duration(value) {
  const seconds = Number(value) || 0;
  return [
    seconds >= 3600 && units(Math.floor(seconds / 3600)) + '시간',
    seconds >= 60 && units(Math.floor(seconds / 60) % 60) + '분',
    (seconds % 60 || seconds < 60) && units(seconds % 60) + '초'
  ].filter(Boolean).join(' ');
}

function missing(res) {
  return res.status(404).render('missing', { page: '', title: '페이지를 찾을 수 없습니다' });
}

router.post('/activity/ping', async (req, res) => {
  if (!req.user) return res.sendStatus(401);
  if (req.body?.slots !== undefined) {
    if (typeof req.body.slots !== 'string' || req.body.slots.length > 4096) return res.sendStatus(422);
    let slots;
    try { slots = JSON.parse(req.body.slots); }
    catch { return res.sendStatus(422); }
    try { await recordActivitySlots(req.user.uid, slots, req.memberGeneration); }
    catch (error) { if (error.status === 422) return res.sendStatus(422); throw error; }
    return res.sendStatus(204);
  }
  const elapsed = Number(req.body?.elapsed);
  if (!Number.isInteger(elapsed) || elapsed < 1000 || elapsed > 20_000) return res.sendStatus(422);
  await recordActivity(req.user.uid, elapsed, req.memberGeneration);
  res.sendStatus(204);
});

router.use('/developer', (req, res, next) => {
  if (!req.user?.developer) return missing(res);
  return next();
});

async function renderMembers(req, res, limitError = '', updateError = '', updateDraft = {}) {
  const period = periodFor(req);
  const query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '';
  const memberPage = pageNumber(req.query.page);
  const [{ members, hasMore }, { totals, memberCount }, memberLimit] = await Promise.all([
    memberUsage(daysFor(period), { query, page: memberPage }), usageSummary(daysFor(period)), readMemberLimit()
  ]);
  const url = page => '/developer?' + new URLSearchParams({ period, q: query, page });
  const pagination = { previous: memberPage > 1 ? url(memberPage - 1) : '', next: hasMore ? url(memberPage + 1) : '' };
  res.render('developer', {
    page: 'developer', title: '개발자 전용', period, periods, query, members, totals, memberCount, pagination,
    memberLimit, maxMemberLimit, limitError, limitSaved: req.query.limit === 'saved',
    updateError, updateDraft, updatePublished: req.query.update === 'published',
    deleted: req.query.deleted === '1', cleanupFailed: req.query.cleanup === 'pending',
    units, duration, lastActive: epoch => epoch ? dateTime.format(new Date(Number(epoch) * 1000)) : '기록 없음'
  });
}

router.get('/developer', (req, res) => renderMembers(req, res));
router.post('/developer/updates', async (req, res) => {
  const text = key => typeof req.body?.[key] === 'string' ? req.body[key].trim() : '';
  const draft = { version: text('version'), title: text('title'), content: text('content') };
  if (!/^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/.test(draft.version) ||
      !draft.title || draft.title.length > 160 || !draft.content || draft.content.length > 12000) {
    return renderMembers(req, res.status(422), '',
      '버전은 1.0.0 형식으로, 제목은 160자까지, 내용은 12,000자까지 입력해 주세요.', draft);
  }
  await publishUpdate(draft);
  res.redirect(303, '/developer?update=published');
});
router.post('/developer/dashboard-default', async (req, res) => {
  if (typeof req.body?.layout !== 'string' || req.body.layout.length > 4096) return res.sendStatus(422);
  let layout;
  try {
    layout = normalizeLayout(JSON.parse(req.body.layout));
  } catch {
    return res.sendStatus(422);
  }
  if (!layout) return res.sendStatus(422);
  await saveDashboardDefault(layout);
  res.sendStatus(204);
});
router.post('/developer/member-limit', async (req, res) => {
  const value = req.body?.limit;
  const limit = Number(value);
  if (typeof value !== 'string' || !/^\d{1,5}$/.test(value) || limit < 1 || limit > maxMemberLimit) {
    return renderMembers(req, res.status(422), '상한은 1~' + units(maxMemberLimit) + '명 사이로 입력해 주세요.');
  }
  await setMemberLimit(limit);
  res.redirect(303, '/developer?limit=saved');
});

const memberPath = '/developer/members/:uid';
router.param('uid', async (req, res, next, uid) => {
  if (!/^[1-9]\d{4}$/.test(uid)) return missing(res);
  req.managedMember = await findMember(Number(uid));
  if (!req.managedMember) return missing(res);
  return next();
});

router.get(memberPath, async (req, res) => {
  const period = periodFor(req);
  const { members: [member] } = await memberUsage(daysFor(period), { uid: Number(req.params.uid) });
  if (!member) return missing(res);
  res.render('developer-member', {
    page: 'developer', title: member.name, member, dayRows: await dailyUsage(member.uid, daysFor(period)),
    period, periods, units, duration,
    reset: req.query.reset === '1', cleanupFailed: req.query.cleanup === 'pending',
    breadcrumbLinks: [{ label: '개발자 전용', href: '/developer?period=' + period }]
  });
});

const removalPath = memberPath + '/:operation';
function removalAction(req, res, next) {
  const operation = req.params.operation;
  if (!['delete-data', 'delete-account'].includes(operation)) return missing(res);
  if (operation === 'delete-account' && req.managedMember.uid === req.user.uid) return res.status(403).send('개발자 계정 자체는 이 화면에서 삭제할 수 없어요.');
  req.deleteAccount = operation === 'delete-account';
  return next();
}

router.get(removalPath, removalAction, (req, res) => {
  res.render('developer-confirm-removal', {
    page: 'developer', title: '삭제 확인', member: req.managedMember,
    deleteAccount: req.deleteAccount, operation: req.params.operation, period: periodFor(req)
  });
});

router.post(removalPath, removalAction, async (req, res) => {
  if (req.body?.confirmed !== 'yes') return res.sendStatus(422);
  const result = await removeMemberData(req.managedMember.uid, req.deleteAccount);
  if (!result) return missing(res);
  const cleanup = result.cleanupFailed ? '&cleanup=pending' : '';
  if (req.deleteAccount) return res.redirect(303, '/developer?deleted=1' + cleanup);
  if (req.managedMember.uid === req.user.uid) return res.redirect(303, '/login?reset=1' + cleanup);
  res.redirect(303, '/developer/members/' + req.managedMember.uid + '?period=' + periodFor(req) + '&reset=1' + cleanup);
});

module.exports = router;
