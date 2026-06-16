# AI Squad

개인 개발 작업을 돕기 위한 나만의 AI 개발 사단이다.

이 폴더는 특정 프로젝트에 종속되지 않고, 여러 프로젝트에서 공통으로 사용할 수 있는 에이전트 역할, 작업 템플릿, 워크플로우, 현재 프로젝트 문맥을 관리한다.

---

## 폴더 구조

```text
~/ai-squad/
├── README.md
├── global-rules.md
├── agents/
│   ├── commander.md
│   ├── planner.md
│   ├── backend.md
│   ├── frontend.md
│   ├── database.md
│   ├── infra.md
│   ├── reviewer.md
│   └── tester.md
├── templates/
│   ├── new-feature.md
│   ├── bug-fix.md
│   ├── refactor.md
│   ├── api-design.md
│   └── pr-review.md
├── workflows/
│   ├── feature-flow.md
│   ├── bugfix-flow.md
│   └── release-flow.md
└── ai/
    ├── project-context.md
    ├── tech-stack.md
    ├── conventions.md
    ├── constraints.md
    └── current-task.md
```

---

## 각 폴더 역할

### `global-rules.md`

모든 에이전트가 공통으로 따라야 하는 기본 규칙이다.

예:

- 한국어로 답변
- 기존 코드 스타일 유지
- 기존 주석 보존
- 환경변수명 임의 변경 금지
- 인증/권한 로직 임의 변경 금지
- DB 변경 시 migration 필요 여부 검토

---

### `agents/`

역할별 전문가 정의 파일이다.

| 파일 | 역할 |
|---|---|
| `commander.md` | 전체 작업 총괄, 에이전트 의견 통합, Codex 지시문 작성 |
| `planner.md` | 요구사항 정리, 작업 범위 분리, 티켓화 |
| `backend.md` | NestJS/Node.js/TypeScript 백엔드 설계 |
| `frontend.md` | React/Next.js 프론트 설계 |
| `database.md` | DB 설계, 마이그레이션, 인덱스, 정합성 검토 |
| `infra.md` | AWS, Docker, CI/CD, 배포, 운영 검토 |
| `reviewer.md` | 코드 리뷰, 보안/성능/예외처리 검토 |
| `tester.md` | 테스트 시나리오, cURL, 회귀 테스트 작성 |

---

### `templates/`

자주 쓰는 작업 요청 양식이다.

| 파일 | 용도 |
|---|---|
| `new-feature.md` | 새 기능 개발 요청 |
| `bug-fix.md` | 버그 수정 요청 |
| `refactor.md` | 리팩토링 요청 |
| `api-design.md` | API 설계 요청 |
| `pr-review.md` | PR 또는 diff 리뷰 요청 |

---

### `workflows/`

작업 종류별 실행 순서다.

| 파일 | 용도 |
|---|---|
| `feature-flow.md` | 새 기능 개발 흐름 |
| `bugfix-flow.md` | 버그 수정 흐름 |
| `release-flow.md` | 배포/릴리즈 흐름 |

---

### `ai/`

현재 작업 중인 프로젝트 문맥을 넣는 폴더다.

이 폴더는 프로젝트마다 새로 만드는 대신, 현재 작업하는 프로젝트 정보로 갈아끼워서 사용한다.

| 파일 | 용도 |
|---|---|
| `project-context.md` | 프로젝트 개요, 주요 기능, 도메인 |
| `tech-stack.md` | 기술스택 |
| `conventions.md` | 해당 프로젝트 코드 규칙 |
| `constraints.md` | 절대 하지 말아야 할 것 |
| `current-task.md` | 현재 작업 내용 |

---

## 기본 사용 흐름

### 빠른 사용 흐름

새 프로젝트를 만들고 AI Squad가 바로 프로젝트 구성을 시작하게 하려면:

```bash
squad new my-app --type next --approval never
```

`my-app`처럼 이름만 주면 기본 위치는 `~/projects/my-app`이다.
경로를 직접 주면 그 경로를 그대로 쓴다.
이 명령은 프로젝트 폴더를 만들고, `ai/` 문맥을 초기화하고, cmux에 에이전트 탭을 띄운 뒤 Commander가 첫 작업을 자동 분배하게 한다.

```bash
squad new ~/projects/api-server --type nest
squad new mobile-app --type expo
squad new scratch
```

첫 작업 내용을 직접 지정하려면:

```bash
squad new mobile-app --type expo --task "Expo 앱 초기 구조 만들고 로그인 화면부터 시작" --approval never
```

예전처럼 승인 받고 실행하려면:

```bash
squad new my-app --type next --approval request
```

지원하는 타입:

- `blank`
- `next`
- `nest`
- `expo`

기존 프로젝트에 AI Squad만 붙이려면:

