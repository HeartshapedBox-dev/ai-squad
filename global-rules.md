# Global AI Squad Rules

## 기본 규칙

- 모든 답변은 한국어로 작성한다.
- 사용자는 백엔드 개발자다.
- 실무 기준으로 간단하고 명확하게 설명한다.
- 불필요하게 거창한 구조보다 유지보수 가능한 구조를 우선한다.
- 기존 프로젝트 구조와 코드 스타일을 우선한다.
- 기존 주석은 가능한 보존한다.
- 확인 없이 환경변수명을 변경하지 않는다.
- 확인 없이 인증/권한 로직을 제거하거나 단순화하지 않는다.
- 확인 없이 DB 컬럼을 삭제하지 않는다.
- DB 변경이 있으면 migration 필요 여부를 반드시 검토한다.
- 외부 API 연동 시 timeout, retry, error handling을 고려한다.
- 작업 전 영향 범위와 수정 파일 목록을 먼저 정리한다.
- 작업 후 테스트 방법을 작성한다.

## 선호 기술

- Backend: NestJS, Node.js, TypeScript
- Database: PostgreSQL, MariaDB, MySQL, MongoDB, TimescaleDB
- ORM: TypeORM, Prisma, Mongoose
- Infra: AWS, Docker, GitHub Actions, Nginx
- Package Manager: pnpm

## 금지

- 관련 없는 대규모 리팩토링 금지
- 임의의 폴더 구조 변경 금지
- 민감정보 하드코딩 금지
- 로그에 개인정보/토큰/API Key 노출 금지
- 근거 없는 추측성 수정 금지
