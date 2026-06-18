#!/usr/bin/env node

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RUNS_DIR = path.join(ROOT, '.squad-runs');
const STATE_DIR = path.join(ROOT, '.squad-state');
const TERMINAL_MAP_FILE = path.join(STATE_DIR, 'terminals.json');

const ROLE_ORDER = [
  'planner',
  'backend',
  'database',
  'frontend',
  'infra',
  'commander',
  'reviewer',
  'tester',
];

const ROLE_LABELS = {
  planner: 'Planner',
  backend: 'Backend',
  database: 'Database',
  frontend: 'Frontend',
  infra: 'Infra',
  commander: 'Commander',
  reviewer: 'Reviewer',
  tester: 'Tester',
};

const ROLE_ALIASES = {
  planner: ['planner', '플래너', '플레너', '기획'],
  backend: ['backend', '백엔드', 'api', 'server', '서버'],
  database: ['database', 'db', '데이터베이스', '디비', 'prisma'],
  frontend: ['frontend', 'front', '프론트', '화면'],
  infra: ['infra', '인프라', '배포', 'docker', 'aws'],
  commander: ['commander', '커맨더', '코만더', '지휘관', '총괄'],
  reviewer: ['reviewer', '리뷰어', '리뷰'],
  tester: ['tester', '테스터', '테스트', 'qa'],
};

const CONTEXT_FILES = [
  'ai/project-context.md',
  'ai/tech-stack.md',
  'ai/conventions.md',
  'ai/constraints.md',
  'ai/current-task.md',
];

const WORKFLOW_FILES = {
  feature: 'workflows/feature-flow.md',
  bugfix: 'workflows/bugfix-flow.md',
  release: 'workflows/release-flow.md',
};

const DEFAULT_ROLE_MODELS = {
  planner: 'gpt-5',
  backend: 'gpt-5-mini',
  database: 'gpt-5',
  frontend: 'gpt-5-mini',
  infra: 'gpt-5-mini',
  commander: 'gpt-5.5',
  reviewer: 'gpt-5',
  tester: 'gpt-5-mini',
};

function parseArgs(argv) {
  const args = {
    command: argv[2] ?? 'help',
    mode: 'auto',
    project: process.cwd(),
    roles: null,
    task: null,
    run: 'latest',
    submit: false,
    dryRun: false,
    ai: 'codex',
    model: null,
    roleModels: null,
    type: 'blank',
    name: null,
    dir: null,
    noSetup: false,
    noContext: false,
    noKickoff: false,
    approval: 'never',
    positionals: [],
  };

  for (let i = 3; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '--mode' && next) {
      args.mode = next;
      i += 1;
    } else if (arg === '--project' && next) {
      args.project = path.resolve(expandHome(next));
      i += 1;
    } else if (arg === '--roles' && next) {
      args.roles = next
        .split(',')
        .map((role) => role.trim().toLowerCase())
        .filter(Boolean);
      i += 1;
    } else if (arg === '--task' && next) {
      args.task = next;
      i += 1;
    } else if (arg === '--ai' && next) {
      args.ai = next;
      i += 1;
    } else if (arg === '--model' && next) {
      args.model = next;
      i += 1;
    } else if (arg === '--role-models' && next) {
      args.roleModels = parseRoleModels(next);
      i += 1;
    } else if (arg === '--type' && next) {
      args.type = next;
      i += 1;
    } else if (arg === '--name' && next) {
      args.name = next;
      i += 1;
    } else if (arg === '--dir' && next) {
      args.dir = path.resolve(expandHome(next));
      i += 1;
    } else if (arg === '--run' && next) {
      args.run = next;
      i += 1;
    } else if (arg === '--submit') {
      args.submit = true;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--send') {
      args.send = true;
    } else if (arg === '--no-setup') {
      args.noSetup = true;
    } else if (arg === '--no-context') {
      args.noContext = true;
    } else if (arg === '--no-kickoff') {
      args.noKickoff = true;
    } else if (arg === '--approval' && next) {
      args.approval = next;
      i += 1;
    } else if (!arg.startsWith('-')) {
      args.positionals.push(arg);
    }
  }

  if (!args.task && args.command === 'ask' && args.positionals.length) {
    args.task = args.positionals.join(' ');
  }

  return args;
}

function parseRoleModels(value) {
  const models = {};

  for (const entry of value.split(',')) {
    const [rawRole, rawModel] = entry.split('=');
    const role = rawRole?.trim().toLowerCase();
    const model = rawModel?.trim();

    if (!role || !model) {
      continue;
    }

    models[role] = model;
  }

  return models;
}

async function readText(relativePath) {
  return readFile(path.join(ROOT, relativePath), 'utf8');
}

