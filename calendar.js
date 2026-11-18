const weekdays = '월화수목금토일'.split('');
const asDate = iso => new Date(iso + 'T00:00:00Z');
const isoDate = date => date.toISOString().slice(0, 10);

function addDays(date, amount) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + amount);
  return result;
}

const monday = date => addDays(date, -((date.getUTCDay() + 6) % 7));

function monthStart(date, offset = 0) {
  const result = new Date(date);
  result.setUTCMonth(result.getUTCMonth() + offset, 1);
  return result;
}

function validAnchor(value) {
  return typeof value === 'string' && /^[1-8]\d{3}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(+asDate(value)) && isoDate(asDate(value)) === value;
}

function weekSegments(days, periods) {
  const laneEnds = [];
  return periods.filter(({ start, end }) => start <= days[6] && end >= days[0])
    .map(period => {
      const first = days.findIndex(day => day >= period.start);
      const last = days.findLastIndex(day => day <= period.end);
      let lane = laneEnds.findIndex(end => end < first);
      if (lane < 0) lane = laneEnds.length;
      laneEnds[lane] = last;
      const elapsedDays = days.slice(first, last + 1).filter(day => day <= period.elapsedEnd).length;
      const elapsedPercent = 100 * elapsedDays / (last - first + 1);
      return { ...period, first, last, lane, elapsedPercent, continuesBefore: period.start < days[0], continuesAfter: period.end > days[6] };
    });
}

function buildCalendar({ view, date }, today, projects, activity, todosByDate = {}) {
  const mode = view === 'month' ? 'month' : 'week';
  const anchor = asDate(validAnchor(date) ? date : today);
  const month = monthStart(anchor);
  const first = monday(mode === 'month' ? month : anchor);
  const lastWeek = mode === 'month' ? monday(addDays(monthStart(anchor, 1), -1)) : first;
  const activityDates = Object.groupBy(activity, entry => entry.projectId);
  const periods = projects.flatMap(project => {
    const dates = (activityDates[project.id] || []).map(entry => entry.date).filter(date => date <= today);
    if (project.startedDate) dates.push(project.startedDate);
    dates.sort();
    const start = dates[0] || project.completedDate;
    if (!start) return [];
    const active = project.progress < 100;
    const elapsedEnd = active ? today : project.completedDate || dates.at(-1) || start;
    const deadline = active && validAnchor(project.deadline) ? project.deadline : start;
    const end = [start, elapsedEnd, deadline].sort().at(-1);
    return [{ project, start, end, elapsedEnd }];
  }).sort((a, b) => a.start.localeCompare(b.start) || a.project.name.localeCompare(b.project.name));

  const weeks = [];
  for (let cursor = first; cursor <= lastWeek; cursor = addDays(cursor, 7)) {
    const days = weekdays.map((_, index) => isoDate(addDays(cursor, index)));
    const segments = mode === 'month' ? weekSegments(days, periods) : [];
    const rows = segments.reduce((count, segment) => Math.max(count, segment.lane + 2), 2);
    const todos = mode === 'week' ? days.map(day =>
      Object.entries(Object.groupBy(todosByDate[day] || [], todo => todo.projectId || ''))
        .sort(([left], [right]) => Number(!left) - Number(!right))
        .map(([projectId, items]) => ({ projectId, items }))
    ) : [];
    weeks.push({ days, segments, rows, todos });
  }
  const shift = amount => isoDate(mode === 'month' ? monthStart(anchor, amount) : addDays(anchor, amount * 7));
  return { mode, anchor: isoDate(anchor), month: isoDate(month), weekdays, weeks, previous: shift(-1), next: shift(1) };
}

module.exports = { buildCalendar, validAnchor };
