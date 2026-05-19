# Feature Flow

## 목적

새로운 기능을 개발할 때 사용하는 표준 작업 흐름이다.

## 사용 상황

- 신규 API 개발
- 관리자 페이지 기능 추가
- 외부 API 연동
- DB 저장 로직 추가
- 프론트/백엔드가 함께 필요한 기능

## 기본 흐름

Planner → Backend → Database → Frontend → Commander → Codex → Reviewer → Tester

## 축소 흐름

백엔드만 필요한 작업:

Backend → Codex → Reviewer

DB 변경이 있는 백엔드 작업:

Backend → Database → Codex → Reviewer → Tester

풀스택 작업:

Planner → Backend → Frontend → Commander → Codex → Reviewer → Tester

## 진행 순서

1. planner.md로 요구사항을 정리한다.
2. backend.md로 API 구조를 설계한다.
3. DB 변경이 있으면 database.md로 검토한다.
4. 화면이 있으면 frontend.md로 화면/API 연동 구조를 설계한다.
5. commander.md로 최종 구현 프롬프트를 만든다.
6. Codex로 구현한다.
7. reviewer.md와 pr-review.md로 리뷰한다.
8. tester.md로 테스트 시나리오를 만든다.

## Codex 요청 기본 문장

아래 구현 지시문 기준으로 작업해줘.

규칙:
- 기존 코드 스타일 유지
- 기존 주석 보존
- 환경변수명 임의 변경 금지
- 인증/권한 로직 임의 변경 금지
- DB 변경 시 migration 필요 여부 판단
- 작업 전 수정 파일 목록 먼저 제안
- 작업 후 테스트 방법 작성

구현 지시문:
[여기에 붙여넣기]

## 완료 기준

- 요구사항이 기능으로 분해됨
- API/DB/화면 영향 범위가 정리됨
- Codex 구현 지시문이 명확함
- 리뷰에서 치명적 문제가 없음
- 테스트 방법이 정리됨
