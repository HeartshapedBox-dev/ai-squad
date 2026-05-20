#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RUNS_DIR = path.join(ROOT, '.squad-runs');

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
  };

  for (let i = 3; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '--mode' && next) {
      args.mode = next;
      i += 1;
    } else if (arg === '--project' && next) {
      args.project = path.resolve(next);
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
    } else if (arg === '--run' && next) {
      args.run = next;
      i += 1;
    } else if (arg === '--submit') {
      args.submit = true;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--send') {
      args.send = true;
    }
  }

  return args;
}

async function readText(relativePath) {
  return readFile(path.join(ROOT, relativePath), 'utf8');
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
    ['planner', '플레너 노동자'],
    ['backend', '백엔드 노동자'],
    ['database', 'DB 노동자'],
    ['reviewer', '리뷰어 노동자'],
    ['tester', '테스터 노동자'],
    ['commander', '코만더노동자'],
  ];
  const runDir = path.join(RUNS_DIR, `setup-${makeRunId()}`);

  await mkdir(runDir, { recursive: true });

  for (const [role, title] of roleTabs) {
    const prompt = role === 'commander'
      ? commanderBootPrompt(project)
      : workerBootPrompt(role, project);
    const promptFile = path.join(runDir, `${role}.boot.md`);
    const commandFile = path.join(runDir, `${role}.command.sh`);

    await writeFile(promptFile, prompt, 'utf8');
    await writeFile(commandFile, makeStartCommand(project, title, args.ai, promptFile), 'utf8');
  }

  if (args.dryRun) {
    console.log(`Setup dry-run files: ${runDir}`);
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

  console.log(result.stdout.trim());
  console.log(`Setup files: ${runDir}`);
  console.log('이제 cmux의 코만더노동자 탭에 작업을 말하면 된다.');
}

function makeSetupAppleScript(roleTabs, runDir) {
  return `
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
  set commandText to read POSIX file ${appleString(commandFile)} as «class utf8»
  input text commandText to currentTerminal
`;
}).join('\n')}
end tell

return "Created/seeded AI Squad tabs: ${roleTabs.map(([, title]) => title).join(', ')}"
`;
}

function makeStartCommand(project, title, ai, promptFile) {
  const projectPath = shellQuote(project);
  const squadPath = shellQuote(ROOT);
  const titleText = title.replaceAll('\\', '\\\\').replaceAll("'", "'\\''");
  return `cd ${projectPath}
printf '\\033]0;${titleText}\\007'
${shellQuote(ai)} --cd ${projectPath} --add-dir ${squadPath} "$(cat ${shellQuote(promptFile)})"
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

function commanderBootPrompt(project) {
  return `너는 AI Squad의 Commander다.

목표:
- 사용자가 너에게만 작업을 말하면 필요한 worker들에게 자동으로 일을 분배한다.
- worker들의 답변을 취합해 사용자에게 최종 결론만 보고한다.

자동 분배 명령:
\`\`\`bash
cd ~/ai-squad
node bin/squad.mjs dispatch --project ${project} --task "사용자가 준 작업 내용" --send --submit
\`\`\`

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

이제 사용자의 작업 지시를 기다려라.`;
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

  if (!dirs.length) {
    throw new Error('No squad runs found. Run dispatch first.');
  }

  return path.join(RUNS_DIR, dirs.at(-1));
}

async function send(args) {
  const runDir = await resolveRunDir(args.run);
  const manifest = JSON.parse(await readFile(path.join(runDir, 'manifest.json'), 'utf8'));
  const rolePayloads = [];

  for (const [index, role] of manifest.roles.entries()) {
    const filename = `${String(index + 1).padStart(2, '0')}-${role}.prompt.md`;

    rolePayloads.push({
      role,
      aliases: ROLE_ALIASES[role] ?? [role],
      file: path.join(runDir, filename),
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

function makeRoleAppleScript({ role, aliases, file, submit, dryRun }) {
  return `
  set targetTerminal to missing value
  set targetTabName to ""
  repeat with w in windows
    repeat with t in tabs of w
      set tabName to name of t
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
  console.log(`AI Squad helper\n\nUsage:\n  node bin/squad.mjs setup [--project /path/to/project] [--ai codex] [--dry-run]\n  node bin/squad.mjs dispatch [--mode auto|feature|bugfix|release] [--project /path/to/project] [--roles backend,database,commander,reviewer,tester] [--task "extra instruction"] [--send] [--submit]\n  node bin/squad.mjs send [--run latest|/path/to/run] [--dry-run] [--submit]\n\nExamples:\n  node bin/squad.mjs setup --project /Users/james/daldale-api-backend --dry-run\n  node bin/squad.mjs setup --project /Users/james/daldale-api-backend\n  node bin/squad.mjs dispatch --project /Users/james/daldale-api-backend\n  node bin/squad.mjs dispatch --mode bugfix --roles backend,reviewer,tester --task "로그인 API 500 오류 수정"\n  node bin/squad.mjs send --run latest --dry-run\n  node bin/squad.mjs send --run latest --submit\n`);
}

const args = parseArgs(process.argv);

try {
  if (args.command === 'setup') {
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
