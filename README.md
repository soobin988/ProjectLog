# Project Log

프로젝트 진행 과정, AI 피드백, 실제 조치와 결과를 기록하고 분석하는 프로젝트 관리 서비스입니다. 계정별 데이터는 MySQL에 저장합니다.

## 주요 기능

- Project 생성·수정·삭제와 진행률 관리
- Node 기반 작업 기록, 이전 노드 연결과 문제 유형 기록
- Revision별 코드·설명·첨부 자료 이력
- AI Feedback 생성·재생성·채택과 형광펜·밑줄 표시
- 실제 Action 및 success / failed / pending Result 이력
- 일반·프로젝트 연결 Todo와 완료 타임라인
- Dashboard 위젯 편집, 캘린더와 SQL 집계 통계
- Portfolio 자료 분류·표지 편집·공유와 AI 분석
- 회원별 접근 제어, 개발자 문의·회원 관리·업데이트 공지

## 기술 스택

Node.js 22 이상, Express 5, EJS, MySQL 8 이상, MySQL2를 사용합니다. Google 로그인과 OpenAI는 선택 연동입니다. Ubuntu AWS EC2에 배포할 수 있으며 아래에 실행 안내가 있습니다.

## 실행

Node.js 22 이상이 필요합니다.

```bash
git clone https://github.com/OWNER/REPO.git project-log
cd project-log
npm ci
```

`.env.example`을 `.env`로 복사하고 DB 접속 정보를 바꾸세요. Linux/macOS에서는 `cp .env.example .env`, PowerShell에서는 `Copy-Item .env.example .env`를 사용합니다. 예시 비밀번호는 그대로 사용하지 말고 본인 DB 계정의 값으로 교체합니다. API 키와 OAuth Secret은 서버의 `.env` 또는 운영 환경변수에만 설정합니다.

DB를 아래 순서로 준비한 뒤 실행합니다.

```bash
node --env-file=.env app.js
```

`package.json`의 `npm start`도 같은 `app.js`를 실행합니다. `npm start`는 `.env`를 자동으로 읽지 않으므로 OS·systemd·PM2에서 환경변수를 이미 설정했을 때 사용합니다. 공개 배포 시 `NODE_ENV=production`과 실제 HTTPS `PROJECT_LOG_PUBLIC_ORIGIN`을 사용합니다.