```bash
squad start /path/to/current-project --approval request
```

최근 setup된 프로젝트에 바로 작업을 보내려면:

```bash
squad ask "로그인 API 500 오류 수정"
```

최근 분배 상태를 보려면:

```bash
squad status
```

실행 전 생성될 파일과 setup 명령만 확인하려면:

```bash
squad new my-app --type next --approval never --dry-run
squad start /path/to/current-project --approval request --dry-run
```

### 0. cmux 자동 분배 준비

원하는 운영 방식이 “cmux에 역할별 탭을 띄우고, Commander에게만 말하는 방식”이면 먼저 setup을 실행한다.

```bash
cd ~/ai-squad
node bin/squad.mjs setup --project /path/to/current-project --dry-run
node bin/squad.mjs setup --project /path/to/current-project
```

이 명령은 cmux 현재 창에 다음 역할 탭을 만들고 각 탭에서 Codex를 역할별로 시작한다.
각 Codex 세션은 현재 프로젝트, `~/ai-squad`, `~/projects`를 함께 참고하면서 시작한다.
`--approval never`를 쓰면 생성되는 worker 시작 명령은 `codex --dangerously-bypass-approvals-and-sandbox --cd <project> --add-dir ~/ai-squad --add-dir ~/projects ...` 형식이다.
`--approval request`를 쓰면 `codex --sandbox workspace-write --ask-for-approval on-request --cd <project> --add-dir ~/ai-squad --add-dir ~/projects ...` 형식으로 시작한다.

`--dangerously-bypass-approvals-and-sandbox`는 Codex의 승인 질문과 sandbox를 우회한다.
즉, `squad new ...`로 뜬 에이전트들은 명령 실행, 파일 수정, 패키지 설치 등을 사용자에게 매번 묻지 않고 진행할 수 있다.
대신 안전장치가 거의 없어지므로 개인 로컬 프로젝트에서만 사용하고, 신뢰하지 않는 레포나 외부에서 받은 작업 지시에는 쓰지 않는다.

- `플레너 노동자`
- `백엔드 노동자`
- `DB 노동자`
- `프론트엔드 노동자`
- `인프라 노동자`
- `리뷰어 노동자`
- `테스터 노동자`
- `코만더노동자`

이후에는 `코만더노동자` 탭에만 작업을 말한다. Commander는 필요한 worker에게 자동 분배 명령을 실행하고, worker 결과를 취합해 사용자에게 보고한다.
구현/수정/추가/개발 작업은 Backend Worker가 실제 구현 담당이고, Reviewer/Tester는 구현 후 검토 담당이다.

예:

```text
회원가입 API 구현해줘. Prisma DB 변경 필요 여부도 같이 검토해줘.
```

아래 명령들은 setup 없이 프롬프트를 직접 생성/전송하고 싶을 때 사용한다.

`current-task.md`를 기준으로 필요한 역할을 자동 선택하고, 각 cmux 터미널에 붙여넣을 프롬프트를 생성한다.

```bash
cd ~/ai-squad
node bin/squad.mjs dispatch --project /path/to/current-project
```

생성 결과는 `.squad-runs/<timestamp>/` 아래에 저장된다.

주요 파일:

- `cmux-paste-guide.md`: cmux 터미널별 붙여넣기 가이드
- `01-*.prompt.md`: 각 역할 에이전트에게 보낼 프롬프트
- `commander.collect.prompt.md`: 역할별 답변을 취합할 Commander 프롬프트
- `manifest.json`: 이번 분배의 모드와 역할 목록

작업 유형을 직접 지정할 수도 있다.

```bash
node bin/squad.mjs dispatch --mode feature --project /path/to/current-project
node bin/squad.mjs dispatch --mode bugfix --project /path/to/current-project
node bin/squad.mjs dispatch --mode release --project /path/to/current-project
```

역할을 직접 고정하려면 다음처럼 실행한다.

```bash
node bin/squad.mjs dispatch --roles planner,backend,database,frontend,infra,commander,reviewer,tester --project /path/to/current-project
```

cmux 탭 제목에 역할명이 들어가 있으면 자동으로 프롬프트를 보낼 수 있다.

예:

- `플래너 노동자`
- `백엔드 노동자`
- `데이터베이스 노동자`
- `커맨더`
- `코만더노동자`
- `리뷰어`
- `테스터`

```bash
node bin/squad.mjs send --run latest --dry-run
node bin/squad.mjs send --run latest
```

붙여넣은 뒤 바로 실행까지 하려면 `--submit`을 붙인다.

```bash
node bin/squad.mjs send --run latest --submit
```

분배 생성과 전송을 한 번에 하려면:

```bash
node bin/squad.mjs dispatch --project /path/to/current-project --send
node bin/squad.mjs dispatch --project /path/to/current-project --send --submit
```