function expandHome(value) {
  if (value === '~') {
    return os.homedir();
  }
  if (value.startsWith('~/')) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function hasAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

function inferMode(taskText, requestedMode) {
  if (requestedMode !== 'auto') {
    return requestedMode;
  }

  const text = taskText.toLowerCase();

  if (
    hasAny(text, [
      'bug',
      'fix',
      'error',
      'exception',
      'fail',
      '장애',
      '버그',
      '오류',
      '에러',
      '실패',
      '고장',
    ])
  ) {
    return 'bugfix';
  }

  if (
    hasAny(text, [
      'release',
      'deploy',
      'production',
      'staging',
      'rollback',
      '배포',
      '릴리즈',
      '운영',
      '롤백',
    ])
  ) {
    return 'release';
  }

  return 'feature';
}

function inferRoles(taskText, mode, requestedRoles) {
  if (requestedRoles?.length) {
    return normalizeRoles(requestedRoles);
  }

  const text = taskText.toLowerCase();
  const roles = new Set();

  if (mode === 'release') {
    roles.add('reviewer');
    roles.add('tester');
    roles.add('infra');
    if (mentionsDatabase(text)) {
      roles.add('database');
    }
    roles.add('commander');
    return sortRoles(roles);
  }

  if (mode === 'bugfix') {
    if (mentionsFrontend(text)) {
      roles.add('frontend');
    }
    if (mentionsDatabase(text)) {
      roles.add('database');
    }
    if (mentionsInfra(text)) {
      roles.add('infra');
    }
    if (!roles.has('frontend') && !roles.has('database') && !roles.has('infra')) {
      roles.add('backend');
    }
    roles.add('commander');
    roles.add('reviewer');
    roles.add('tester');
    return sortRoles(roles);
  }

  if (isPlanningNeeded(text)) {
    roles.add('planner');
  }
  roles.add('backend');

  if (mentionsDatabase(text)) {
    roles.add('database');
  }
  if (mentionsFrontend(text)) {
    roles.add('frontend');
  }
  if (mentionsInfra(text)) {
    roles.add('infra');
  }

  roles.add('commander');
  roles.add('reviewer');
  roles.add('tester');

  return sortRoles(roles);
}

function mentionsDatabase(text) {
  return hasAny(text, [
    'db',
    'database',
    'schema',
    'migration',
    'prisma',
    'typeorm',
    'query',
    'index',
    'table',
    'column',
    'postgres',
    'mysql',
    'mariadb',
    'mongodb',
    'redis',
    '데이터베이스',
    '마이그레이션',
    '스키마',
    '테이블',
    '컬럼',
    '인덱스',
    '쿼리',
  ]);
}

function mentionsFrontend(text) {
  return hasAny(text, [
    'frontend',
    'front',
    'react',
    'next',
    'page',
    'screen',
    'component',
    'ui',
    'ux',
    'admin page',
    '프론트',
    '화면',
    '페이지',
    '컴포넌트',
    '관리자 페이지',
  ]);
}

function mentionsInfra(text) {
  return hasAny(text, [
    'infra',
    'aws',
    'docker',
    'nginx',
    'ci',
    'cd',
    'github actions',
    'deploy',
    'release',
    'env',
    '환경변수',
    '배포',
    '인프라',
    '서버',
  ]);
}

function isPlanningNeeded(text) {
  return hasAny(text, [
    'new',
    'feature',
    'flow',
    'mvp',
    'requirements',
    'policy',
    '신규',
    '기능',
    '요구사항',
    '정책',
    '플로우',
    '기획',
  ]);
}

function normalizeRoles(roles) {
  const normalized = new Set();

  for (const role of roles) {
    if (!ROLE_ORDER.includes(role)) {
      throw new Error(`Unknown role: ${role}. Use one of: ${ROLE_ORDER.join(', ')}`);
    }
    normalized.add(role);
  }

  if (!normalized.has('commander')) {
    normalized.add('commander');
  }

  return sortRoles(normalized);
}

function sortRoles(roles) {
  return ROLE_ORDER.filter((role) => roles.has(role));
}

function makeRunId() {
  const now = new Date();
  const safeIso = now.toISOString().replaceAll(':', '').replaceAll('.', '-');
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${safeIso}-${suffix}`;
}

async function buildContextBlock(projectPath, inlineTask) {
  const contextFiles = CONTEXT_FILES.map((file) => `- ${path.join(ROOT, file)}`).join('\n');
  const taskBlock = inlineTask
    ? `\n\n추가 작업 지시:\n${inlineTask}\n`
    : '';

  return `현재 코드 프로젝트:\n- ${projectPath}\n\nAI Squad 공통 규칙:\n- ${path.join(ROOT, 'global-rules.md')}\n\n현재 프로젝트 문맥:\n${contextFiles}${taskBlock}`;
}

function rolePrompt(role, mode, projectPath, contextBlock, resultFile = null, taskText = '') {
  const implement = shouldImplement(taskText);
  const fileInstruction = resultFile
    ? `\n\n분석이 끝나면 같은 내용을 반드시 이 파일에도 저장해줘.\n- ${resultFile}\n`
    : '';
  const resultInstruction = `\n\n답변 마지막에는 아래 형식으로 짧게 정리해줘.\n- 결론\n- 영향 범위\n- 위험 요소\n- 다음 역할에게 넘길 내용\n${fileInstruction}`;

  if (role === 'commander') {
    return `~/ai-squad/global-rules.md와 ~/ai-squad/agents/commander.md를 기준으로 답변해줘.\n\n${contextBlock}\n\n작업 모드: ${mode}\n\n다른 역할 에이전트들의 결과를 취합해서 Codex에게 넘길 최종 구현 프롬프트를 만들어줘.\n아직 코드 수정은 하지 마.\n\n반드시 포함:\n- 목표\n- 작업 범위\n- 수정 파일 후보\n- 역할별 결론 요약\n- 구현 순서\n- 위험 요소\n- Codex 실행 프롬프트\n- 검증 체크리스트\n${resultInstruction}`;
  }

  if (role === 'reviewer') {
    return `~/ai-squad/global-rules.md와 ~/ai-squad/agents/reviewer.md 기준으로 이번 작업 또는 diff를 리뷰해줘.\n\n${contextBlock}\n\n코드 프로젝트 경로:\n- ${projectPath}\n\n중점:\n- 요구사항 충족 여부\n- 버그 가능성\n- 예외처리\n- 인증/권한\n- DB 정합성\n- 성능\n- 테스트 누락\n\n아직 구현 전이면 예상 리뷰 포인트를 정리하고, 구현 후라면 실제 diff 기준으로 리뷰해줘.\n${resultInstruction}`;
  }

  if (role === 'tester') {
    return `~/ai-squad/global-rules.md와 ~/ai-squad/agents/tester.md 기준으로 이번 작업의 테스트 시나리오를 작성해줘.\n\n${contextBlock}\n\n코드 프로젝트 경로:\n- ${projectPath}\n\n포함:\n- 정상 케이스\n- 예외 케이스\n- 권한 케이스\n- DB 검증\n- 회귀 테스트\n- cURL 또는 Postman 예시\n- 최종 체크리스트\n${resultInstruction}`;
  }

  if (role === 'backend' && implement) {
    return `~/ai-squad/global-rules.md와 ~/ai-squad/agents/backend.md를 기준으로 답변하고 실제 구현까지 진행해줘.\n\n${contextBlock}\n\n코드 프로젝트 경로:\n- ${projectPath}\n\n너는 이번 작업의 실제 구현 담당이다.\n반드시 해야 할 일:\n- 기존 코드 구조와 스타일을 먼저 확인한다.\n- 필요한 Controller / Service / Repository / DTO / Module / Prisma schema 변경을 실제 파일로 구현한다.\n- DB 변경이 필요하면 schema.prisma 수정과 migration 필요 여부를 결과에 명시한다.\n- 관련 없는 리팩토링은 하지 않는다.\n- 환경변수명, 인증/권한 로직, 기존 API 응답 구조는 임의 변경하지 않는다.\n- 구현 후 가능하면 타입체크/테스트/빌드 중 가능한 검증을 실행한다.\n- 변경한 파일 목록과 검증 결과를 정리한다.\n${resultInstruction}`;
  }

  return `~/ai-squad/global-rules.md와 ~/ai-squad/agents/${role}.md를 기준으로 답변해줘.\n\n${contextBlock}\n\n코드 프로젝트 경로:\n- ${projectPath}\n\n이번 작업에서 ${ROLE_LABELS[role]} 관점의 영향 범위, 수정 파일 후보, 설계 판단, 구현 순서, 위험 요소를 정리해줘.\n아직 코드는 수정하지 마.\n${resultInstruction}`;
}

function shouldImplement(taskText) {
  const text = taskText.toLowerCase();
  return hasAny(text, [
    'implement',
    'create',
    'add',
    'fix',
    'update',
    'modify',
    '구현',
    '개발',
    '추가',
    '수정',
    '고쳐',
    '만들',
  ]);
}

function makeCmuxGuide(runDir, roles) {
  const lines = [
    '# cmux paste guide',
    '',
    '아래 순서대로 각 cmux 터미널에 프롬프트 파일 내용을 붙여넣으면 된다.',
    'Commander는 마지막에 실행해서 앞선 에이전트 결과를 취합한다.',
    '',
  ];

  roles.forEach((role, index) => {
    const filename = `${String(index + 1).padStart(2, '0')}-${role}.prompt.md`;
    lines.push(`## ${ROLE_LABELS[role]}`);
    lines.push('');
    lines.push(`파일: ${path.join(runDir, filename)}`);
    lines.push('');
    lines.push('```bash');
    lines.push(`pbcopy < "${path.join(runDir, filename)}"`);
    lines.push('```');
    lines.push('');
  });

  return `${lines.join('\n')}\n`;
}

