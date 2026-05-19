# Project Context

## 프로젝트 개요

이 프로젝트는 [서비스 설명]을 위한 프로젝트다.

예:
- 관리자 페이지와 사용자 앱/웹을 지원하는 백엔드 서버
- 외부 보험사/PG/알림톡/SMS API와 연동되는 서비스

## 주요 기능

- 회원 관리
- 인증/로그인
- 관리자 기능
- 견적 관리
- 계약 관리
- 결제/정산
- 외부 API 연동
- 파일 업로드
- 알림톡/SMS/푸시 알림

## 주요 도메인

- User
- Auth
- Admin
- Insurance
- Payment
- Settlement
- ExternalApi
- Notification
- File

## 주의사항

- 운영 중인 서비스이므로 기존 API 응답 구조 변경 주의
- 인증/권한 로직 임의 변경 금지
- DB 컬럼 삭제 금지
- 외부 API 연동부 수정 시 실패 케이스 고려
- 프론트와 연동된 API는 응답 필드 변경 전 영향 범위 확인
