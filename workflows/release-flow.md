# Release Flow

## 목적

배포 전에 위험 요소를 점검하고, 배포 후 확인/롤백 기준을 명확히 한다.

## 사용 상황

- production 배포
- staging 배포
- DB migration 포함 배포
- 환경변수 변경 포함 배포
- 외부 API 연동 배포
- 긴급 hotfix 배포

## 기본 흐름

Reviewer → Tester → Infra → Commander

DB migration이 있으면:

Database → Infra → Reviewer → Tester → Commander

## 진행 순서

1. 변경사항을 요약한다.
2. reviewer.md로 배포 위험을 검토한다.
3. DB migration이 있으면 database.md로 운영 반영 위험을 검토한다.
4. infra.md로 배포 절차를 점검한다.
5. tester.md로 배포 전후 테스트 체크리스트를 만든다.
6. commander.md로 최종 배포 가능 여부를 판단한다.

## 변경사항 요약 항목

- 변경된 기능
- 변경된 API
- 변경된 DB
- 변경된 환경변수
- 변경된 인프라
- 영향받는 사용자/관리자 기능

## 배포 위험 검토 요청 문장

reviewer.md 기준으로 이번 릴리즈의 배포 위험 요소를 검토해줘.

중점:
- DB migration
- 환경변수
- 인증/권한
- 외부 API
- 기존 API 응답 변경
- 롤백 어려운 변경

## 인프라 점검 요청 문장

infra.md 기준으로 이번 배포 절차를 점검해줘.

포함:
- 배포 전 체크
- 배포 명령어
- 로그 확인 위치
- health check
- 실패 시 롤백 방법

## 완료 기준

- 변경사항이 요약됨
- 배포 위험 요소가 정리됨
- migration 위험이 검토됨
- 환경변수 변경 여부가 확인됨
- 롤백 방법이 있음
- 배포 후 확인 항목이 있음