function makeCommanderCollectPrompt(runDir, roles) {
  const roleList = roles.filter((role) => role !== 'commander');
  return `~/ai-squad/global-rules.md와 ~/ai-squad/agents/commander.md를 기준으로 답변해줘.\n\n아래 역할 에이전트들의 결과를 내가 이어서 붙여넣을 거야.\n전부 받은 뒤 Codex에게 넘길 최종 구현 프롬프트를 만들어줘.\n\n대상 역할:\n${roleList.map((role) => `- ${ROLE_LABELS[role]}`).join('\n')}\n\n생성된 프롬프트 위치:\n- ${runDir}\n\n출력 형식:\n- 목표\n- 작업 범위\n- 역할별 결론 요약\n- 수정 파일 후보\n- 구현 순서\n- 위험 요소\n- Codex 실행 프롬프트\n- 검증 체크리스트\n`;
}

function projectTargetFromArgs(args) {
  const target = args.positionals[0] ?? args.name;
  if (!target) {
    return null;
  }

  if (args.dir) {
    return path.join(args.dir, target);
  }

  const expanded = expandHome(target);
  if (path.isAbsolute(expanded) || expanded.includes(path.sep)) {
    return path.resolve(expanded);
  }

  return path.join(os.homedir(), 'projects', target);
}

function projectNameFromPath(projectPath) {
  return path.basename(path.resolve(projectPath));
}

