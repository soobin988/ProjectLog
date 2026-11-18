# 관계형 데이터 구조와 이전

핵심 업무 데이터는 더 이상 작업공간 JSON으로 읽거나 저장하지 않습니다. 기존 회원 UID와 계정 테이블 이름 `projectlog_users(uid)`는 로그인·Google 계정·기존 자료의 소유권을 유지하기 위해 보존했습니다. 문서의 USERS는 이 실제 테이블을 뜻합니다.

## 현재 구조

| 테이블 | 역할 |
| --- | --- |
| projects | 회원별 프로젝트, 진행률, 기간, 색·아이콘 |
| nodes | 작업 기록, 문제 상태·유형, 같은 프로젝트의 이전 노드 |
| node_revisions | 노드별 증가 버전, 코드·제목·내용의 수정 스냅샷 |
| node_files | 실제 파일의 이름·경로·MIME·크기와 최초 첨부 revision |
| feedbacks | AI 답변 원문, 요청·모드, 채택 여부, 재생성 출처 |
| feedback_actions | 실제 수행 조치와 success / failed / pending 결과의 누적 이력 |
| todos | 일반 할 일과 프로젝트·피드백 연결 할 일 |
| activity_logs | 생성·수정·조치·완료와 프로젝트 진행률 변경 이력 |
| alerts | 개인별 알림과 읽음 상태 |
| projectlog_ai_usage | 기존 요청·토큰 기록 및 프로젝트·노드·피드백 FK, 모델, 비용 기록용 컬럼 |

`projectlog_workspaces`는 사용자별 수정 버전과 저장 형식 버전만 사용하는 메타데이터 테이블입니다. 이전한 DB에는 원본 JSON을 `legacy_records`라는 읽기 전용 보존 컬럼으로 남기지만 앱은 이 컬럼을 사용하지 않습니다. 새 DB에는 이 컬럼이 없습니다.

포트폴리오의 파일·링크·기술·분석은 기존 관계형 테이블을 유지합니다. 표지는 4분할 이미지·확대·위치·배경색 정보가 있으므로 `portfolio_covers`를 유지합니다. `portfolio_contacts`는 이메일과 자유 형식 추가 정보를 한 설정으로 관리하는 1:1 테이블이며, 링크는 `portfolio_links`에 별도로 저장합니다. `portfolio_materials`의 JSON은 기존 세부 카테고리와 자료 분류 설정입니다. 형광펜·밑줄·위젯 배치 등 화면 설정도 JSON을 유지합니다. 기존 미사용 `portfolio_categories` 테이블이 있는 DB에서는 데이터를 삭제하지 않고 보존합니다.

파일 원본은 기존 서버 폴더에 그대로 두며, 메타데이터만 관계형 테이블로 이전합니다. 프로필 이미지는 기존 BLOB 저장 방식을 유지합니다.

## 외래키와 삭제

- 회원 → 프로젝트, 프로젝트 → 노드, 노드 → 수정 이력·파일·피드백, 피드백 → 실제 조치는 CASCADE입니다.
- Portfolio → 파일·링크·기술·분석·설정도 CASCADE입니다.
- 프로젝트 → Todo / Portfolio는 SET NULL입니다. 독립적인 할 일·공유 Portfolio가 원본 프로젝트 삭제 후에도 남아야 하기 때문입니다. 삭제 route는 Portfolio 제목·설명·기술을 먼저 복사해 보존합니다.
- 부모 노드 → 후속 노드는 SET NULL입니다. 후속 작업 기록을 지우지 않습니다. 부모 선택은 같은 프로젝트 안에서만 허용하고 순환을 거부합니다.
- AI 사용 기록은 원본 프로젝트·노드·피드백이 삭제되어도 토큰 기록이 남도록 SET NULL입니다.
- 회원 간 자료 접근은 UID 조건과 요청별 작업공간으로 제한합니다. 저장은 트랜잭션과 작업공간 버전 비교로 충돌을 검출합니다.

## 이전 명령

1. 웹과 데이터를 쓰는 다른 프로세스를 중지합니다. DB와 노드·Portfolio 파일 폴더를 함께 백업합니다.
2. MySQL 8 이상과 Node.js 22 이상에서 환경변수를 설정합니다. `.env`는 자동으로 읽지 않으므로 파일 사용 시 `--env-file`을 지정합니다.
3. DB 초기 생성·수정 권한이 있는 계정으로 실행합니다.

```bash
node --env-file=.env scripts/migrate-records.js --export-schema
node --env-file=.env scripts/verify-relational.js --compare-legacy
node --env-file=.env app.js
```

스크립트는 먼저 `backups/before-relational-<UTC 시각>.sql`을 만듭니다. 백업에는 비밀번호 해시·세션·사용자 자료가 포함되므로 외부에 공개하지 않습니다. `PROJECT_LOG_BACKUPS`로 보관 폴더를 지정할 수 있습니다. `.gitignore`는 기본 백업 폴더를 제외합니다. 이 SQL 백업은 빈 복구 DB에 가져올 때 사용하며, 기존 DB 위에 덮어쓰지 않습니다.

이전은 회원별 트랜잭션으로 처리하고 완료 회원에 `storage_version=1`을 기록합니다. 중단 후 재실행하면 이미 이전한 회원은 건너뛰므로 중복 생성하지 않습니다. 모든 회원이 완료된 후 `records`를 `legacy_records`로 이름만 바꿉니다. DB 또는 원본 JSON을 DROP하지 않습니다. 새 회원은 관계형 테이블에 직접 예시 자료를 생성합니다.

### 자동 이전