주의: `--submit`은 해당 cmux 탭이 이미 Codex/Claude 같은 AI 입력 대기 상태일 때만 사용한다. 일반 shell 상태에서 실행하면 긴 프롬프트가 shell에 입력될 수 있다.

### 1. 현재 프로젝트 정보 작성

작업 전에 `ai/` 폴더에 현재 프로젝트 정보를 작성한다.

```text
~/ai-squad/ai/project-context.md
~/ai-squad/ai/tech-stack.md
~/ai-squad/ai/conventions.md
~/ai-squad/ai/constraints.md
~/ai-squad/ai/current-task.md
```

특히 작업할 내용은 `current-task.md`에 정리한다.

---

### 2. 필요한 에이전트만 호출

모든 에이전트를 매번 다 쓰지 않는다.

작업 크기에 따라 필요한 에이전트만 사용한다.

#### 간단한 백엔드 수정

```text
Backend → Codex → Reviewer
```

#### DB 변경이 있는 백엔드 작업

```text
Backend → Database → Codex → Reviewer → Tester
```

#### 풀스택 기능

```text
Planner → Backend → Frontend → Commander → Codex → Reviewer → Tester
```

#### 큰 기능 또는 신규 연동

```text
Planner → Backend → Database → Infra → Commander → Codex → Reviewer → Tester
```

#### 버그 수정

```text
원인 분석 → 담당 Agent → Codex → Reviewer → Tester
```

---

## Codex 요청 예시

### 백엔드 설계 먼저 요청

```text
내 개인 AI 사단 규칙은 ~/ai-squad 기준으로 봐줘.

공통 규칙:
- ~/ai-squad/global-rules.md

역할:
- ~/ai-squad/agents/backend.md

현재 프로젝트 정보:
- ~/ai-squad/ai/project-context.md
- ~/ai-squad/ai/tech-stack.md
- ~/ai-squad/ai/conventions.md
- ~/ai-squad/ai/constraints.md
- ~/ai-squad/ai/current-task.md

backend agent 기준으로 먼저 영향 범위와 수정 파일 목록을 정리해줘.
아직 코드는 수정하지 마.
```

---

### 구현 요청

```text
~/ai-squad/agents/backend.md 역할을 따르고,
~/ai-squad/global-rules.md와 ~/ai-squad/ai 폴더의 프로젝트 정보를 참고해줘.

~/ai-squad/ai/current-task.md 기준으로 구현해줘.

규칙:
- 기존 코드 스타일 유지
- 기존 주석 보존
- 관련 없는 리팩토링 금지
- 환경변수명 임의 변경 금지
- 인증/권한 로직 임의 변경 금지
- DB 변경 시 migration 필요 여부 먼저 판단
- 작업 후 테스트 방법 작성
```

---

### 리뷰 요청

```text
~/ai-squad/agents/reviewer.md와
~/ai-squad/templates/pr-review.md 기준으로 이번 diff를 리뷰해줘.

중점:
- 버그 가능성
- 예외처리
- 인증/권한
- DB 정합성
- 성능
- 배포 위험
```

---

### 테스트 요청

```text
~/ai-squad/agents/tester.md 기준으로 이번 작업의 테스트 시나리오를 작성해줘.

포함:
- 정상 케이스
- 예외 케이스
- 권한 케이스
- DB 검증
- 회귀 테스트
- cURL 예시
```

---

## 토큰 절약 원칙

에이전트를 많이 만들었다고 매번 전부 호출하지 않는다.

### 자주 쓰는 에이전트

```text
backend.md
reviewer.md
tester.md
```

### 필요할 때 쓰는 에이전트

```text
planner.md
database.md
frontend.md
infra.md
```

### 큰 작업에서만 쓰는 에이전트

```text
commander.md
```

---

## 작업별 추천 호출

### 작은 수정

예:

- DTO 필드 추가
- 간단한 조건 추가
- 에러 메시지 수정
- 응답 필드 하나 추가

사용:

```text
Backend → Reviewer
```

---

### 일반 백엔드 기능

예:

- API 추가
- Service 로직 추가
- 외부 API 연동
- 관리자 조회 API

사용:

```text
Backend → Codex → Reviewer
```

---

### DB 변경 작업

예:

- 컬럼 추가
- 인덱스 추가
- relation 변경
- migration 필요

사용:

```text
Backend → Database → Codex → Reviewer → Tester
```

---

### 풀스택 작업

예:

- 관리자 화면 추가
- API + 프론트 연동
- 상태 필터/검색/페이지네이션

사용:

```text
Planner → Backend → Frontend → Commander → Codex → Reviewer
```

---

### 배포 작업

예:

- production 배포
- env 변경
- migration 포함 배포

사용:

```text
Reviewer → Tester → Infra → Commander
```