function normalizeProjectType(type) {
  const normalized = String(type ?? 'blank').toLowerCase();
  if (['blank', 'next', 'nest', 'expo'].includes(normalized)) {
    return normalized;
  }
  throw new Error('Unknown project type. Use one of: blank, next, nest, expo');
}

function techStackForType(type) {
  if (type === 'next') {
    return {
      summary: 'Next.js web application',
      content: `# Tech Stack

## Frontend

- Framework: Next.js
- Language: TypeScript
- Styling: 프로젝트 초기화 후 결정
- State Management: 프로젝트 초기화 후 결정
- API Client: 프로젝트 초기화 후 결정

## Backend

- API: Next.js Route Handlers 또는 별도 백엔드
- Database: 프로젝트 초기화 후 결정

## Infra

- Deploy: Vercel 또는 프로젝트 기준에 맞춰 결정
`,
    };
  }

  if (type === 'nest') {
    return {
      summary: 'NestJS backend application',
      content: `# Tech Stack

## Backend

- Framework: NestJS
- Language: TypeScript
- Package Manager: pnpm
- ORM: 프로젝트 초기화 후 결정
- Database: 프로젝트 초기화 후 결정
- Validation: class-validator / class-transformer
- API Docs: Swagger 필요 여부 검토

## Infra

- Deploy: 프로젝트 초기화 후 결정
`,
    };
  }

  if (type === 'expo') {
    return {
      summary: 'Expo mobile application',
      content: `# Tech Stack

## Mobile

- Framework: Expo
- Language: TypeScript
- Navigation: 프로젝트 초기화 후 결정
- State Management: 프로젝트 초기화 후 결정
- API Client: 프로젝트 초기화 후 결정

## Backend

- API: 프로젝트 초기화 후 결정

## Infra

- Build/Deploy: EAS 필요 여부 검토
`,
    };
  }

  return {
    summary: 'new software project',
    content: `# Tech Stack

## Application

- Type: Blank project
- Language: 프로젝트 초기화 후 결정
- Package Manager: 프로젝트 초기화 후 결정
- Framework: 프로젝트 초기화 후 결정

## Data

- Database: 프로젝트 초기화 후 결정

## Infra

- Deploy: 프로젝트 초기화 후 결정
`,
  };
}

function kickoffTaskForNewProject(projectPath, type) {
  const projectName = projectNameFromPath(projectPath);
  const stack = techStackForType(type);

  return `${projectName} 새 프로젝트를 시작해줘. 코드 프로젝트 경로는 ${projectPath}이고 타입은 ${type}(${stack.summary})다. 먼저 프로젝트 폴더 상태를 확인하고, 비어 있으면 적절한 초기 구조와 패키지/설정/README/검증 명령을 제안한 뒤 실제 생성까지 진행해줘. 필요한 역할에게 분석을 분배하고, 구현 담당은 기존 파일이 있으면 보존하면서 최소 변경으로 프로젝트 구성을 시작해줘.`;
}

function normalizeApproval(value) {
  const approval = String(value ?? 'never').toLowerCase();
  if (approval === 'request' || approval === 'never') {
    return approval;
  }
  throw new Error('Unknown approval mode. Use one of: request, never');
}

async function writeProjectContext(projectPath, type) {
  const projectName = projectNameFromPath(projectPath);
  const stack = techStackForType(type);

  await mkdir(path.join(ROOT, 'ai'), { recursive: true });
  await writeFile(
    path.join(ROOT, 'ai/project-context.md'),
    `# Project Context

## 프로젝트 개요

\`${projectName}\`는 ${stack.summary}다.

## 코드 프로젝트 경로

- ${projectPath}

## 주요 기능

- 프로젝트 초기화 후 Commander와 함께 정의한다.

## 주요 도메인

- 프로젝트 초기화 후 정의한다.

## 주의사항

- 기존 코드가 있으면 구조와 스타일을 먼저 확인한다.
- 관련 없는 리팩토링은 하지 않는다.
- 패키지 매니저와 프레임워크는 프로젝트 안의 파일을 기준으로 판단한다.
`,
    'utf8',
  );

  await writeFile(path.join(ROOT, 'ai/tech-stack.md'), stack.content, 'utf8');

  await writeFile(
    path.join(ROOT, 'ai/current-task.md'),
    `# Current Task

## 목표

\`${projectName}\` 프로젝트의 초기 구조와 구현 계획을 잡는다.

## 배경

새 프로젝트를 시작하기 위해 필요한 폴더 구조, 기술 선택, 구현 순서를 정리한다.

## 요구사항

- 기존 파일이 있으면 먼저 구조를 확인한다.
- 비어 있는 프로젝트라면 ${stack.summary}에 맞는 초기화 방안을 제안한다.
- 필요한 명령, 수정 파일 후보, 검증 방법을 정리한다.
- 실제 구현이 필요하면 영향 범위를 설명한 뒤 진행한다.

## 제외 범위

- 사용자가 명시하지 않은 외부 서비스 연동
- 운영 배포 설정 확정

## 참고 파일

- 프로젝트 루트 파일 전체

## 예상 영향 범위

- 초기 프로젝트 구조
- 패키지 설정
- README 또는 기본 문서
- 테스트/빌드 설정

## 완료 기준

- 프로젝트 시작에 필요한 다음 행동이 명확하다.
- 구현이 진행된 경우 실행/검증 방법이 정리되어 있다.
`,
    'utf8',
  );
}