- 프로젝트·노드·할 일·AI 답변·현재 실제 조치·채택 여부·알림 읽음 상태
- 코드·GitHub·관련 링크·첨부 메타데이터와 파일 식별자
- 다음 노드 / 이전 피드백 연결과 Portfolio의 원본 프로젝트 연결
- 기존 UUID는 유지합니다. 사용자 사이에 반복되던 짧은 예시 ID는 UID 기반의 결정적인 UUID로 변환하고 내부 연결도 함께 바꿉니다.
- 기존 피드백 URL 식별자는 `public_id`로 보존합니다. 관계형 PK는 노드와 공개 식별자로부터 결정적으로 생성합니다.

### 수동 확인이 필요한 경우

- 이미 누락된 부모 프로젝트·원본 프로젝트 연결, 순환 또는 다른 프로젝트의 부모 노드, 서로 다른 회원 사이의 중복 UUID는 해당 회원의 이전을 중단합니다. 백업과 원본을 확인해 수정한 후 다시 실행합니다.
- 과거 JSON에 없던 수정 이력·이전 조치는 복원할 수 없습니다. 현재 상태를 Revision 1과 현재 조치 한 건으로 이전하고 이후 변경부터 누적합니다.
- 기존 기록에 생성 시각이나 파일 크기가 없으면 생성 시각은 이전 시점 또는 작업 날짜를 사용하고, 알 수 없는 파일 크기는 0으로 보존합니다.
- 기존 AI 사용 기록에 프로젝트·피드백 정보가 없으면 새 FK는 NULL입니다. 비용은 가격을 추정해 만들어 넣지 않고 `estimated_cost=NULL`로 유지합니다.
- JSON 파일만 따로 보관하던 경우에는 새 회원으로 가입한 뒤 수정 전에 `node --env-file=.env scripts/import-workspace.js 10000`으로 가져옵니다. 실제 UID로 바꾸고 파일 폴더 위치도 유지해야 합니다. 이 명령 역시 새 관계형 테이블에 기록합니다.

## 통계와 코드

`services/workspace-store.js`가 테이블 조회·트랜잭션 저장을 맡습니다. 화면에 전달하는 배열은 EJS 호환용 메모리 데이터이며 DB에 JSON으로 다시 저장하지 않습니다. 수정 이력과 조치 이력은 새 행을 추가합니다. 피드백 재생성도 기존 답변을 바꾸지 않고 INSERT합니다.

`services/workspace-statistics.js`는 COUNT, SUM, GROUP BY로 통계를 집계합니다. 각 하위 테이블을 먼저 집계해 JOIN하므로 노드×피드백×조치의 중복 곱셈이 발생하지 않습니다.

- `GET /statistics`: 로그인 사용자의 프로젝트·문제·피드백 통계, 최근 활동, 날짜별 활동, 반복 문제 유형
- `GET /projects/:projectId/statistics`: 해당 프로젝트의 노드·문제·해결·피드백·채택·조치·할 일 수와 진행률 변경 이력
- 채택률 = 채택 피드백 / 전체 피드백, 문제 해결률 = 해결된 문제 노드 / 전체 문제 노드
- 조치 성공률 = 성공 조치 / (성공 + 실패 조치), pending은 분모에서 제외
- 대시보드의 진행 중 프로젝트·남은 문제 수와 완료 리포트 집계도 SQL 통계를 사용합니다.
- 시간은 DB 세션에서 UTC로 저장하고 UI와 날짜별 통계에서 한국 시간으로 표시합니다.

## 검증

테스트는 실제 서비스 DB와 분리한 빈 `projectlog_test_*` DB만 허용합니다. 테스트 실행마다 새 DB를 준비하세요.

```bash
PROJECT_LOG_TEST_MYSQL_URL='mysql://USER:PASSWORD@127.0.0.1:3306/projectlog_test_run' npm test
```

Windows PowerShell에서는 `$env:PROJECT_LOG_TEST_MYSQL_URL='...'` 후 `npm test`를 실행합니다.

회원 2명 생성과 계정 분리, 프로젝트·노드·파일·수정 버전, 피드백 생성·재생성·채택, pending→success 조치 누적, Todo, 후속 노드, SQL 통계, 동시 수정 충돌, Portfolio 연결·분석, 외래키 거부와 CASCADE/SET NULL, 이전 백업·재실행을 검증합니다. OpenAI는 모의 응답으로 대체하므로 API 비용이 발생하지 않습니다. Google 외부 인증과 실제 OpenAI 서비스 응답은 이 DB 통합 테스트 범위에 포함하지 않습니다.

## 최종 스키마와 ERD

`node --env-file=.env scripts/export-schema.js`는 실제 DB의 information_schema와 SHOW CREATE TABLE에서 `sql/schema.sql`, `docs/schema-metadata.json`을 생성합니다. 스키마 SQL은 데이터가 없는 테이블 정의이며 부모부터 정렬됩니다. 실제 운영 데이터는 포함하지 않습니다.

`scripts/generate-erd.cjs`는 이 메타데이터만 읽어 Graphviz로 배치하고 브라우저로 PNG를 출력합니다. 도구 패키지 `@viz-js/viz`, `playwright`가 있는 모듈 경로를 `PROJECT_LOG_TOOL_MODULES`, 사용할 Chrome 경로를 필요하면 `PROJECT_LOG_CHROME`으로 지정합니다. 앱 실행 의존성에는 이 발표용 도구를 추가하지 않았습니다.

- `projectlog_erd.png` / `.svg`: 실제 전체 테이블과 FK
- `projectlog_erd_presentation.png` / `.svg`: 핵심 13개 테이블과 주요 흐름. 읽기 쉽게 보조 FK 선을 생략했으며 컬럼의 FK 표시는 유지합니다.
- 발표의 파란 흐름: Project → Node → AI Feedback → Feedback Action → success / failed / pending
