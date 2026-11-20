# HTTPS 프록시와 DB·첨부파일 통합 백업

## Nginx

`deploy/nginx/project-log.conf`는 완전한 서버 설정이 아니라 **HTTPS server 블록 내부에 넣는 설정**입니다. 도메인·TLS 인증서를 먼저 설정한 후 내용을 넣으세요. 기존 `location /`가 있으면 교체합니다. 앱 포트가 3000이 아니면 `proxy_pass`도 맞춥니다.

- 요청 전체 최대 200MiB: Portfolio 이미지 12×8MiB + 파일 3×30MiB와 폼 데이터를 포함합니다. 개별 파일 제한은 기존 앱 설정을 유지합니다.
- 업로드 데이터 수신 간격 5분, 앱 응답 데이터 수신 간격 11분입니다. 앱의 AI 대기 최대 10분에 저장·렌더링 시간을 더했습니다. 전체 요청을 무조건 11분으로 끊는 설정은 아닙니다.
- 같은 서버의 Nginx만 앱에 연결하도록 앱은 `127.0.0.1`에 바인딩합니다.

운영 환경 파일:

```dotenv
NODE_ENV=production
PROJECT_LOG_HOST=127.0.0.1
PORT=3000
PROJECT_LOG_TRUST_PROXY=loopback
PROJECT_LOG_PUBLIC_ORIGIN=https://YOUR_DOMAIN
PROJECT_LOG_BACKUPS=/home/ubuntu/project-log-data/backups
```

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 통합 백업

Ubuntu에서 MySQL의 `mysqldump`와 `tar`가 필요합니다. 백업 계정은 대상 DB를 읽고 덤프할 권한이 있어야 합니다. MySQL 8 기준이며 MariaDB의 덤프 CLI와는 옵션이 다릅니다.

`scripts/backup.cjs`는 다음 항목을 한 `.tar.gz` 파일로 만듭니다.

- `database.sql`: 회원, 세션, 작업 기록, 피드백, Portfolio, DB에 저장된 프로필 이미지 등 DB 전체
- `node-uploads/`: `PROJECT_LOG_DATA_FILE + '.uploads'`
- `portfolio-uploads/`: `PROJECT_LOG_PORTFOLIO_UPLOADS` 또는 기본 Portfolio 업로드 폴더
- `legacy-data.json`: 기존 JSON 원본이 있으면 포함
- `manifest.json`: 생성 시각과 포함 항목 목록

환경 파일과 API 키는 아카이브에 넣지 않습니다. DB 접속 비밀번호는 권한을 제한한 임시 설정 파일로 전달하고 종료 시 제거합니다. 백업에는 개인정보가 있으므로 공개 폴더·Git에 넣지 마세요. 완료 파일은 600 권한이며 백업 디렉터리는 앱 업로드 폴더 밖에 둡니다. 저장 실패 시 `.partial`을 완료 백업으로 취급하지 않습니다.

### systemd 앱 수동 백업

README의 `project-log.service`로 실행 중일 때 사용합니다. 서비스가 실행 중인지 확인하고 중지한 후 DB 덤프와 파일 복사를 수행합니다. 스냅샷이 준비되면 앱을 다시 켜고 압축합니다. 오류가 발생해도 재시작을 시도합니다. **백업 중에는 잠시 접속할 수 없습니다. 다른 앱 프로세스나 외부 DB 쓰기 작업도 없어야 합니다.**

```bash
cd /home/ubuntu/project-log
sudo /usr/bin/flock -n /run/project-log-backup.lock /usr/bin/node --env-file=/etc/project-log.env scripts/backup.cjs --service project-log
sudo systemctl is-active project-log
```

Node가 `/usr/bin/node`에 없으면 `command -v node`의 절대 경로로 교체하세요.

### 매일 오전 4시(한국 시간) 자동 백업

서비스 파일의 Node·프로젝트 경로와 환경 파일을 서버에 맞춘 뒤 설치합니다. 앱도 systemd로 실행해야 합니다. root가 백업 서비스만 실행하여 환경 파일 접근 및 앱 중지·재시작을 수행합니다. 동시에 실행된 백업은 `flock`으로 막습니다.

```bash
sudo cp deploy/systemd/project-log-backup.service /etc/systemd/system/
sudo cp deploy/systemd/project-log-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl start project-log-backup.service
sudo journalctl -u project-log-backup.service -n 30 --no-pager
sudo systemctl enable --now project-log-backup.timer
systemctl list-timers project-log-backup.timer
```

성공을 확인한 뒤 타이머를 켜세요. 백업은 자동 삭제하지 않습니다. 디스크 사용량을 확인하고, 완료된 아카이브를 별도 PC나 비공개 외부 저장소에도 복사하세요. 같은 EC2 디스크의 백업만으로는 디스크 손실에 대비할 수 없습니다. 강제 종료·전원 장애 시에는 서비스 상태를 직접 확인해야 합니다.

### PM2 앱 수동 백업

PM2는 해당 앱을 실행한 계정으로 중지합니다. 모든 앱 인스턴스가 중지된 상태에서만 `--offline`을 사용하세요. 이 옵션 자체는 앱 중지를 확인하지 않습니다. 위 systemd 타이머는 PM2에 사용하지 않습니다.

```bash
cd /home/ubuntu/project-log
pm2 stop project-log
node --env-file="$HOME/.config/project-log/app.env" scripts/backup.cjs --offline
# 백업 성공/실패에 관계없이 다음 명령으로 앱을 다시 켭니다.
pm2 restart project-log
```

## 복구

운영 DB를 덮어쓰기 전에 **별도 빈 DB와 별도 파일 폴더**에서 복구를 먼저 확인하세요. 환경 파일·코드도 별도로 준비해야 합니다. 아래는 예시 경로입니다. 실행 전에 실제 백업과 대상 경로로 바꾸세요.

1. 앱 및 다른 쓰기 작업을 중지합니다. 현재 DB·파일도 먼저 백업합니다.
2. 비공개 빈 디렉터리에 신뢰하는 백업을 풀고 `manifest.json`을 확인합니다.

   ```bash
   install -d -m 700 "$HOME/projectlog-restore"
   tar -xzf /PATH/TO/projectlog-TIMESTAMP.tar.gz -C "$HOME/projectlog-restore"
   cat "$HOME/projectlog-restore/manifest.json"
   ```

3. 별도의 빈 MySQL DB를 준비하고 덤프를 가져옵니다. 비밀번호는 프롬프트에 입력합니다.

   ```bash
   mysql -h 127.0.0.1 -u projectlog -p projectlog_restore < "$HOME/projectlog-restore/database.sql"
   ```

4. `node-uploads`를 복구 환경의 `PROJECT_LOG_DATA_FILE + '.uploads'`로, `portfolio-uploads`를 `PROJECT_LOG_PORTFOLIO_UPLOADS` 경로로 복사합니다. 기존 폴더에 섞어 넣지 말고 빈 폴더를 사용합니다. `manifest.json`에 없는 항목은 원래 없었던 자료입니다. 복구 파일의 소유권을 앱 실행 계정에 맞춥니다.
5. 복구 환경의 DB URL과 파일 경로를 지정하여 `scripts/verify-relational.js`를 실행하고 앱을 켭니다. 로그인, 프로젝트 기록, 첨부 다운로드, Portfolio 이미지를 확인한 후 운영 환경을 전환합니다.

DB만 복구하면 파일 링크가 깨질 수 있으므로 항상 같은 아카이브의 DB와 파일을 사용하세요.