async function newProject(args) {
  const type = normalizeProjectType(args.type);
  const approval = normalizeApproval(args.approval);
  const project = projectTargetFromArgs(args);

  if (!project) {
    throw new Error('Usage: node bin/squad.mjs new <name-or-path> [--type blank|next|nest|expo] [--dir ~/projects]');
  }

  if (args.dryRun) {
    const kickoffTask = args.noKickoff ? null : args.task ?? kickoffTaskForNewProject(project, type);
    console.log(`Would create project: ${project}`);
    console.log(`Type: ${type}`);
    console.log(`Approval: ${approval}`);
    console.log(args.noContext ? 'Context update: skipped' : 'Context update: ai/*.md');
    console.log(args.noSetup ? 'Setup: skipped' : 'Setup: dry-run');
    console.log(kickoffTask ? `Kickoff: ${kickoffTask}` : 'Kickoff: skipped');
    if (!args.noSetup) {
      await setup({ ...args, project, dryRun: true, kickoffTask, approval });
    }
    return;
  }

  await mkdir(project, { recursive: true });

  if (!args.noContext) {
    await writeProjectContext(project, type);
  }

  console.log(`Project ready: ${project}`);
  console.log(`Type: ${type}`);
  console.log(`Approval: ${approval}`);
  if (!args.noContext) {
    console.log('Updated: ai/project-context.md, ai/tech-stack.md, ai/current-task.md');
  }

  if (!args.noSetup) {
    const kickoffTask = args.noKickoff ? null : args.task ?? kickoffTaskForNewProject(project, type);
    await setup({ ...args, project, kickoffTask, approval });
  }
}

async function startProject(args) {
  const target = args.positionals[0] ?? args.project;
  const project = path.resolve(expandHome(target));
  await ensureProjectDirectory(project);
  await setup({ ...args, project, approval: normalizeApproval(args.approval) });
}

async function ensureProjectDirectory(project) {
  const info = await stat(project).catch(() => null);
  if (!info) {
    throw new Error(`Project directory not found: ${project}`);
  }
  if (!info.isDirectory()) {
    throw new Error(`Project path is not a directory: ${project}`);
  }
}

async function currentProjectFromState() {
  try {
    const state = JSON.parse(await readFile(TERMINAL_MAP_FILE, 'utf8'));
    if (state.project) {
      return path.resolve(state.project);
    }
  } catch {
    // No saved setup yet.
  }
  return null;
}

async function askSquad(args) {
  const task = args.task?.trim();
  if (!task) {
    throw new Error('Usage: node bin/squad.mjs ask "작업 내용" [--project /path/to/project]');
  }

  const project = args.project && args.project !== process.cwd()
    ? args.project
    : await currentProjectFromState() ?? process.cwd();

  await dispatch({
    ...args,
    project,
    task,
    send: true,
    submit: true,
  });
}

async function status(args) {
  const runDir = await resolveRunDir(args.run);
  const manifestPath = path.join(runDir, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const resultEntries = await readdir(path.join(runDir, 'results'), { withFileTypes: true }).catch(() => []);
  const results = resultEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name)
    .sort();

  console.log(`Run: ${runDir}`);
  console.log(`Project: ${manifest.project}`);
  console.log(`Mode: ${manifest.mode}`);
  console.log(`Roles: ${manifest.roles.join(', ')}`);
  console.log(`Results: ${results.length ? results.join(', ') : '(none yet)'}`);
}

