const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const toolPaths = [process.env.PROJECT_LOG_TOOL_MODULES || root];
const vizModule = require(require.resolve('@viz-js/viz', { paths: toolPaths }));
const { chromium } = require(require.resolve('playwright', { paths: toolPaths }));
const escape = text => String(text).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

async function main() {
  const metadata = JSON.parse(await fs.readFile(path.join(root, 'docs/schema-metadata.json'), 'utf8'));
  const viz = await vizModule.instance();
  const groups = {
    accounts: ['projectlog_users', 'projectlog_sessions', 'projectlog_user_avatars', 'projectlog_workspaces', 'projectlog_member_epochs'],
    projects: ['projects', 'nodes', 'node_revisions', 'node_files'],
    feedback: ['feedbacks', 'feedback_actions', 'projectlog_ai_usage'],
    activity: ['todos', 'activity_logs', 'alerts', 'projectlog_activity'],
    portfolio: metadata.tables.map(table => table.name).filter(name => name.startsWith('portfolio')),
    service: ['projectlog_suggestions', 'projectlog_guest_suggestions', 'projectlog_updates', 'projectlog_member_settings', 'projectlog_dashboard_settings']
  };
  const titles = { accounts: 'ACCOUNT', projects: 'PROJECT & WORK', feedback: 'AI FEEDBACK & ACTION', activity: 'TODO & ACTIVITY', portfolio: 'PORTFOLIO', service: 'SERVICE SETTINGS' };
  const colors = { accounts: '#17212b', projects: '#007fff', feedback: '#1769aa', activity: '#526579', portfolio: '#34495e', service: '#657180' };
  const desired = {
    projectlog_users: ['uid','username','google_subject','display_name'], projects: ['id','user_id','title','status','progress','started_at','completed_at'],
    nodes: ['id','project_id','parent_node_id','title','type','status','error_status','issue_type','work_date'],
    node_revisions: ['id','node_id','version','content'], node_files: ['id','node_id','revision_id','original_name','file_path'],
    feedbacks: ['id','node_id','mode','content','selected','created_at'], feedback_actions: ['id','feedback_id','node_id','action_content','result','created_at'],
    todos: ['id','user_id','project_id','feedback_id','title','status','due_date'],
    activity_logs: ['id','user_id','project_id','node_id','activity_type','progress','created_at'],
    projectlog_ai_usage: ['id','uid','project_id','node_id','feedback_id','model','input_tokens','output_tokens','estimated_cost'],
    portfolios: ['id','user_id','project_id','title','is_public'], portfolio_files: ['id','portfolio_id','original_name','file_path','is_thumbnail','sort_order'],
    portfolio_analyses: ['id','user_id','portfolio_id','analysis_content'],
    projectlog_workspaces: ['uid','version','storage_version']
  };
  const presentationTables = new Set(['projectlog_users','projects','nodes','node_revisions','node_files','feedbacks','feedback_actions','todos',
    'portfolios','portfolio_files','portfolio_links','portfolio_technologies','portfolio_analyses']);
  const presentationEdges = new Set(['projects:user_id','nodes:project_id','nodes:parent_node_id','node_revisions:node_id','node_files:node_id',
    'feedbacks:node_id','feedback_actions:feedback_id','todos:project_id','portfolios:user_id','portfolios:project_id',
    'portfolio_files:portfolio_id','portfolio_links:portfolio_id','portfolio_technologies:portfolio_id','portfolio_analyses:portfolio_id']);
  const browser = await chromium.launch({ executablePath: process.env.PROJECT_LOG_CHROME || undefined });
  try {
    for (const presentation of [false, true]) {
      const tables = metadata.tables.filter(table => !presentation || presentationTables.has(table.name));
      const names = new Set(tables.map(table => table.name));
      const edges = metadata.relations.filter(edge => names.has(edge.child) && names.has(edge.parent) &&
        (!presentation || presentationEdges.has(edge.child + ':' + edge.columnName)));
      const dot = ['digraph ERD {', 'graph [rankdir=TB, bgcolor="white", pad="0.5", nodesep="0.45", ranksep="0.9", splines=spline, fontname="Arial", label="PROJECT LOG | ' + (presentation ? 'CORE DATA FLOW' : 'DATABASE ERD') + '", labelloc=t, fontsize=28];',
        'node [shape=box, margin=0, color="#dce2e8", fontname="Arial"];', 'edge [color="#a2aab3", arrowsize=0.7, penwidth=1.2, fontname="Arial", fontsize=10];'];
      for (const [group, members] of Object.entries(groups)) {
        const included = tables.filter(table => members.includes(table.name));
        if (!included.length) continue;
        dot.push('subgraph cluster_' + group + ' { label="' + titles[group] + '"; color="#e1e5e9"; style="rounded"; fontcolor="#526579"; margin=20;');
        for (const table of included) {
          const foreignKeys = new Set(metadata.relations.filter(edge => edge.child === table.name).map(edge => edge.columnName));
          const columns = table.columns.filter(column => column.columnKey === 'PRI' || foreignKeys.has(column.name) || (desired[table.name] ? desired[table.name].includes(column.name)
            : ['title','settings','layout','message','version','member_limit','technology','link_type','url','created_at'].includes(column.name)));
          const rows = columns.map(column => {
            const kind = [column.columnKey === 'PRI' ? 'PK' : '', foreignKeys.has(column.name) ? 'FK' : ''].filter(Boolean).join('/');
            const type = column.type.replace(/enum\(.+\)/, 'enum');
            return '<TR><TD ALIGN="LEFT"><FONT COLOR="#007fff">' + (kind || '&#160;') + '</FONT></TD><TD ALIGN="LEFT">' + escape(column.name) + '</TD><TD ALIGN="LEFT"><FONT COLOR="#7a838e">' + escape(type) + '</FONT></TD></TR>';
          });
          const resultLegend = table.name === 'feedback_actions' ? '<TR><TD COLSPAN="3"><FONT COLOR="#1769aa">success | failed | pending</FONT></TD></TR>' : '';
          dot.push('"' + table.name + '" [group="' + group + '", label=<<TABLE BORDER="0" CELLBORDER="0" CELLSPACING="0" CELLPADDING="7" BGCOLOR="#f4f6f8"><TR><TD COLSPAN="3" BGCOLOR="' + colors[group] + '"><FONT COLOR="white"><B>' + table.name + '</B></FONT></TD></TR>' + rows.join('') + resultLegend + '</TABLE>>];');
        }
        dot.push('}');
      }
      for (const edge of edges) {
        const foreignColumn = tables.find(table => table.name === edge.child).columns.find(column => column.name === edge.columnName);
        const table = tables.find(table => table.name === edge.child);
        const onlyOne = table.columns.filter(column => column.columnKey === 'PRI').length === 1 && foreignColumn.columnKey === 'PRI';
        const emphasized = ['nodes:project_id','feedbacks:node_id','feedback_actions:feedback_id'].includes(edge.child + ':' + edge.columnName);
        dot.push('"' + edge.parent + '" -> "' + edge.child + '" [dir=both, arrowtail=tee, arrowhead=' + (onlyOne ? 'tee' : 'crow') +
          ', headlabel="' + (onlyOne ? '0..1' : '0..N') + '", taillabel="' + (foreignColumn.nullable === 'YES' ? '0..1' : '1') + '", tooltip="' + edge.columnName + ' | ON DELETE ' + edge.deleteRule + '"' +
          (emphasized ? ', color="#007fff", penwidth=2.3' : '') + '];');
      }
      dot.push('}');
      const source = dot.join('\n');
      await fs.writeFile(path.join(root, 'docs', (presentation ? 'projectlog_erd_presentation' : 'projectlog_erd') + '.dot'), source);
      const rendered = viz.render(source, { format: 'svg', engine: 'dot' });
      if (rendered.status !== 'success' || rendered.errors.some(error => error.level === 'error')) throw new Error(JSON.stringify(rendered.errors));
      const svg = rendered.output;
      const filename = presentation ? 'projectlog_erd_presentation' : 'projectlog_erd';
      await fs.writeFile(path.join(root, filename + '.svg'), svg);
      await fs.writeFile(path.join(root, 'docs', filename + '.dot'), source);
      const viewBox = /viewBox="([^"]+)"/.exec(svg)[1].split(/\s+/).map(Number);
      const width = presentation ? 3200 : 4800;
      const height = Math.ceil(width * viewBox[3] / viewBox[2]);
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
      await page.setContent('<style>html,body{margin:0;background:white}svg{display:block;width:100vw;height:auto}</style>' + svg);
      await page.screenshot({ path: path.join(root, filename + '.png'), fullPage: true });
      await page.close();
      console.log('Generated', filename, width + 'x' + height, tables.length + ' tables');
    }
  } finally { await browser.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