---

## 주의사항

### 1. 조 보안 정보 넣지 않기

다음 정보는 절대 넣지 않는다.

```text
DB 비밀번호
AWS Access Key
AWS Secret Key
JWT Secret
API Key
운영 서버 접속정보
고객 개인정보
계약서/견적서 원문
내부 기밀 문서 전문
```

---

### 2. 민감정보는 별도 관리

필요하다면 아래 파일들은 만들 수 있지만, Git에 올리지 않는다.

```text
ai/secrets.md
ai/private-notes.md
```

`.gitignore`에 추가한다.

```gitignore
ai/secrets.md
ai/private-notes.md
```

---

### 3. 조 레포에 그대로 복사하지 않기

이 `ai-squad` 전체는 개인 로컬 도구다.

조직 프로젝트 레포에 그대로 복사하지 않는다.

추천 방식:

```text
~/ai-squad = 개인 AI 사단 본부
~/ai-squad/ai = 현재 프로젝트 문맥
조직 프로젝트 = 실제 코드 작업 위치
```

---

### 4. 현재 프로젝트가 바뀌면 `ai/` 내용도 바꾸기

`~/ai-squad/ai/`는 현재 작업 중인 프로젝트 기준이다.

조직 A 프로젝트 작업 중이면 조직 A 정보로 작성한다.

조 B 프로젝트로 넘어가면 `ai/` 내용을 조직 B 정보로 바꾼다.

여러 프로젝트를 동시에 관리하고 싶으면 나중에 아래처럼 확장할 수 있다.

```text
~/ai-squad/projects/
├── company-a/
├── company-b/
└── personal-project/
```

---

### 5. Codex에게 바로 수정시키지 않기

큰 작업은 바로 구현시키지 말고 먼저 분석을 시킨다.

좋은 요청:

```text
먼저 영향 범위와 수정 파일 목록을 정리해줘.
아직 코드는 수정하지 마.
```

나쁜 요청:

```text
알아서 전부 고쳐줘.
```

---

### 6. 대규모 리팩토링 방지

항상 요청에 아래 문장을 포함한다.

```text
관련 없는 리팩토링은 하지 마.
기존 코드 스타일을 유지해.
수정 범위를 최소화해.
```

---

### 7. DB 변경은 반드시 확인

DB 변경이 있으면 반드시 확인한다.

```text
DB 변경이 있으면 migration 필요 여부를 먼저 판단해줘.
운영 데이터 손실 위험이 있으면 경고해줘.
```

---

### 8. 인증/권한 로직 보호

인증/권한은 AI가 임의로 단순화하면 위험하다.

항상 아래 규칙을 둔다.

```text
인증/권한 로직은 임의로 제거하거나 단순화하지 마.
Guard, Role, Permission 로직 변경 시 영향 범위를 먼저 설명해.
```

---

### 9. 외부 API 연동 주의

외부 API 연동 작업에서는 반드시 확인한다.

```text
timeout
retry
error handling
개발/운영 URL 분리
민감정보 로그 마스킹
실패 시 fallback 또는 에러 응답
```

---

### 10. 리뷰와 테스트는 생략하지 않기

구현 후 최소한 `reviewer.md`는 한 번 거친다.

가능하면 `tester.md`로 테스트 시나리오도 만든다.

```text
Codex 구현 → Reviewer → Tester
```

---

## 추천 기본 루틴

### 새 기능

```text
1. ai/current-task.md 작성
2. backend.md 또는 planner.md로 설계 요청
3. 필요하면 database.md/frontend.md 호출
4. commander.md로 구현 프롬프트 정리
5. Codex 구현
6. reviewer.md로 리뷰
7. tester.md로 테스트 시나리오 작성
```

---

### 버그 수정

```text
1. bug-fix.md 양식으로 문제 정리
2. 원인 후보 3개 이내로 좁히기
3. 담당 agent 선택
4. Codex로 최소 수정
5. reviewer.md로 수정 범위 리뷰
6. tester.md로 재현/회귀 테스트 작성
```

---

### 배포

```text
1. 변경사항 요약
2. reviewer.md로 배포 위험 검토
3. database.md로 migration 위험 검토
4. infra.md로 배포 절차 확인
5. tester.md로 배포 후 체크리스트 작성
6. commander.md로 최종 판단
```

---

## 핵심 정리

```text
agents = 누가 할지
templates = 어떤 양식으로 시킬지
workflows = 어떤 순서로 할지
ai = 지금 작업 중인 프로젝트 정보
global-rules = 전체 공통 규칙
```

이 프로젝트의 목적은 AI에게 일을 전부 맡기는 것이 아니라,  
작업을 더 안정적으로 쪼개고, 설계하고, 리뷰하고, 테스트하기 위한 개인 개발 보조 시스템이다.