async function dispatch(args) {
  const currentTask = await readText('ai/current-task.md');
  const inferenceText = args.task?.trim() ? args.task : stripTemplateExamples(currentTask);
  const mode = inferMode(inferenceText, args.mode);
  const roles = inferRoles(inferenceText, mode, args.roles);
  const runId = makeRunId();
  const runDir = path.join(RUNS_DIR, runId);
  const resultsDir = path.join(runDir, 'results');
  const contextBlock = await buildContextBlock(args.project, args.task);

  await mkdir(runDir, { recursive: true });
  await mkdir(resultsDir, { recursive: true });

  const workflowFile = WORKFLOW_FILES[mode];
  if (workflowFile) {
    const workflowText = await readText(workflowFile);
    await writeFile(path.join(runDir, 'workflow.md'), workflowText, 'utf8');
  }

  for (const [index, role] of roles.entries()) {
    const filename = `${String(index + 1).padStart(2, '0')}-${role}.prompt.md`;
    await writeFile(
      path.join(runDir, filename),
      rolePrompt(
        role,
        mode,
        args.project,
        contextBlock,
        path.join(resultsDir, `${role}.md`),
        inferenceText,
      ),
      'utf8',
    );
  }

  await writeFile(
    path.join(runDir, 'commander.collect.prompt.md'),
    makeCommanderCollectPrompt(runDir, roles),
    'utf8',
  );

  await writeFile(path.join(runDir, 'cmux-paste-guide.md'), makeCmuxGuide(runDir, roles), 'utf8');

  await writeFile(
    path.join(runDir, 'manifest.json'),
    `${JSON.stringify(
      {
        runId,
        mode,
        project: args.project,
        inferenceText,
        roles,
        files: roles.map((role, index) => `${String(index + 1).padStart(2, '0')}-${role}.prompt.md`),
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  console.log(`AI Squad dispatch created: ${runDir}`);
  console.log(`Mode: ${mode}`);
  console.log(`Roles: ${roles.join(', ')}`);
  console.log('');
  console.log('Next:');
  console.log(`  open ${path.join(runDir, 'cmux-paste-guide.md')}`);
  console.log(`  pbcopy < "${path.join(runDir, '01-' + roles[0] + '.prompt.md')}"`);

  if (args.send) {
    await send({ ...args, run: runDir });
  }
}

async function setup(args) {
  const project = args.project;
  const roleTabs = [
    ['planner', 'planner 플레너 노동자'],
    ['backend', 'backend 백엔드 노동자'],
    ['database', 'database DB 노동자'],
    ['frontend', 'frontend 프론트엔드 노동자'],
    ['infra', 'infra 인프라 노동자'],
    ['reviewer', 'reviewer 리뷰어 노동자'],
    ['tester', 'tester 테스터 노동자'],
    ['commander', 'commander 코만더노동자'],
  ];
  const runDir = path.join(RUNS_DIR, `setup-${makeRunId()}`);

  await mkdir(runDir, { recursive: true });

  for (const [role, title] of roleTabs) {
    const prompt = role === 'commander'
      ? commanderBootPrompt(project, args.kickoffTask)
      : workerBootPrompt(role, project);
    const promptFile = path.join(runDir, `${role}.boot.md`);
    const commandFile = path.join(runDir, `${role}.command.sh`);
    const model = modelForRole(role, args);

    await writeFile(promptFile, prompt, 'utf8');
    await writeFile(commandFile, makeStartCommand(project, title, args.ai, promptFile, args.approval, model), 'utf8');
  }

  if (args.dryRun) {
    console.log(`Setup dry-run files: ${runDir}`);
    console.log(`Models: ${roleTabs.map(([role]) => `${role}=${modelForRole(role, args)}`).join(', ')}`);
    console.log('실제 cmux 탭은 만들지 않았다.');
    return;
  }

  const result = spawnSync('osascript', ['-e', makeSetupAppleScript(roleTabs, runDir)], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 10,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || 'Failed to setup cmux squad.');
  }

  const setupMap = parseSetupMap(result.stdout);
  renameRoleWorkspaces(roleTabs, setupMap.workspaces);
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(
    TERMINAL_MAP_FILE,
    `${JSON.stringify(
      {
        project,
        createdAt: new Date().toISOString(),
        terminals: setupMap.terminals,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  console.log(result.stdout.trim());
  console.log(`Setup files: ${runDir}`);
  console.log(`Terminal map: ${TERMINAL_MAP_FILE}`);
  if (args.kickoffTask) {
    console.log('Kickoff task queued in Commander.');
  } else {
    console.log('이제 cmux의 코만더노동자 탭에 작업을 말하면 된다.');
  }
}

function makeSetupAppleScript(roleTabs, runDir) {
  return `
set terminalMap to {}
set workspaceMap to {}

tell application "cmux"
  activate
  set targetWindow to front window
${roleTabs.map(([role], index) => {
  const commandFile = path.join(runDir, `${role}.command.sh`);
  const tabExpression = index === 0 ? 'selected tab of targetWindow' : 'new tab in targetWindow';
  return `
  set currentTab to ${tabExpression}
  select tab currentTab
  set currentTerminal to focused terminal of currentTab
  set end of terminalMap to ${appleString(role)} & "=" & (id of currentTerminal)
  set end of workspaceMap to "workspace:" & ${appleString(role)} & "=" & (id of currentTab)
  set commandText to read POSIX file ${appleString(commandFile)} as «class utf8»
  input text commandText to currentTerminal
`;
}).join('\n')}
end tell

set AppleScript's text item delimiters to linefeed
set setupMapText to (terminalMap & workspaceMap) as text
set AppleScript's text item delimiters to ""

return "Created/seeded AI Squad tabs: ${roleTabs.map(([, title]) => title).join(', ')}" & linefeed & setupMapText
`;
}

function parseSetupMap(output) {
  const terminals = {};
  const workspaces = {};
  for (const line of output.split(/\r?\n/)) {
    const workspaceMatch = line.match(/^workspace:([a-z]+)=(.+)$/);
    if (workspaceMatch) {
      workspaces[workspaceMatch[1]] = workspaceMatch[2].trim();
      continue;
    }

    const terminalMatch = line.match(/^([a-z]+)=(.+)$/);
    if (terminalMatch) {
      terminals[terminalMatch[1]] = terminalMatch[2].trim();
    }
  }
  return { terminals, workspaces };
}

function renameRoleWorkspaces(roleTabs, workspaces) {
  for (const [role, title] of roleTabs) {
    const workspace = workspaces[role];
    if (!workspace) {
      continue;
    }

    const result = spawnSync('cmux', ['rename-workspace', '--workspace', workspace, title], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    });

    if (result.error || result.status !== 0) {
      const message = result.error?.message ?? result.stderr.trim() ?? 'unknown error';
      console.warn(`Workspace rename skipped for ${role}: ${message}`);
    }
  }
}

function modelForRole(role, args) {
  return args.roleModels?.[role] ?? args.model ?? DEFAULT_ROLE_MODELS[role] ?? null;
}

function makeStartCommand(project, title, ai, promptFile, approval = 'never', model = null) {
  const projectPath = shellQuote(project);
  const squadPath = shellQuote(ROOT);
  const projectsPath = shellQuote(path.join(os.homedir(), 'projects'));
  const titleText = title.replaceAll('\\', '\\\\').replaceAll("'", "'\\''");
  const approvalMode = normalizeApproval(approval);
  const codexFlags = approvalMode === 'request'
    ? `--sandbox workspace-write --ask-for-approval on-request`
    : `--dangerously-bypass-approvals-and-sandbox`;
  const modelFlag = model ? ` --model ${shellQuote(model)}` : '';
  return `cd ${projectPath}
printf '\\033]0;${titleText}\\007'
${shellQuote(ai)} ${codexFlags}${modelFlag} --cd ${projectPath} --add-dir ${squadPath} --add-dir ${projectsPath} "$(cat ${shellQuote(promptFile)})"
`;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function workerBootPrompt(role, project) {
  const roleLine = role === 'backend'
    ? '- Backend Worker는 구현 지시를 받으면 실제 파일을 수정하는 구현 담당이다.'
    : '- 구현 담당이 아니라면 코드 수정 없이 네 역할 관점의 분석/검토를 한다.';
  return `너는 AI Squad의 ${ROLE_LABELS[role]} Worker다.

기본 규칙:
- ~/ai-squad/global-rules.md를 따른다.
- ~/ai-squad/agents/${role}.md 역할을 따른다.
- 코드 프로젝트는 ${project} 이다.
- Commander가 보낸 작업을 받으면 바로 분석한다.
${roleLine}
- 결과 저장 지시가 있으면 반드시 해당 results/*.md 파일을 생성하거나 갱신한다.
- 답변은 한국어로 간단명료하게 한다.

대기 상태로 있어라. Commander가 작업을 보내면 바로 처리해라.`;
}

function commanderBootPrompt(project, kickoffTask = null) {
  const kickoffBlock = kickoffTask
    ? `
시작 작업:
- 이 세션이 준비되면 아래 작업을 사용자 추가 입력 없이 바로 시작한다.
- worker 탭들이 뜰 시간을 짧게 둔 뒤 자동 분배 명령을 실행한다.

\`\`\`bash
sleep 10
cd ~/ai-squad
node bin/squad.mjs dispatch --project ${shellQuote(project)} --task ${shellQuote(kickoffTask)} --send --submit
\`\`\`

시작 작업 내용:
${kickoffTask}
`
    : '';

  return `너는 AI Squad의 Commander다.

목표:
- 사용자가 너에게만 작업을 말하면 필요한 worker들에게 자동으로 일을 분배한다.
- worker들의 답변을 취합해 사용자에게 최종 결론만 보고한다.

자동 분배 명령:
\`\`\`bash
cd ~/ai-squad
node bin/squad.mjs dispatch --project ${shellQuote(project)} --task "사용자가 준 작업 내용" --send --submit
\`\`\`
${kickoffBlock}

운영 규칙:
1. 사용자가 새 작업을 말하면 작업을 한 문장으로 요약한다.
2. 위 자동 분배 명령을 실행해서 worker들에게 작업을 보낸다.
3. 구현/수정/추가/개발 작업이면 Backend Worker가 실제 구현 담당이다. Reviewer/Tester는 구현 이후 검토 담당이다.
4. worker 답변을 기다린 뒤 핵심만 취합한다.
5. 자동 분배 명령이 출력한 .squad-runs 경로 아래 results/*.md 파일을 읽어 worker 결과를 취합한다.
6. 구현 작업이면 프로젝트 git diff와 results/backend.md 존재 여부를 확인한다.
7. 사용자에게 구현 결과, 변경 파일, 위험 요소, 테스트 결과만 보고한다.
8. 직접 구현하지 말고 worker 결과를 검증하고 취합한다.

프로젝트:
- ${project}

참고 문서:
- ~/ai-squad/global-rules.md
- ~/ai-squad/agents/commander.md
- ~/ai-squad/ai/project-context.md
- ~/ai-squad/ai/tech-stack.md
- ~/ai-squad/ai/conventions.md
- ~/ai-squad/ai/constraints.md
- ~/ai-squad/ai/current-task.md

${kickoffTask ? '시작 작업을 바로 실행하고, 이후에는 사용자 작업 지시를 기다려라.' : '이제 사용자의 작업 지시를 기다려라.'}`;
}

function stripTemplateExamples(text) {
  return text
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith('예:') && !trimmed.startsWith('[이번에') && !trimmed.startsWith('[왜') && !trimmed.startsWith('[요구사항') && !trimmed.startsWith('[이번 작업');
    })
    .join('\n');
}

async function resolveRunDir(run) {
  if (run && run !== 'latest') {
    return path.isAbsolute(run) ? run : path.join(RUNS_DIR, run);
  }

  const entries = await readdir(RUNS_DIR, { withFileTypes: true }).catch(() => []);
  const dirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const dir of [...dirs].reverse()) {
    const runDir = path.join(RUNS_DIR, dir);
    try {
      await readFile(path.join(runDir, 'manifest.json'), 'utf8');
      return runDir;
    } catch {
      // setup runs do not have manifests.
    }
  }

  if (!dirs.length) {
    throw new Error('No squad runs found. Run dispatch first.');
  }

  throw new Error('No dispatch runs found. Run dispatch or ask first.');
}

async function send(args) {
  const runDir = await resolveRunDir(args.run);
  const manifest = JSON.parse(await readFile(path.join(runDir, 'manifest.json'), 'utf8'));
  const terminalMap = await loadTerminalMap(manifest.project);
  const rolePayloads = [];

  for (const [index, role] of manifest.roles.entries()) {
    const filename = `${String(index + 1).padStart(2, '0')}-${role}.prompt.md`;

    rolePayloads.push({
      role,
      aliases: ROLE_ALIASES[role] ?? [role],
      file: path.join(runDir, filename),
      terminalId: terminalMap[role] ?? '',
      submit: args.submit,
      dryRun: args.dryRun,
    });
  }

  const script = makeSendAppleScript(rolePayloads);
  const result = spawnSync('osascript', ['-e', script], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 10,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || 'Failed to send prompts to cmux.');
  }

  console.log(result.stdout.trim());
}

