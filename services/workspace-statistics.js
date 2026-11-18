async function projectStatistics(db, uid, projectId = null) {
  const [rows] = await db.execute(`WITH scoped_projects AS (
    SELECT * FROM projects WHERE user_id=? ${projectId ? 'AND id=?' : ''}
  ) SELECT p.id, p.title, p.progress, p.status,
    COALESCE(n.node_count,0) AS nodeCount, COALESCE(n.issue_count,0) AS issueCount,
    COALESCE(n.resolved_count,0) AS resolvedCount, COALESCE(f.feedback_count,0) AS feedbackCount,
    COALESCE(f.selected_count,0) AS selectedFeedbackCount, COALESCE(a.action_count,0) AS actionCount,
    COALESCE(a.success_count,0) AS actionSuccessCount, COALESCE(a.failed_count,0) AS actionFailedCount,
    COALESCE(a.pending_count,0) AS actionPendingCount, COALESCE(t.todo_count,0) AS todoCount
    FROM scoped_projects p
    LEFT JOIN (SELECT project_id, COUNT(*) AS node_count, SUM(error_status <> '') AS issue_count,
      SUM(error_status='resolved') AS resolved_count FROM nodes JOIN scoped_projects sp ON sp.id=nodes.project_id GROUP BY project_id) n ON n.project_id=p.id
    LEFT JOIN (SELECT n.project_id, COUNT(*) AS feedback_count, SUM(f.selected) AS selected_count
      FROM feedbacks f JOIN nodes n ON n.id=f.node_id JOIN scoped_projects sp ON sp.id=n.project_id GROUP BY n.project_id) f ON f.project_id=p.id
    LEFT JOIN (SELECT n.project_id, COUNT(*) AS action_count, SUM(a.result='success') AS success_count,
      SUM(a.result='failed') AS failed_count, SUM(a.result='pending') AS pending_count
      FROM feedback_actions a JOIN nodes n ON n.id=a.node_id JOIN scoped_projects sp ON sp.id=n.project_id GROUP BY n.project_id) a ON a.project_id=p.id
    LEFT JOIN (SELECT project_id, COUNT(*) AS todo_count FROM todos JOIN scoped_projects sp ON sp.id=todos.project_id GROUP BY project_id) t ON t.project_id=p.id
    ORDER BY p.sort_order`, projectId ? [uid, projectId] : [uid]);
  return rows.map(row => {
    for (const key of Object.keys(row)) if (key.endsWith('Count')) row[key] = Number(row[key]);
    const rate = (part, total) => total ? Math.round(part / total * 1000) / 10 : 0;
    return { ...row, feedbackAdoptionRate: rate(row.selectedFeedbackCount, row.feedbackCount),
      issueResolutionRate: rate(row.resolvedCount, row.issueCount),
      actionSuccessRate: rate(row.actionSuccessCount, row.actionSuccessCount + row.actionFailedCount) };
  });
}

async function dashboardSummary(db, uid) {
  const [[totals]] = await db.execute(`SELECT COUNT(*) AS activeProjectCount FROM projects WHERE user_id=? AND status='work'`, [uid]);
  const [[issues]] = await db.execute(`SELECT COUNT(*) AS remainingIssueCount
    FROM nodes n JOIN projects p ON p.id=n.project_id WHERE p.user_id=? AND n.error_status='issue'`, [uid]);
  return { activeProjectCount: Number(totals.activeProjectCount), remainingIssueCount: Number(issues.remainingIssueCount) };
}

async function userStatistics(db, uid) {
  const projects = await projectStatistics(db, uid);
  const [[totals]] = await db.execute(`SELECT COUNT(*) AS projectCount, COALESCE(SUM(status='complete'),0) AS completedProjectCount,
    COALESCE(SUM(status='work'),0) AS activeProjectCount FROM projects WHERE user_id=?`, [uid]);
  const [[issues]] = await db.execute(`SELECT COUNT(*) AS issueCount, COALESCE(SUM(n.error_status='resolved'),0) AS resolvedCount
    FROM nodes n JOIN projects p ON p.id=n.project_id WHERE p.user_id=? AND n.error_status<>''`, [uid]);
  const [[feedback]] = await db.execute(`SELECT COUNT(*) AS feedbackCount, COALESCE(SUM(f.selected),0) AS selectedFeedbackCount
    FROM feedbacks f JOIN nodes n ON n.id=f.node_id JOIN projects p ON p.id=n.project_id WHERE p.user_id=?`, [uid]);
  const [recentActivity] = await db.execute(`SELECT id, project_id AS projectId, node_id AS nodeId, activity_type AS type,
    description, created_at AS createdAt FROM activity_logs WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 20`, [uid]);
  const [dailyActivity] = await db.execute(`SELECT DATE(DATE_ADD(created_at, INTERVAL 9 HOUR)) AS date, COUNT(*) AS count
    FROM activity_logs WHERE user_id=? GROUP BY date ORDER BY date DESC LIMIT 30`, [uid]);
  const [issueTypes] = await db.execute(`SELECT COALESCE(NULLIF(n.issue_type,''),'미분류') AS type, COUNT(*) AS count,
    SUM(n.error_status='resolved') AS resolvedCount FROM nodes n JOIN projects p ON p.id=n.project_id
    WHERE p.user_id=? AND n.error_status<>'' GROUP BY COALESCE(NULLIF(n.issue_type,''),'미분류') ORDER BY count DESC`, [uid]);
  const counts = Object.fromEntries(Object.entries({ ...totals, ...issues, ...feedback }).map(([key, value]) => [key, Number(value)]));
  return { ...counts, remainingIssueCount: counts.issueCount - counts.resolvedCount,
    projects, recentActivity, dailyActivity, issueTypes: issueTypes.map(row => ({ ...row, resolvedCount: Number(row.resolvedCount) })) };
}

async function projectHistory(db, uid, projectId) {
  const [rows] = await db.execute(`SELECT a.activity_type AS type, a.description, a.progress, a.created_at AS createdAt
    FROM activity_logs a JOIN projects p ON p.id=a.project_id WHERE p.user_id=? AND p.id=?
    ORDER BY a.created_at, a.id`, [uid, projectId]);
  return rows;
}

async function dashboardActivity(db, uid) {
  const [recent] = await db.execute(`SELECT a.node_id AS id FROM activity_logs a JOIN nodes n ON n.id=a.node_id
    WHERE a.user_id=? AND a.activity_type IN ('node_created','node_updated')
    GROUP BY a.node_id ORDER BY MAX(a.created_at) DESC, MAX(a.id) DESC LIMIT 5`, [uid]);
  const [flow] = await db.execute(`SELECT n.id FROM nodes n JOIN projects p ON p.id=n.project_id
    WHERE p.user_id=? AND EXISTS (SELECT 1 FROM activity_logs a WHERE a.node_id=n.id AND a.user_id=?)
    ORDER BY n.work_date DESC,n.sort_order`, [uid, uid]);
  return { recentNodeIds: recent.map(row => row.id), flowNodeIds: flow.map(row => row.id) };
}

module.exports = { projectStatistics, userStatistics, projectHistory, dashboardActivity, dashboardSummary };