브라우저에서 [http://localhost:3000](http://localhost:3000)을 여세요. `PROJECT_LOG_MYSQL_URL` 설정은 필수입니다. 프로젝트·노드·수정 이력·첨부 메타데이터·AI 피드백·조치·할 일·알림을 독립 MySQL 테이블에 저장합니다. JSON 파일은 기존 데이터 가져오기 입력으로만 사용합니다. 포트는 `PORT`, 수신 주소는 `PROJECT_LOG_HOST`로 지정할 수 있습니다.

## MySQL과 회원 계정

새 DB를 만들 때 관리자 MySQL 콘솔에서 아래 예시를 실행합니다. `change_me`는 본인이 정한 새 비밀번호로 바꾸고, URL에 넣을 때 특수문자는 URL 인코딩합니다.

```sql
CREATE DATABASE projectlog CHARACTER SET utf8mb4;
CREATE USER 'projectlog'@'127.0.0.1' IDENTIFIED BY 'change_me';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES
ON projectlog.* TO 'projectlog'@'127.0.0.1';
```

프로젝트 폴더에서 `mysql -u root -p projectlog`로 접속한 뒤 다음을 실행합니다. 실제 비밀번호는 콘솔의 입력 요청에 응답하며 명령에 직접 넣지 않습니다.

```sql
SOURCE sql/schema.sql;
```

스키마만 포함돼 있으며 실제 회원·프로젝트·업로드 자료는 없습니다. 기존 DB에 `schema.sql`을 덮어 적용하지 말고 아래 Migration 명령을 사용하세요.

1. MySQL 8 이상에 `projectlog` 데이터베이스와 전용 사용자를 만듭니다. 초기 생성·이전에는 해당 DB의 CREATE, ALTER, INDEX, REFERENCES와 SELECT, INSERT, UPDATE, DELETE 권한이 필요합니다.
2. [환경변수 예시](.env.example)를 `.env`로 복사한 뒤 `PROJECT_LOG_MYSQL_URL`과 `PROJECT_LOG_PUBLIC_ORIGIN` 값을 지정합니다. 공개 배포에서는 브라우저에서 사용하는 실제 HTTPS 주소를 입력합니다.
3. 환경변수를 넣은 파일을 사용할 경우 `node --env-file=.env app.js`로 실행합니다. 회원가입 후 왼쪽 **개발자 문의**에 표시된 본인의 UID를 확인합니다.
4. 서버의 `PROJECT_LOG_DEVELOPER_UID`에 확인한 UID를 설정하고 재시작합니다. 로그인 전에도 왼쪽 하단에서 개발자 문의를 보낼 수 있으며, 받은 문의는 지정된 계정으로 로그인했을 때 확인할 수 있습니다. 공개 배포 전 개발자 계정을 먼저 등록하세요.

Google 로그인도 사용하려면 Google Auth Platform에서 **웹 애플리케이션** OAuth 클라이언트를 만들고, 승인된 리디렉션 URI에 `PROJECT_LOG_PUBLIC_ORIGIN` 뒤에 `/auth/google/callback`을 붙인 전체 주소를 등록합니다. 발급된 `GOOGLE_CLIENT_ID`와 `GOOGLE_CLIENT_SECRET`을 서버 환경변수에 추가하고 재시작하면 로그인 버튼이 활성화됩니다. 첫 로그인은 새 계정을 등록합니다. 아이디·비밀번호 계정과 Google 계정은 각각 가입한 계정으로 취급됩니다. [Google OpenID Connect 설정](https://developers.google.com/identity/openid-connect/openid-connect)

새 계정에는 예시 프로젝트와 할 일이 하나씩 만들어집니다. 기존 기록을 옮기려면 새 계정에서 예시를 수정하거나 새 작업을 기록하기 전에 아래 명령을 실행하세요. 예시는 가져온 기록으로 바뀝니다. `10000`은 본인 UID로 바꾸세요. `PROJECT_LOG_DATA_FILE`에 기존 JSON 경로를 지정할 수 있으며, 첨부 폴더는 그 경로 옆에 그대로 둡니다.

```bash
node --env-file=.env scripts/import-workspace.js 10000
```

DB, 작업 노드 첨부 폴더, Portfolio 첨부 폴더를 함께 백업합니다. 기존 `projectlog_workspaces.records` DB를 사용 중이었다면 웹을 중지하고 먼저 [관계형 구조 이전 안내](docs/database-migration.md)를 따라 이전합니다.

지정된 개발자 계정은 왼쪽 **개발자 전용** 메뉴에서 회원을 검색하고 날짜별 활동 시간과 AI 사용량을 볼 수 있습니다. 활동 시간은 로그인 상태에서 화면이 보이는 동안 5초 단위로 집계하고, 1분간 입력이 없으면 집계를 멈춥니다. AI 사용량에는 노드 피드백과 Portfolio 분석 요청 수와 OpenAI가 반환한 토큰 수가 기록됩니다.

같은 화면에서 회원 수 상한을 설정합니다. 기본값은 90,000명이며 상한에 도달하면 새 계정만 생성할 수 없습니다. 회원 상세에서 **유저 데이터 삭제**를 선택하면 활성 서비스의 회원별 기록과 세션을 지우고 계정은 유지합니다. **아이디 삭제**는 계정도 함께 삭제합니다. 두 작업 모두 확인 화면을 거치며, 다른 회원이나 기존 JSON 백업이 참조 중인 노드 첨부는 보관합니다. 지정된 개발자 계정 자체는 화면에서 삭제할 수 없습니다.

## 확인 순서

1. 대시보드에서 오늘의 작업과 프로젝트 캘린더를 확인합니다. 캘린더는 주간·월간으로 전환할 수 있습니다. 프로젝트 기간은 생성일 또는 더 이른 작업 기록일부터 한국 시간 기준 오늘(진행 중) 또는 완료일(완료)까지 표시됩니다. 완료일이 없는 기존 프로젝트는 마지막 기록일을 사용합니다.
2. 프로젝트 목록에서 프로젝트 이름을 누르면 상세 타임라인으로 이동합니다. 이름 주변의 행을 누르면 작업 노드가 펼쳐지거나 접힙니다.
3. 예시 프로젝트를 수정하거나 새 프로젝트에 작업 노드와 코드·이미지·ZIP을 등록합니다.
4. OpenAI를 설정했다면 **AI에게 요청하기**에서 답변 성격과 요청 내용을 입력합니다. 피드백을 채택하고 실제 조치와 결과를 기록합니다.
5. 노드를 수정한 뒤 **수정 이력**에서 이전 상태를 확인합니다. 할 일을 추가하고 완료 처리합니다.
6. 프로젝트 완료 리포트와 Portfolio 연결·자료 등록을 확인합니다. API 설정 없이도 기본 기록·Todo·Portfolio 기능을 사용할 수 있습니다.

## 프로젝트 색과 작성 출처

- 프로젝트를 만들 때 색을 선택하거나, 상세 화면의 **수정**에서 이름, 설명, 색, 카테고리, 마감일을 변경합니다. 기본 색은 `#007fff`입니다.
- 직접 작성한 제목·작업 내용, 실제 조치, 결과에는 프로젝트 색이 적용됩니다. 작업 기록 폼에서 각 항목의 **AI가 작성·수정한 …** 옵션을 선택하면 해당 항목이 회색으로 표시됩니다. AI 피드백은 기본적으로 회색입니다.
- 프로젝트·작업 기록·할 일·피드백은 회원 UID로 연결된 관계형 테이블에 저장합니다. 회원가입 시 예시 프로젝트와 할 일 하나씩 생성합니다. 작업공간 테이블은 동시 수정 감지를 위한 버전 정보만 관리합니다.
- 프로젝트 목록에서 작업 노드를 펼치고 오른쪽 끝의 **+**를 눌러 GitHub 링크, 코드, ZIP, 이미지 중 하나 이상을 등록합니다. 설명과 제목은 선택입니다. 이미지는 기록에서 미리 볼 수 있고, ZIP과 이미지는 다운로드할 수 있습니다. 파일은 노드당 최대 8개, 개당 8MB까지 저장 파일 옆의 `project-log-data.json.uploads` 폴더에 보관합니다.
- 기존 노드의 **수정**에서 작업물과 설명을 편집할 수 있습니다.

## 소스

```text
project-log/
├── app.js / db.js / calendar.js
├── package.json / package-lock.json
├── .env.example / .gitignore / README.md
├── routes/ / services/ / views/ / public/
├── sql/schema.sql
├── scripts/ / tests/ / docs/
├── uploads/.gitkeep
├── projectlog_erd.png / projectlog_erd.svg
└── projectlog_erd_presentation.png / projectlog_erd_presentation.svg
```

- `views/` — 화면별 EJS 템플릿과 공통 부분
- `public/style.css` — 레이아웃과 반응형 스타일
- `public/ui.js` — 프로젝트 목록의 가로 노드 펼치기 및 선택
- `app.js` — Express 설정, 대시보드, 알림, 할 일 화면
- `db.js` — 요청별 회원 작업공간과 동시 수정 제어
- `routes/` — 프로젝트, 노드, 피드백 요청 처리
- `services/` — 관계형 저장소·통계 쿼리·OpenAI 클라이언트와 피드백 프롬프트
- `data.js` — 2026년 11월 14일 기준 예시 데이터

## AI 피드백

서버를 실행하는 환경에 `OPENAI_API_KEY`를 설정한 뒤 서버를 시작하세요. 기본 모델은 `gpt-5.6-terra`이며, `OPENAI_MODEL`로 변경할 수 있습니다. 요청을 제출하면 서버가 해당 노드의 기록, 첨부 코드, 이미지 및 ZIP을 OpenAI로 전송합니다. 링크의 주소도 분석 자료에 포함되며 연결된 페이지는 가져오지 않습니다. [OpenAI 모델 문서](https://developers.openai.com/api/docs/models/gpt-5.6-terra)

각 노드의 답변은 `Feedback #1`부터 순서대로 저장됩니다. **추가 피드백 생성**을 누르면 이전 요청이 채워지고 새 답변이 다음 번호로 추가됩니다.

노드 피드백과 Portfolio 분석은 AI 응답을 최대 10분까지 기다리며 자동 재시도하지 않습니다. 완료되지 않았거나 내용이 없는 답변은 저장하지 않습니다. 노드 요청 중에는 본문에 분석 중 표시가 나타나고, 성공하면 저장된 답변으로 이동합니다. 실패하면 입력 내용을 유지해 다시 요청할 수 있습니다. 배포 시 역방향 프록시의 응답 대기 시간도 10분 이상으로 설정해야 합니다.

피드백 상세에서 형광펜 또는 밑줄 아이콘을 누르고 색을 고른 뒤 답변을 드래그하면 표시가 저장됩니다. 밑줄은 검정과 빨강을 지원합니다. 지우개를 켜고 표시를 선택해 삭제하거나 양 끝 손잡이로 범위를 조절할 수 있습니다. 손잡이를 키보드로 조절하려면 포커스를 두고 왼쪽·오른쪽 화살표 키를 누릅니다.

## Portfolio

왼쪽 **Portfolio**에서 기존 프로젝트, 이미지, GitHub 저장소 주소, ZIP을 한 항목에 등록할 수 있습니다. 서버가 Portfolio 테이블을 자동 생성합니다. 원본 프로젝트 연결은 실제 외래키이며 프로젝트를 삭제해도 Portfolio는 보존됩니다.

업로드 파일은 기본적으로 `uploads/portfolio/`에 저장합니다. 배포 시 `PROJECT_LOG_PORTFOLIO_UPLOADS`로 앱 계정에 쓰기 권한이 있는 별도 경로를 지정할 수 있습니다. DB를 백업할 때 노드·Portfolio 첨부 폴더도 함께 백업합니다. 앞단 프록시를 사용한다면 한 번에 올릴 파일의 총 크기를 수용하도록 요청 본문 제한을 설정합니다.

AI 분석은 포트폴리오 안의 전체 자료 또는 세부 카테고리를 대상으로 스타일, 강점, 보완점, 성장 로드맵 태그를 선택해 요청합니다. 전체 분석에는 연결 프로젝트의 기록도 포함되며, 카테고리를 선택하면 해당 카테고리의 자료를 분석합니다. 등록 이미지는 대표 이미지 우선으로 작업물당 최대 2장, 요청당 최대 8장·총 12MB까지 전송합니다. 나머지 파일과 외부 링크는 이름·주소·설명만 제공하며 내용을 가져오지 않습니다.

공개로 저장하면 상세 화면에 공유 링크가 표시됩니다. 링크를 받은 사람은 로그인 없이 직접 입력한 정보, 등록 이미지와 GitHub 링크를 볼 수 있습니다. 배포에서는 `PROJECT_LOG_PUBLIC_ORIGIN`에 외부에서 접근할 수 있는 서비스 주소를 지정합니다.

## Migration과 검증

기존 JSON 작업공간 DB를 사용하는 경우 웹을 중지하고 실행합니다. 스크립트는 먼저 SQL 백업을 생성하고, 회원별 트랜잭션으로 이전합니다. DB와 첨부 폴더는 함께 보관하세요.

```bash
node --env-file=.env scripts/migrate-records.js --export-schema
node --env-file=.env scripts/verify-relational.js --compare-legacy
```

`--compare-legacy`는 이전 직후 원본이 남아 있을 때 사용합니다. 원본 컬럼이 없는 새 DB에서는 관계 무결성만 검증합니다. 일반 검증은 `node --env-file=.env scripts/verify-relational.js`입니다. 자세한 이전·복구 범위는 [Migration 안내](docs/database-migration.md)를 확인하세요.

`npm test`는 API 유료 호출 없이 단위 검증을 실행합니다. DB 통합 테스트는 별도의 **빈** `projectlog_test_*` DB와 `PROJECT_LOG_TEST_MYSQL_URL`이 있어야 실행되고, 없으면 해당 테스트를 건너뜁니다. `.env`의 테스트 변수를 쓸 때는 `node --env-file=.env --test tests/*.test.cjs`로 실행합니다.

## ERD

[전체 ERD PNG](projectlog_erd.png) · [전체 SVG](projectlog_erd.svg) · [발표용 PNG](projectlog_erd_presentation.png) · [발표용 SVG](projectlog_erd_presentation.svg)

이미지와 [schema.sql](sql/schema.sql)은 실제 MySQL 스키마에서 생성했습니다. ERD를 다시 생성할 때만 Graphviz용 `@viz-js/viz`와 `playwright`, Chrome이 필요하며 웹 실행에는 필요하지 않습니다. 별도 도구 폴더에 설치하고 `.env.example`의 도구 경로를 지정하는 방법은 [DB 안내](docs/database-migration.md)에 있습니다.

## GitHub에 올리기

GitHub에서 빈 저장소를 만듭니다. 이 프로젝트에는 이미 README와 `.gitignore`가 있으므로 저장소 생성 시 초기 파일 추가 옵션은 비워 둡니다. 아래 명령의 `OWNER`와 `REPO`를 본인 저장소에 맞게 바꿉니다. [GitHub의 기존 프로젝트 업로드 안내](https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github)

1. 프로젝트 폴더의 PowerShell에서 파일을 준비하고 커밋 목록을 확인합니다.

   ```powershell
   git init -b main
   git add .
   git diff --cached --name-only
   ```

   `package-lock.json`, `.env.example`, `data.js`의 예시 데이터와 `public/`의 화면용 이미지는 포함합니다. `.env`, API 키, Google OAuth 자격 증명, DB 백업, 실제 기록과 사용자 첨부는 목록에서 빠져 있어야 합니다. 저장 경로를 따로 지정했다면 저장소 밖에 두거나 그 경로를 `.gitignore`에 추가합니다. 배포 의존성 검사는 `npm audit --omit=dev`로 실행합니다.

2. GitHub 계정으로 인증한 뒤 첫 커밋을 올립니다.

   ```powershell
   git commit -m "Add Project Log"
   git remote add origin https://github.com/OWNER/REPO.git
   git push -u origin main
   ```

## AWS EC2에서 실행하기

Ubuntu EC2 한 대에서 앱과 MySQL을 실행하고, 내 PC에서 SSH 터널로 접속하는 예입니다. SSH 터널만 사용할 때는 보안 그룹에서 내 IP의 SSH 포트(22)를 허용합니다. 도메인으로 접속하게 하려면 HTTPS 역방향 프록시를 연결하고 `PROJECT_LOG_PUBLIC_ORIGIN`을 실제 HTTPS 주소로 설정합니다. 두 경우 모두 Node 앱과 MySQL은 EC2 내부의 루프백 주소에 둡니다. [AWS Linux 인스턴스 SSH 접속 안내](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/connect-linux-inst-ssh.html)

### 1. 서버 접속 및 코드 설치

EC2에서 Ubuntu 이미지와 키 페어를 선택하고, 인스턴스의 퍼블릭 DNS 또는 주소를 확인합니다. 내 PC에서 `EC2_HOST`를 그 주소로 바꿔 접속합니다.

```powershell
ssh -i "C:\path\project-log.pem" ubuntu@EC2_HOST
```

EC2에서 Git과 Node.js 22 이상을 준비합니다. 저장소가 비공개이면 EC2에 읽기 전용 배포 키를 등록합니다. [Node.js 설치](https://nodejs.org/en/download) · [GitHub 배포 키 설정](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys)

```bash
sudo apt update
sudo apt install -y git
node -v
command -v node
git clone git@github.com:OWNER/REPO.git ~/project-log
cd ~/project-log
npm ci --omit=dev
install -d -m 700 "$HOME/project-log-data"
```

공개 저장소라면 클론 주소로 `https://github.com/OWNER/REPO.git`도 쓸 수 있습니다.

### 2. MySQL과 기존 기록 준비

EC2의 MySQL에 앱 전용 데이터베이스와 전용 계정을 준비합니다. 앱을 시작하고 처음 로그인할 때 필요한 테이블이 생성됩니다. 개발자 문의함은 배포 서버에서 직접 가입한 계정의 UID를 `PROJECT_LOG_DEVELOPER_UID`로 지정하면 열립니다.

기존 기록이 JSON 모드에 있을 때는 로컬 앱을 종료한 상태에서 내 PC의 프로젝트 폴더에서 아래 명령을 실행합니다. 첨부 폴더가 있을 때만 둘째 명령을 실행합니다.

```powershell
scp -i "C:\path\project-log.pem" .\project-log-data.json ubuntu@EC2_HOST:/home/ubuntu/project-log-data/
scp -r -i "C:\path\project-log.pem" .\project-log-data.json.uploads ubuntu@EC2_HOST:/home/ubuntu/project-log-data/
```

서버에서 새 계정을 만든 뒤 [기존 기록 가져오기](#mysql과-회원-계정) 명령으로 해당 UID에 JSON 기록을 가져옵니다. 이미 MySQL 모드에서 기록하고 있다면 최신 데이터가 들어 있는 MySQL을 백업·복원하고, 작업 노드 첨부와 Portfolio 첨부 폴더를 각 환경 변수에 맞는 경로로 별도 복사합니다.

### 3. 실행 환경 파일

아래 항목을 3-A 또는 3-B의 환경 파일에 입력합니다. 데이터베이스 접속 정보와 API 키는 서버에서 직접 채웁니다. 도메인으로 접속할 경우 `PROJECT_LOG_PUBLIC_ORIGIN`을 실제 HTTPS 주소로 바꿉니다.

```dotenv
NODE_ENV=production
PROJECT_LOG_HOST=127.0.0.1
PORT=3000
PROJECT_LOG_MYSQL_URL=mysql://projectlog:ENCODED_PASSWORD@127.0.0.1:3306/projectlog
PROJECT_LOG_PUBLIC_ORIGIN=http://127.0.0.1:3300
PROJECT_LOG_DATA_FILE=/home/ubuntu/project-log-data/project-log-data.json
PROJECT_LOG_PORTFOLIO_UPLOADS=/home/ubuntu/project-log-data/portfolio
# OPENAI_API_KEY=
# PROJECT_LOG_DEVELOPER_UID=
```

### 3-A. systemd로 실행

앱을 계속 실행하는 방법은 3-A(systemd) 또는 3-B(PM2) 중 하나를 선택합니다.

EC2에서 아래 명령으로 환경 파일을 만듭니다.

```bash
sudo touch /etc/project-log.env
sudo chmod 600 /etc/project-log.env
sudoedit /etc/project-log.env
```

위 실행 환경 값을 `/etc/project-log.env`에 저장합니다.

`sudoedit /etc/systemd/system/project-log.service`로 서비스 파일을 만듭니다. `ExecStart`의 `/usr/bin/node`에는 앞서 `command -v node`가 출력한 절대 경로를 넣습니다.

```ini
[Unit]
Description=Project Log
After=network-online.target
Wants=network-online.target

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/project-log
EnvironmentFile=/etc/project-log.env
ExecStart=/usr/bin/node /home/ubuntu/project-log/app.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now project-log
curl -fsS http://127.0.0.1:3000/login -o /dev/null
```

### 3-B. PM2로 실행

PM2로 실행하면 EC2의 SSH 터미널을 닫아도 앱이 계속 실행됩니다. EC2가 재부팅된 뒤에도 자동으로 시작하도록 아래에서 부팅 설정까지 등록합니다. [PM2 시작 가이드](https://pm2.keymetrics.io/docs/usage/quick-start/)

1. EC2에 `ubuntu`로 접속한 상태에서 PM2와 앱 설정 파일을 준비합니다.

   ```bash
   npm install -g pm2
   install -d -m 700 "$HOME/.config/project-log"
   (umask 077 && touch "$HOME/.config/project-log/app.env")
   chmod 600 "$HOME/.config/project-log/app.env"
   nano "$HOME/.config/project-log/app.env"
   ```

   위 실행 환경 값을 `app.env`에 저장합니다. Node.js가 앱 시작 시 이 파일을 읽습니다. [Node.js 환경 파일 옵션](https://nodejs.org/api/cli.html#--env-filefile)

2. 이미 3-A의 `project-log` 서비스를 실행 중이라면 `sudo systemctl disable --now project-log`로 중지한 뒤 PM2로 프로세스 하나를 시작합니다.

   ```bash
   cd ~/project-log
   pm2 start app.js --name project-log --node-args="--env-file=$HOME/.config/project-log/app.env"
   pm2 status
   curl -fsS http://127.0.0.1:3000/login -o /dev/null
   ```

3. `pm2 startup systemd`를 실행합니다. PM2가 화면에 출력하는 `sudo …` 명령을 복사해 실행한 뒤, 같은 `ubuntu` 계정에서 `pm2 save`로 실행 목록을 저장합니다. [PM2 자동 실행 설정](https://pm2.keymetrics.io/docs/usage/startup/)

   ```bash
   pm2 startup systemd
   # 화면에 나온 sudo 명령을 복사해 실행
   pm2 save
   ```

4. SSH 창을 닫았다가 다시 접속한 뒤 `pm2 status`에서 `project-log`가 `online`인지 확인합니다. 로그는 `pm2 logs project-log --lines 50 --nostream`으로 볼 수 있습니다.

### 4. 내 PC에서 접속하고 업데이트하기

내 PC의 PowerShell에서 터널을 열고, 해당 창을 열어 둔 채 브라우저에서 [http://127.0.0.1:3300/](http://127.0.0.1:3300/)를 엽니다.

```powershell
ssh -N -L 3300:127.0.0.1:3000 -i "C:\path\project-log.pem" ubuntu@EC2_HOST
```

EC2에서 앱을 실행하는 데 일반 SSH 터미널을 열어 둘 필요는 없습니다. 브라우저가 사용하는 SSH 터널이 끊어지면 위 명령으로 터널을 다시 엽니다.

새 커밋을 GitHub에 올린 뒤 EC2에서 코드를 업데이트합니다.

```bash
cd ~/project-log
git pull --ff-only
npm ci --omit=dev
```

3-A에서 systemd로 실행했다면 아래 명령을 사용합니다.

```bash
sudo systemctl restart project-log
sudo journalctl -u project-log -n 50 --no-pager
```

3-B에서 PM2로 실행했다면 아래 명령을 사용합니다. 환경 파일에서 API 키를 바꾼 뒤에도 같은 재시작 명령을 사용합니다.

```bash
pm2 restart project-log
pm2 logs project-log --lines 50 --nostream
```