async function loadTerminalMap(project) {
  try {
    const state = JSON.parse(await readFile(TERMINAL_MAP_FILE, 'utf8'));
    if (state.project && path.resolve(state.project) !== path.resolve(project)) {
      return {};
    }
    return state.terminals ?? {};
  } catch {
    return {};
  }
}

function makeSendAppleScript(rolePayloads) {
  return `
set sentCount to 0
set missingRoles to {}
set matchedRoles to {}

tell application "cmux"
  activate
${rolePayloads.map((payload) => makeRoleAppleScript(payload)).join('\n')}
end tell

set AppleScript's text item delimiters to ", "
set missingText to missingRoles as text
set matchedText to matchedRoles as text
set AppleScript's text item delimiters to ""

return "Matched: " & matchedText & " / Sent prompts: " & sentCount & " / Missing tabs: " & missingText
`;
}

function makeRoleAppleScript({ role, aliases, file, terminalId, submit, dryRun }) {
  return `
  set targetTerminal to missing value
  set targetTabName to ""
  repeat with w in windows
    repeat with t in tabs of w
      set tabName to name of t
      repeat with term in terminals of t
        set termName to name of term
        if targetTerminal is missing value and ${appleString(terminalId)} is not "" and (id of term) is ${appleString(terminalId)} then
          set targetTerminal to term
          set targetTabName to tabName
        end if
${aliases
  .map(
    (alias) => `        if targetTerminal is missing value and termName contains ${appleString(alias)} then
          set targetTerminal to term
          set targetTabName to tabName
        end if`,
  )
  .join('\n')}
      end repeat
${aliases
  .map(
    (alias) => `      if targetTerminal is missing value and tabName contains ${appleString(alias)} then
        set targetTerminal to focused terminal of t
        set targetTabName to tabName
      end if`,
  )
  .join('\n')}
    end repeat
  end repeat

  if targetTerminal is missing value then
    set end of missingRoles to ${appleString(role)}
  else
    set end of matchedRoles to ${appleString(role)} & "->" & targetTabName
    if not ${dryRun ? 'true' : 'false'} then
      set promptText to read POSIX file ${appleString(file)} as «class utf8»
      if ${submit ? 'true' : 'false'} then
        set promptText to promptText & return
      end if
      input text promptText to targetTerminal
      set sentCount to sentCount + 1
    end if
  end if
`;
}

