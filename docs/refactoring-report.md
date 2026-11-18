# Project Log 관계형 DB 리팩터링 결과

1. **변경한 DB 구조**

   핵심 기록을 회원별 JSON에서 독립 관계형 테이블로 변경했습니다. MySQL2와 기존 Express/EJS 화면을 유지했습니다. 기존 로컬 DB의 회원 2명은 이전과 원본 대조를 완료했습니다. 실제 DB는 보존된 기존 테이블까지 총 31개, 외래키 43개입니다.

2. **삭제·분리·병합한 기존 구조**

   `records.projects`, `records.nodes`, `nodes.revision`, `nodes.feedback`, `feedback.action`, `records.todos`, `readAlerts`의 영구 저장을 분리했습니다. 앱은 `projectlog_workspaces.records`를 읽거나 쓰지 않습니다. 원본 컬럼은 `legacy_records`로 보존하고 외부 SQL 백업도 생성했습니다. 새 DB의 작업공간에는 JSON 기록 컬럼이 없습니다. UI 설정 JSON과 중요한 표지 편집 설정은 유지했습니다. 사용자 데이터 초기화 시 보존 컬럼도 비웁니다.

3. **생성한 테이블**

   `projects`, `nodes`, `node_revisions`, `node_files`, `feedbacks`, `feedback_actions`, `todos`, `activity_logs`, `alerts`의 9개입니다. 기존 계정·Portfolio·사용량 테이블은 재사용했습니다. 회원 기본키는 기존 UID를 보존하기 위해 `projectlog_users.uid`를 유지했습니다.

4. **주요 외래키 관계**

   회원→프로젝트→노드→수정본·파일·피드백→실제 조치는 CASCADE입니다. 노드 부모는 self FK이며 SET NULL입니다. 프로젝트 삭제 시 Todo와 Portfolio 연결은 SET NULL로 보존합니다. 사용량 로그 역시 원본 삭제 시 연결만 해제합니다. 전체 관계와 삭제 정책은 `sql/schema.sql`에 실제 DB 정의로 기록돼 있습니다.

5. **추가한 인덱스**

   프로젝트의 `(user_id,status)`, 노드의 `(project_id,work_date)`·부모·작업일, 수정본의 UNIQUE `(node_id,version)`, 피드백의 UNIQUE `(node_id,public_id)`와 `(selected,node_id)`, 조치의 피드백·노드·결과, Todo의 회원·상태·완료시각·마감일, 활동 로그의 회원·프로젝트·시각, 알림의 UNIQUE `(user_id,alert_key)` 등을 추가했습니다. FK가 요구하는 인덱스도 실제 DB에 생성돼 있습니다.

6. **수정한 Route / Service / Query**

   `db.js`는 회원별 요청 컨텍스트와 버전 비교를 유지하고, SQL 조회·저장은 `services/workspace-store.js`로 분리했습니다. 회원가입·프로젝트·노드·피드백·Todo·알림·회원 삭제·Portfolio 프로젝트 연결을 새 구조에 맞췄습니다. 노드 수정 이력 조회·삭제와 부모 선택, 피드백 채택·조치 누적을 지원합니다. `services/workspace-statistics.js`의 SQL 집계는 대시보드·완료 리포트 및 `/statistics`, `/projects/:id/statistics`에서 사용합니다. 최근 노드와 작업 흐름의 노드는 활동 로그를 이용해 조회합니다.

7. **Migration 방법**

   웹 중지 후 `node --env-file=.env scripts/migrate-records.js --export-schema`를 실행합니다. SQL 백업→테이블 준비→회원별 트랜잭션 이전→원본 보존→FK 확인 순서이며 재실행 시 이전 완료 회원을 건너뜁니다. 기존의 짧은 공통 예시 ID는 UID 기반으로 변환하고 연결도 함께 수정합니다. `scripts/verify-relational.js --compare-legacy`로 원본 내용을 대조합니다. 구형 피드백의 `tone` 배지도 보존·보완합니다. 자세한 복구·수동 확인 범위는 `database-migration.md`에 있습니다.

8. **테스트한 기능**

   실제 격리 MySQL에서 통합 테스트 10개가 통과했습니다. 회원별 격리, Project/Node/Revision/File, 피드백 생성·재생성·채택, pending→success 조치 이력, Todo CRUD, 진행률, 알림 읽음, 부모 노드, SQL 통계, 동시 수정 충돌, Portfolio 연결·분석, 노드·프로젝트·회원 삭제, 마이그레이션 백업·재실행·배지 보완을 확인했습니다. 실제 이전 계정으로 주요 화면 16개를 PC·모바일에서 점검했고 브라우저 JS 오류가 없었습니다. 내보낸 `schema.sql`은 빈 MySQL DB에 다시 가져와 31개 테이블과 43개 FK 생성에 성공했습니다.

9. **남아 있는 문제·검증 범위**

   과거에 저장하지 않았던 수정 이력·조치 시도는 복원할 수 없으며 현재 상태부터 이력을 시작합니다. 기존 사용량의 소속 프로젝트와 비용을 알 수 없는 경우에는 NULL로 남깁니다. 이전부터 남은 미사용 `portfolio_categories`는 삭제하지 않았고 실제 전체 ERD에 포함했습니다. 실제 OpenAI 유료 호출과 Google 외부 인증은 이번 DB 통합 테스트에서 재검증하지 않았습니다. OpenAI 성공 응답은 테스트에서 모의 처리했습니다. AWS 배포는 별도 작업입니다.

10. **생성한 ERD 이미지 경로**

    프로젝트 루트의 `projectlog_erd.png`(4800×2434), `projectlog_erd.svg`, `projectlog_erd_presentation.png`(3200×2797), `projectlog_erd_presentation.svg`입니다. `information_schema`와 SHOW CREATE TABLE에서 생성한 `docs/schema-metadata.json`을 사용했습니다. 전체 ERD는 실제 전체 FK를, 발표용은 핵심 13개 테이블과 Project→Node→Feedback→Action 흐름을 강조합니다. 생성 코드는 `scripts/export-schema.js`, `scripts/generate-erd.cjs`에 있습니다.
