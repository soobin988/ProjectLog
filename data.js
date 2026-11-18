const project = (id, name, tech, progress, color, summary) => ({ id, name, tech, progress, color, summary });
const node = (id, projectId, date, title, note, status = 'work', action = '', result = '') =>
  ({ id, projectId, date, title, note, status, action, result, feedback: [] });

module.exports = {
  todos: [
    { id: 'sample-todo-review', title: 'Todo App 로그인 흐름 확인', projectId: 'todo', done: false },
    { id: 'sample-todo-db', title: 'AQUABIT DB 연결 테스트 결과 정리', projectId: 'aquabit', done: false },
    { id: 'sample-todo-report', title: 'Cafe Menu CRUD 완료 리포트 확인', projectId: 'cafe', done: true }
  ],
  projects: [
    project('todo', 'Todo App', 'Node.js / Express / MySQL', 65, '#007fff', '할 일을 등록하고 마감일과 완료 상태를 관리하는 웹 앱'),
    project('aquabit', 'AQUABIT', 'Node.js / PixiJS / MySQL', 40, '#087f78', '팀원과 하나의 어항을 꾸미는 픽셀 아쿠아리움'),
    project('cafe', 'Cafe Menu CRUD', 'Express / EJS / MySQL', 100, '#7854bd', '카페 메뉴를 검색하고 등록·수정·삭제하는 웹 앱')
  ],
  nodes: [
    node('schema', 'todo', '2026-11-10', 'DB 설계', 'todos 테이블과 마감일, 완료 상태 필드를 설계했다.'),
    node('crud', 'todo', '2026-11-10', 'CRUD 구현', '목록 조회, 할 일 등록, 완료 토글, 삭제를 연결했다.'),
    node('grant', 'todo', '2026-11-10', 'ERROR 1044 발생', '애플리케이션 계정으로 todo_app에 접근할 때 권한 오류가 발생했다.', 'resolved', '애플리케이션 계정의 todo_app 권한을 수정했다.', '같은 계정으로 접속해 목록 조회에 성공했다.'),
    node('edit', 'todo', '2026-11-11', 'Edit 기능 구현', '할 일 제목과 마감일의 수정 화면을 연결했다.'),
    node('update', 'todo', '2026-11-11', 'UPDATE 오류', '할 일 수정 시 SQL 구문 오류가 발생했다.', 'resolved', 'UPDATE 문의 SET 절을 수정했다.', '수정한 제목과 마감일이 목록에 반영됐다.'),
    node('login', 'todo', '2026-11-14', '로그인 기능 구현', '로그인 화면과 세션 처리 흐름을 연결했다.'),
    node('mysql', 'todo', '2026-11-14', 'MySQL 오류 해결', '연결 설정이 바뀐 뒤 할 일 목록 조회가 실패했다.', 'resolved', '연결 풀 설정의 데이터베이스 이름을 확인해 수정했다.', '서버를 다시 시작한 뒤 목록을 확인했다.'),
    node('db-test', 'aquabit', '2026-11-14', 'DB 연결 테스트', '웹 서버에서 DB 연결을 확인했다. 간헐적인 연결 타임아웃의 재현 조건을 기록 중이다.', 'issue'),
    node('menu-list', 'cafe', '2026-11-12', '메뉴 검색 구현', '메뉴 이름으로 목록을 검색할 수 있도록 GET 파라미터와 조회 쿼리를 연결했다.'),
    node('menu-edit', 'cafe', '2026-11-13', '메뉴 수정 오류', '메뉴 수정 시 컬럼 매핑이 잘못되어 이름이 숫자로 표시됐다.', 'resolved', '폼 필드명과 SQL 파라미터 순서를 맞췄다.', '메뉴 이름과 가격을 바꾼 뒤 목록과 DB 값을 확인했다.')
  ]
};
module.exports.nodes.find(({ id }) => id === 'grant').feedback.push({
  tone: '발전적', text: '웹 서버와 같은 계정으로 연결해 현재 권한을 확인하세요. 권한 수정 후 동일한 목록 요청을 다시 실행해 성공 여부를 기록하세요.'
});