function appleString(value) {
  return JSON.stringify(value);
}

function help() {
  console.log(`AI Squad helper

Usage:
  squad new <name-or-path> [--type blank|next|nest|expo] [--approval request|never] [--model MODEL] [--role-models role=model,...] [--task "첫 작업"] [--dry-run]
  squad start [/path/to/project] [--approval request|never] [--model MODEL] [--role-models role=model,...] [--dry-run]
  squad ask "작업 내용" [--project /path/to/project]
  squad status [--run latest|/path/to/run]

Lower-level commands:
  node bin/squad.mjs setup [--project /path/to/project] [--ai codex] [--model MODEL] [--role-models role=model,...] [--dry-run]
  node bin/squad.mjs dispatch [--mode auto|feature|bugfix|release] [--project /path/to/project] [--roles planner,backend,database,frontend,infra,commander,reviewer,tester] [--task "extra instruction"] [--send] [--submit]
  node bin/squad.mjs send [--run latest|/path/to/run] [--dry-run] [--submit]

Examples:
  squad new my-app --type next --approval request
  squad new my-app --type next --approval never
  squad new my-app --type next --model gpt-5-mini --role-models commander=gpt-5.5,reviewer=gpt-5
  squad new mobile-app --type expo --task "Expo 앱 초기 구조 만들고 로그인 화면부터 시작" --approval never
  squad start /Users/james/daldale-api-backend --approval request
  squad ask "로그인 API 500 오류 수정"
  squad status
`);
}

const args = parseArgs(process.argv);

try {
  if (args.command === 'new') {
    await newProject(args);
  } else if (args.command === 'start') {
    await startProject(args);
  } else if (args.command === 'ask') {
    await askSquad(args);
  } else if (args.command === 'status') {
    await status(args);
  } else if (args.command === 'setup') {
    await setup(args);
  } else if (args.command === 'dispatch') {
    await dispatch(args);
  } else if (args.command === 'send') {
    await send(args);
  } else {
    help();
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
