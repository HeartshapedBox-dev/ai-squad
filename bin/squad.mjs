#!/usr/bin/env node

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RUNS_DIR = path.join(ROOT, '.squad-runs');
const STATE_DIR = path.join(ROOT, '.squad-state');
const TERMINAL_MAP_FILE = path.join(STATE_DIR, 'terminals.json');
const CMUX_CLI = '/Applications/cmux.app/Contents/Resources/bin/cmux';

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
  planner: 'gpt-5.4-mini',
  backend: 'gpt-5.4-mini',
  database: 'gpt-5.4-mini',
  frontend: 'gpt-5.4-mini',
  infra: 'gpt-5.4-mini',
  commander: 'gpt-5.5',
  reviewer: 'gpt-5.4-mini',
  tester: 'gpt-5.4-mini',
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
    wait: false,
    waitTimeout: 900,
    includeCommander: false,
    dryRun: false,
    ai: 'codex',
    model: null,
    roleModels: null,
    workspace: null,
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
    } else if (arg === '--workspace' && next) {
      args.workspace = path.resolve(expandHome(next));
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
    } else if (arg === '--wait') {
      args.wait = true;
    } else if (arg === '--wait-timeout' && next) {
      args.waitTimeout = Number(next);
      i += 1;
    } else if (arg === '--include-commander') {
      args.includeCommander = true;
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

async function resolveWorkspace(args) {
  if (args.workspace) {
    return loadWorkspaceFile(args.workspace);
  }

  const project = path.resolve(expandHome(args.project ?? process.cwd()));
  const inferred = await inferWorkspaceFromProject(project);
  if (inferred) {
    return inferred;
  }

  return {
    source: null,
    primaryProject: project,
    projects: { default: project },
    roleProjects: Object.fromEntries(ROLE_ORDER.map((role) => [role, 'default'])),
  };
}

async function inferWorkspaceFromProject(project) {
  const boundaries = await discoverProjectBoundaries(project);
  const frontendRoot = chooseBoundaryRoot(boundaries.frontend_roots);
  const backendRoot = chooseBoundaryRoot(boundaries.backend_roots);
  const dataRoot = chooseBoundaryRoot([...boundaries.data_roots, ...boundaries.migration_roots]);
  const infraRoot = chooseBoundaryRoot(boundaries.infra_roots);

  if (!frontendRoot || !backendRoot || frontendRoot === backendRoot) {
    return null;
  }

  const projects = {
    root: project,
    backend: path.join(project, backendRoot),
    frontend: path.join(project, frontendRoot),
  };

  if (dataRoot && dataRoot !== backendRoot) {
    projects.database = path.join(project, dataRoot);
  }
  if (infraRoot && infraRoot !== backendRoot && infraRoot !== frontendRoot) {
    projects.infra = path.join(project, infraRoot);
  }

  return {
    source: null,
    inferred: true,
    primaryProject: project,
    primaryProjectKey: 'root',
    projects,
    roleProjects: {
      planner: 'root',
      backend: 'backend',
      database: projects.database ? 'database' : 'backend',
      frontend: 'frontend',
      infra: projects.infra ? 'infra' : 'root',
      commander: 'root',
      reviewer: 'root',
      tester: 'root',
    },
  };
}

function chooseBoundaryRoot(roots) {
  const candidates = unique(roots)
    .filter((root) => root && root !== '.' && root !== 'package.json')
    .sort((a, b) => {
      const depthDiff = a.split('/').length - b.split('/').length;
      return depthDiff || a.localeCompare(b);
    });
  return candidates[0] ?? null;
}

async function loadWorkspaceFile(workspacePath) {
  const source = path.resolve(expandHome(workspacePath));
  const baseDir = path.dirname(source);
  const raw = JSON.parse(await readFile(source, 'utf8'));
  const rawProjects = raw.projects ?? {};
  const projects = {};

  for (const [name, projectPath] of Object.entries(rawProjects)) {
    projects[name] = resolveWorkspacePath(projectPath, baseDir);
  }

  if (!Object.keys(projects).length) {
    throw new Error(`Workspace file has no projects: ${source}`);
  }

  const primaryProjectKey = raw.primary_project
    ?? raw.primaryProject
    ?? raw.default_project
    ?? raw.defaultProject
    ?? Object.keys(projects)[0];

  if (!projects[primaryProjectKey]) {
    throw new Error(`Workspace primary project not found: ${primaryProjectKey}`);
  }

  const rawRoleProjects = raw.role_projects ?? raw.roleProjects ?? raw.roles ?? {};
  const roleProjects = {};

  for (const role of ROLE_ORDER) {
    const roleConfig = rawRoleProjects[role];
    const projectKey = typeof roleConfig === 'string'
      ? roleConfig
      : roleConfig?.project ?? primaryProjectKey;

    if (!projects[projectKey]) {
      throw new Error(`Workspace role "${role}" points to unknown project "${projectKey}"`);
    }
    roleProjects[role] = projectKey;
  }

  return {
    source,
    primaryProject: projects[primaryProjectKey],
    primaryProjectKey,
    projects,
    roleProjects,
  };
}

function resolveWorkspacePath(value, baseDir) {
  const expanded = expandHome(String(value));
  return path.resolve(path.isAbsolute(expanded) ? expanded : path.join(baseDir, expanded));
}

function projectForRole(workspace, role) {
  const projectKey = workspace.roleProjects[role] ?? workspace.primaryProjectKey ?? 'default';
  return workspace.projects[projectKey] ?? workspace.primaryProject;
}

function workspaceProjectDirs(workspace) {
  return unique(Object.values(workspace.projects).map((projectPath) => path.resolve(projectPath)));
}

function isRoleScopedWorkspace(workspace) {
  return Boolean(workspace.source || workspace.inferred);
}

function workspaceForManifest(workspace) {
  return {
    source: workspace.source,
    inferred: Boolean(workspace.inferred),
    primaryProject: workspace.primaryProject,
    primaryProjectKey: workspace.primaryProjectKey ?? 'default',
    projects: workspace.projects,
    roleProjects: workspace.roleProjects,
  };
}

function workspaceDispatchFlag(workspace) {
  return workspace.source
    ? `--workspace ${shellQuote(workspace.source)}`
    : `--project ${shellQuote(workspace.primaryProject)}`;
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
  if (mentionsAllAgents(text)) {
    return ROLE_ORDER;
  }

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
    if (mentionsReview(text)) {
      roles.add('reviewer');
    }
    if (mentionsTesting(text)) {
      roles.add('tester');
    }
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
  if (mentionsReview(text)) {
    roles.add('reviewer');
  }
  if (mentionsTesting(text)) {
    roles.add('tester');
  }

  return sortRoles(roles);
}

function mentionsAllAgents(text) {
  return hasAny(text, [
    'all agents',
    'all workers',
    'every agent',
    'all roles',
    'fanout',
    'fan out',
    '7 agents',
    '7 workers',
    '전체 에이전트',
    '모든 에이전트',
    '전체 worker',
    '전체 워커',
    '모든 워커',
    '모든 역할',
    '7개 에이전트',
    '7개 워커',
    '전부 전달',
    '전체 전달',
  ]);
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
    'requirements',
    'policy',
    'plan',
    'planning',
    'architecture',
    'design',
    'roadmap',
    '요구사항',
    '정책',
    '계획',
    '설계',
    '기획',
    '아키텍처',
    '로드맵',
    '플랜',
    '정리해',
  ]);
}

function mentionsReview(text) {
  return hasAny(text, [
    'review',
    'reviewer',
    'audit',
    '검토',
    '리뷰',
    '리뷰어',
    '감사',
  ]);
}

function mentionsTesting(text) {
  return hasAny(text, [
    'test',
    'tests',
    'testing',
    'tester',
    'qa',
    'verify',
    'verification',
    'validation',
    'curl',
    'postman',
    '테스트',
    '테스터',
    '검증',
    '확인',
    'qa',
    '시나리오',
    '회귀',
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

const BOUNDARY_IGNORE_DIRS = new Set([
  '.git',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.squad-runs',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'target',
]);

async function discoverProjectBoundaries(projectPath) {
  const files = await listProjectFiles(projectPath, 4, 2500).catch(() => []);
  const boundaries = {
    frontend_roots: new Set(),
    backend_roots: new Set(),
    data_roots: new Set(),
    migration_roots: new Set(),
    contract_roots: new Set(),
    test_roots: new Set(),
    shared_roots: new Set(),
    infra_roots: new Set(),
    config_files: new Set(),
    generated_roots: new Set(),
  };

  for (const file of files) {
    const normalized = file.replaceAll('\\', '/');
    const segments = normalized.split('/');
    const basename = segments.at(-1) ?? '';
    const lower = normalized.toLowerCase();

    if (isConfigFile(basename)) {
      boundaries.config_files.add(normalized);
    }
    if (isGeneratedPath(lower)) {
      boundaries.generated_roots.add(rootAtSegment(segments, ['generated', '__generated__', '.gen']) ?? topRoot(segments));
    }
    if (isTestPath(lower, basename)) {
      boundaries.test_roots.add(rootAtSegment(segments, ['test', 'tests', '__tests__', 'spec', 'e2e']) ?? topRoot(segments));
    }
    if (isDataPath(lower, basename, segments)) {
      boundaries.data_roots.add(rootAtSegment(segments, ['prisma', 'db', 'database', 'migrations', 'schema']) ?? topRoot(segments));
    }
    if (lower.includes('/migrations/') || segments.includes('migrations')) {
      boundaries.migration_roots.add(rootAtSegment(segments, ['migrations']) ?? topRoot(segments));
    }
    if (isContractPath(lower, basename, segments)) {
      boundaries.contract_roots.add(rootAtSegment(segments, ['proto', 'protos', 'contracts', 'schema', 'graphql']) ?? topRoot(segments));
    }
    if (isSharedPath(segments)) {
      boundaries.shared_roots.add(rootAtSegment(segments, ['shared', 'common', 'types', 'dto', 'packages']) ?? topRoot(segments));
    }
    if (isInfraPath(lower, basename, segments)) {
      boundaries.infra_roots.add(rootAtSegment(segments, ['infra', 'infrastructure', 'deploy', 'k8s', 'helm', '.github']) ?? topRoot(segments));
    }
    if (isFrontendPath(lower, basename, segments)) {
      boundaries.frontend_roots.add(frontendRoot(segments));
    }
    if (isBackendPath(lower, basename, segments)) {
      boundaries.backend_roots.add(backendRoot(segments));
    }
  }

  return Object.fromEntries(
    Object.entries(boundaries).map(([key, value]) => [key, [...value].filter(Boolean).sort()]),
  );
}

async function listProjectFiles(projectPath, maxDepth, maxEntries) {
  const files = [];

  async function walk(dir, depth) {
    if (files.length >= maxEntries || depth > maxDepth) {
      return;
    }

    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (files.length >= maxEntries) {
        return;
      }

      const absolute = path.join(dir, entry.name);
      const relative = path.relative(projectPath, absolute);
      if (!relative || relative.startsWith('..')) {
        continue;
      }

      if (entry.isDirectory()) {
        if (!BOUNDARY_IGNORE_DIRS.has(entry.name)) {
          await walk(absolute, depth + 1);
        }
        continue;
      }

      if (entry.isFile()) {
        files.push(relative);
      }
    }
  }

  await walk(projectPath, 0);
  return files;
}

function isConfigFile(basename) {
  return [
    'package.json',
    'pnpm-lock.yaml',
    'package-lock.json',
    'yarn.lock',
    'tsconfig.json',
    'next.config.js',
    'next.config.mjs',
    'vite.config.js',
    'vite.config.ts',
    'docker-compose.yml',
    'docker-compose.yaml',
    'Dockerfile',
  ].includes(basename);
}

function isGeneratedPath(lower) {
  return lower.includes('/generated/')
    || lower.includes('/__generated__/')
    || lower.includes('/.gen/')
    || lower.endsWith('.generated.ts')
    || lower.endsWith('.generated.tsx');
}

function isTestPath(lower, basename) {
  return lower.includes('/__tests__/')
    || lower.includes('/test/')
    || lower.includes('/tests/')
    || lower.includes('/spec/')
    || lower.includes('/e2e/')
    || basename.endsWith('.test.ts')
    || basename.endsWith('.test.tsx')
    || basename.endsWith('.spec.ts')
    || basename.endsWith('.spec.tsx');
}

function isDataPath(lower, basename, segments) {
  return segments.includes('prisma')
    || segments.includes('database')
    || segments.includes('migrations')
    || basename === 'schema.prisma'
    || lower.endsWith('.migration.ts')
    || lower.endsWith('.entity.ts')
    || lower.endsWith('.model.ts');
}

function isContractPath(lower, basename, segments) {
  return segments.includes('proto')
    || segments.includes('protos')
    || segments.includes('contracts')
    || lower.includes('openapi')
    || lower.includes('swagger')
    || basename.endsWith('.proto')
    || basename.endsWith('.graphql')
    || basename.endsWith('.gql');
}

function isSharedPath(segments) {
  return segments.some((segment) => ['shared', 'common', 'types', 'dto', 'packages'].includes(segment));
}

function isInfraPath(lower, basename, segments) {
  return segments.some((segment) => ['infra', 'infrastructure', 'deploy', 'k8s', 'helm', '.github'].includes(segment))
    || basename === 'Dockerfile'
    || lower.includes('docker-compose')
    || lower.endsWith('.tf')
    || lower.endsWith('.yaml') && lower.includes('/k8s/');
}

function isFrontendPath(lower, basename, segments) {
  return segments.some((segment) => ['frontend', 'front', 'client', 'web', 'pages', 'components'].includes(segment))
    || basename.startsWith('next.config.')
    || basename.startsWith('vite.config.')
    || lower.includes('/app/')
    || lower.includes('/src/app/')
    || lower.includes('/src/pages/')
    || lower.includes('/src/components/')
    || lower.endsWith('.tsx')
    || lower.endsWith('.jsx');
}

function isBackendPath(lower, basename, segments) {
  return segments.some((segment) => ['backend', 'server', 'api'].includes(segment))
    || basename.endsWith('.controller.ts')
    || basename.endsWith('.service.ts')
    || basename.endsWith('.resolver.ts')
    || basename.endsWith('.module.ts')
    || lower.includes('/routes/')
    || lower.includes('/controllers/')
    || lower.includes('/services/');
}

function frontendRoot(segments) {
  if (segments[0] === 'src' && ['app', 'pages', 'components'].includes(segments[1])) {
    return segments.slice(0, 2).join('/');
  }
  return rootAtSegment(segments, ['frontend', 'front', 'client', 'web']) ?? topRoot(segments);
}

function backendRoot(segments) {
  if (segments[0] === 'src' && ['controllers', 'services', 'routes', 'api'].includes(segments[1])) {
    return segments.slice(0, 2).join('/');
  }
  if (segments[0] === 'src') {
    return 'src';
  }
  return rootAtSegment(segments, ['backend', 'server', 'api']) ?? topRoot(segments);
}

function rootAtSegment(segments, names) {
  const index = segments.findIndex((segment) => names.includes(segment));
  if (index === -1) {
    return null;
  }
  return segments.slice(0, index + 1).join('/');
}

function topRoot(segments) {
  if (segments.length >= 2 && ['apps', 'packages', 'services'].includes(segments[0])) {
    return segments.slice(0, 2).join('/');
  }
  return segments[0] ?? '.';
}

function makeRoleScopeContract(role, boundaries, roleProject, workspace) {
  const exclusive = unique([
    ...boundaries.migration_roots,
    ...boundaries.data_roots,
    ...boundaries.contract_roots,
    ...boundaries.generated_roots,
    ...boundaries.config_files,
  ]);
  const allowed = allowedPathsForRole(role, boundaries);
  const denied = deniedPathsForRole(role, boundaries, exclusive);

  return [
    'Worker Scope Contract:',
    '- 이 범위는 현재 프로젝트를 dispatch 시점에 스캔해 만든 동적 경계다. 경로가 비어 있거나 부정확해 보이면 먼저 프로젝트 구조를 확인하고 결과 파일에 보정안을 적어라.',
    '- allowed_paths 밖 파일은 수정하지 마라. 필요한 변경이 있으면 "cross-boundary request"로 파일과 이유만 보고해라.',
    '- assigned_project 밖 다른 프로젝트는 수정하지 마라. 다른 프로젝트 변경이 필요하면 cross-project request로 보고해라.',
    '- exclusive_artifacts는 한 작업에서 단일 owner만 수정한다. Commander가 명시하지 않았으면 직접 수정하지 마라.',
    '- 결과 파일에는 changed_files, skipped_cross_boundary_changes, verification을 반드시 적어라.',
    '',
    `role: ${role}`,
    `assigned_project: ${roleProject}`,
    `workspace_projects:\n${formatList(workspaceProjectDirs(workspace))}`,
    `allowed_paths:\n${formatList(allowed)}`,
    `denied_paths:\n${formatList(denied)}`,
    `denied_projects:\n${formatList(workspaceProjectDirs(workspace).filter((projectPath) => path.resolve(projectPath) !== path.resolve(roleProject)))}`,
    `exclusive_artifacts:\n${formatList(exclusive)}`,
    '',
    'Repo Boundary Map:',
    JSON.stringify(boundaries, null, 2),
  ].join('\n');
}

function makeHandoffContract(role, handoffDir) {
  const writes = handoffFilesForRole(role, handoffDir);
  const reads = handoffReadFilesForRole(role, handoffDir);

  return [
    'Handoff Contract:',
    '- 다른 역할이나 다른 프로젝트의 수정이 필요하면 상대 프로젝트를 직접 수정하지 말고 handoff 파일에 기록해라.',
    '- API request/response, route, validation, shared type, env, generated client 변경은 contract.md에 기록해라.',
    '- handoff에는 changed_files, requested_changes, contract_changes, verification_notes를 짧고 구체적으로 적어라.',
    '- 구현 전에 read_files에 내용이 있으면 먼저 읽고, 그 계약에 맞춰 자기 assigned_project 안에서만 수정해라.',
    '',
    `handoff_dir: ${handoffDir}`,
    `write_files:\n${formatList(writes)}`,
    `read_files:\n${formatList(reads)}`,
  ].join('\n');
}

function handoffFilesForRole(role, handoffDir) {
  if (role === 'frontend') {
    return [
      path.join(handoffDir, 'frontend-to-backend.md'),
      path.join(handoffDir, 'contract.md'),
    ];
  }
  if (role === 'backend') {
    return [
      path.join(handoffDir, 'backend-to-frontend.md'),
      path.join(handoffDir, 'contract.md'),
    ];
  }
  if (role === 'database') {
    return [
      path.join(handoffDir, 'database-to-backend.md'),
      path.join(handoffDir, 'contract.md'),
    ];
  }
  if (role === 'tester') {
    return [
      path.join(handoffDir, 'tester-notes.md'),
    ];
  }
  return [
    path.join(handoffDir, `${role}-notes.md`),
  ];
}

function handoffReadFilesForRole(role, handoffDir) {
  if (role === 'frontend') {
    return [
      path.join(handoffDir, 'backend-to-frontend.md'),
      path.join(handoffDir, 'contract.md'),
    ];
  }
  if (role === 'backend') {
    return [
      path.join(handoffDir, 'frontend-to-backend.md'),
      path.join(handoffDir, 'database-to-backend.md'),
      path.join(handoffDir, 'contract.md'),
    ];
  }
  if (role === 'database') {
    return [
      path.join(handoffDir, 'backend-to-database.md'),
      path.join(handoffDir, 'contract.md'),
    ];
  }
  if (role === 'tester') {
    return [
      path.join(handoffDir, 'backend-to-frontend.md'),
      path.join(handoffDir, 'frontend-to-backend.md'),
      path.join(handoffDir, 'database-to-backend.md'),
      path.join(handoffDir, 'contract.md'),
    ];
  }
  return [
    path.join(handoffDir, 'contract.md'),
  ];
}

function initialHandoffFile(name) {
  return `# ${name}

작업 중 다른 역할에게 넘길 계약/요청이 있으면 이 파일에 추가한다.

## Entries

- 없음
`;
}

async function writeInitialHandoffFiles(handoffDir) {
  const files = [
    'backend-to-frontend.md',
    'frontend-to-backend.md',
    'backend-to-database.md',
    'database-to-backend.md',
    'contract.md',
    'tester-notes.md',
  ];

  for (const file of files) {
    const title = file === 'contract.md'
      ? 'Contract'
      : file.replace('.md', '');
    await writeFile(path.join(handoffDir, file), initialHandoffFile(title), 'utf8');
  }
}

function allowedPathsForRole(role, boundaries) {
  if (role === 'frontend') {
    return unique([...boundaries.frontend_roots, ...boundaries.test_roots]);
  }
  if (role === 'backend') {
    return unique([...boundaries.backend_roots, ...boundaries.test_roots]);
  }
  if (role === 'database') {
    return unique([...boundaries.data_roots, ...boundaries.migration_roots]);
  }
  if (role === 'infra') {
    return unique([...boundaries.infra_roots]);
  }
  if (role === 'tester') {
    return unique([...boundaries.test_roots]);
  }
  return [];
}

function deniedPathsForRole(role, boundaries, exclusive) {
  if (['commander', 'planner', 'reviewer'].includes(role)) {
    return ['*'];
  }

  const roleOwned = new Set(allowedPathsForRole(role, boundaries));
  return unique([
    ...boundaries.frontend_roots,
    ...boundaries.backend_roots,
    ...boundaries.data_roots,
    ...boundaries.migration_roots,
    ...boundaries.contract_roots,
    ...boundaries.infra_roots,
    ...exclusive,
  ]).filter((item) => !roleOwned.has(item));
}

function formatList(items) {
  return items.length ? items.map((item) => `- ${item}`).join('\n') : '- (none detected; treat as read-only until Commander grants exact paths)';
}

function unique(items) {
  return [...new Set(items.filter(Boolean))].sort();
}

function rolePrompt(role, mode, projectPath, contextBlock = '', resultFile = null, taskText = '', runId = '') {
  const implement = shouldImplement(taskText);
  const resultInstruction = resultFile
    ? `결과 저장: ${resultFile}\n결과 파일 첫 줄: 작업 ID: ${runId}`
    : '결과 파일 저장 없음';
  const boundaryInstruction = contextBlock
    ? `\n\n${contextBlock}`
    : '';

  const base = [
    `작업 ID: ${runId}`,
    `작업 모드: ${mode}`,
    `프로젝트: ${projectPath}`,
    `작업: ${taskText}`,
    resultInstruction,
    '',
    '작업 전 반드시 부팅 때 안내받은 global-rules.md와 agents/<role>.md를 확인하고, 위반 가능성이 있으면 중단해라.',
    '필요하면 부팅 때 안내받은 규칙/역할/프로젝트 문맥 파일을 읽어라.',
    '답변과 결과 파일 마지막에는 결론, 영향 범위, 위험 요소, 다음 역할에게 넘길 내용을 짧게 정리해라.',
  ].join('\n') + boundaryInstruction;

  if (role === 'commander') {
    return `${base}\n\nCommander 역할: worker 결과를 취합해서 최종 구현 프롬프트와 검증 체크리스트를 만들어라. 직접 코드 수정은 하지 마라. worker별 changed_files가 허용 범위를 벗어났거나 exclusive artifact를 여러 worker가 수정했으면 merge하지 말고 재분배해라.`;
  }

  if (role === 'reviewer') {
    return `${base}\n\nReviewer 역할: 요구사항, 버그 가능성, 예외처리, 인증/권한, DB 정합성, 성능, 테스트 누락 관점으로 리뷰해라.`;
  }

  if (role === 'tester') {
    return `${base}\n\nTester 역할: 정상/예외/권한/DB/회귀 테스트 시나리오와 실행 체크리스트를 작성해라.`;
  }

  if (role === 'backend' && implement) {
    return `${base}\n\nBackend 역할: 실제 구현 담당이다. 기존 구조를 확인하고 최소 변경으로 구현해라. 단, 아래 Worker Scope Contract의 allowed_paths 밖 파일은 수정하지 말고 필요한 변경을 보고만 해라. DB schema/migration/API contract/generated/lockfile 변경은 Commander가 별도 승인하지 않았으면 직접 만들지 마라. 검증 명령과 변경 파일을 결과에 명시해라.`;
  }

  if (role === 'frontend' && implement) {
    return `${base}\n\nFrontend 역할: 실제 구현 담당이다. 기존 UI 구조와 스타일을 확인하고 최소 변경으로 구현해라. 단, 아래 Worker Scope Contract의 allowed_paths 밖 파일은 수정하지 말고 필요한 변경을 보고만 해라. API/server/DB schema/migration/API contract/generated/lockfile 변경은 Commander가 별도 승인하지 않았으면 직접 만들지 마라. 컴포넌트, 페이지, 스타일, 상태 처리 변경과 검증 명령을 결과에 명시해라.`;
  }

  if (['backend', 'frontend'].includes(role)) {
    return `${base}\n\n${ROLE_LABELS[role]} 역할: 네 관점의 영향 범위, 수정 파일 후보, 설계 판단, 구현 순서, 위험 요소를 정리해라. 구현 지시가 명확하면 실제 코드 수정까지 진행할 수 있지만, 아래 Worker Scope Contract의 allowed_paths 밖 파일은 수정하지 마라.`;
  }

  return `${base}\n\n${ROLE_LABELS[role]} 역할: 네 관점의 영향 범위, 수정 파일 후보, 설계 판단, 구현 순서, 위험 요소를 정리해라. 직접 코드는 수정하지 마라.`;
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

function makeCommanderCollectPrompt(runDir, roles, handoffDir) {
  const roleList = roles.filter((role) => role !== 'commander');
  return `${path.join(ROOT, 'global-rules.md')}와 ${path.join(ROOT, 'agents/commander.md')}를 기준으로 답변해줘.\n\n아래 역할 에이전트들의 결과를 내가 이어서 붙여넣을 거야.\n전부 받은 뒤 Codex에게 넘길 최종 구현 프롬프트를 만들어줘.\n\n대상 역할:\n${roleList.map((role) => `- ${ROLE_LABELS[role]}`).join('\n')}\n\n생성된 프롬프트 위치:\n- ${runDir}\n\nHandoff 위치:\n- ${handoffDir}\n\n출력 형식:\n- 목표\n- 작업 범위\n- 역할별 결론 요약\n- Handoff 요약\n- Contract 변경\n- 수정 파일 후보\n- 구현 순서\n- Ownership plan\n- Exclusive artifact owner\n- 위험 요소\n- Codex 실행 프롬프트\n- 검증 체크리스트\n\n취합 규칙:\n- manifest.json과 각 worker prompt의 Worker Scope Contract를 확인해라.\n- ${handoffDir} 아래의 handoff 파일을 반드시 읽고, 상대 역할에 넘겨야 할 요청이 있으면 후속 분배 지시를 작성해라.\n- worker 결과의 changed_files가 allowed_paths 안에 있는지 확인해라.\n- allowed_paths 밖 수정, migration/schema/API contract/generated/lockfile 중복 수정, 같은 심볼 중복 구현이 있으면 merge 금지와 재분배 지시를 넣어라.\n- DB schema/migration, API contract, generated file, lockfile은 단일 owner만 수정하게 해라.\n- contract.md에 API/타입/환경변수 변경이 있으면 backend/frontend/database/tester 중 필요한 다음 역할을 순차로 다시 호출해라.\n`;
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
  if (args.workspace) {
    const workspace = await resolveWorkspace(args);
    for (const projectPath of workspaceProjectDirs(workspace)) {
      await ensureProjectDirectory(projectPath);
    }
    await setup({ ...args, approval: normalizeApproval(args.approval) });
    return;
  }

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
    if (state.workspace?.primaryProject) {
      return path.resolve(state.workspace.primaryProject);
    }
    if (state.project) {
      return path.resolve(state.project);
    }
  } catch {
    // No saved setup yet.
  }
  return null;
}

async function currentWorkspaceSourceFromState() {
  try {
    const state = JSON.parse(await readFile(TERMINAL_MAP_FILE, 'utf8'));
    return state.workspace?.source ?? null;
  } catch {
    return null;
  }
}

async function askSquad(args) {
  const task = args.task?.trim();
  if (!task) {
    throw new Error('Usage: node bin/squad.mjs ask "작업 내용" [--project /path/to/project]');
  }

  const project = args.project && args.project !== process.cwd()
    ? args.project
    : await currentProjectFromState() ?? process.cwd();
  const workspace = args.workspace ?? await currentWorkspaceSourceFromState();

  await dispatch({
    ...args,
    workspace,
    project,
    task,
    send: true,
    submit: true,
    wait: true,
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
  console.log(`Project: ${manifest.project ?? manifest.workspace?.primaryProject}`);
  if (manifest.workspace?.source) {
    console.log(`Workspace: ${manifest.workspace.source}`);
  }
  console.log(`Mode: ${manifest.mode}`);
  console.log(`Roles: ${manifest.roles.join(', ')}`);
  console.log(`Results: ${results.length ? results.join(', ') : '(none yet)'}`);
}

async function dispatch(args) {
  const workspace = await resolveWorkspace(args);
  const currentTask = await readText('ai/current-task.md');
  const inferenceText = args.task?.trim() ? args.task : stripTemplateExamples(currentTask);
  const mode = inferMode(inferenceText, args.mode);
  const roles = inferRoles(inferenceText, mode, args.roles);
  const runId = makeRunId();
  const runDir = path.join(RUNS_DIR, runId);
  const resultsDir = path.join(runDir, 'results');
  const handoffDir = path.join(runDir, 'handoff');
  const boundariesByProject = {};

  for (const projectPath of workspaceProjectDirs(workspace)) {
    boundariesByProject[projectPath] = await discoverProjectBoundaries(projectPath);
  }

  await mkdir(runDir, { recursive: true });
  await mkdir(resultsDir, { recursive: true });
  await mkdir(handoffDir, { recursive: true });
  await writeInitialHandoffFiles(handoffDir);

  const workflowFile = WORKFLOW_FILES[mode];
  if (workflowFile) {
    const workflowText = await readText(workflowFile);
    await writeFile(path.join(runDir, 'workflow.md'), workflowText, 'utf8');
  }

  for (const [index, role] of roles.entries()) {
    const filename = `${String(index + 1).padStart(2, '0')}-${role}.prompt.md`;
    const roleProject = projectForRole(workspace, role);
    const boundaries = boundariesByProject[roleProject] ?? await discoverProjectBoundaries(roleProject);
    await writeFile(
      path.join(runDir, filename),
      rolePrompt(
        role,
        mode,
        roleProject,
        [
          makeRoleScopeContract(role, boundaries, roleProject, workspace),
          makeHandoffContract(role, handoffDir),
        ].join('\n\n'),
        path.join(resultsDir, `${role}.md`),
        inferenceText,
        runId,
      ),
      'utf8',
    );
  }

  await writeFile(
    path.join(runDir, 'commander.collect.prompt.md'),
    makeCommanderCollectPrompt(runDir, roles, handoffDir),
    'utf8',
  );

  await writeFile(path.join(runDir, 'cmux-paste-guide.md'), makeCmuxGuide(runDir, roles), 'utf8');

  await writeFile(
    path.join(runDir, 'manifest.json'),
    `${JSON.stringify(
      {
        runId,
        mode,
        project: workspace.primaryProject,
        workspace: workspaceForManifest(workspace),
        inferenceText,
        roles,
        handoffDir,
        boundariesByProject,
        roleProjects: Object.fromEntries(roles.map((role) => [role, projectForRole(workspace, role)])),
        files: roles.map((role, index) => `${String(index + 1).padStart(2, '0')}-${role}.prompt.md`),
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  console.log(`AI Squad dispatch created: ${runDir}`);
  if (workspace.source) {
    console.log(`Workspace: ${workspace.source}`);
  }
  console.log(`Mode: ${mode}`);
  console.log(`Roles: ${roles.join(', ')}`);
  console.log('');
  console.log('Next:');
  console.log(`  open ${path.join(runDir, 'cmux-paste-guide.md')}`);
  console.log(`  pbcopy < "${path.join(runDir, '01-' + roles[0] + '.prompt.md')}"`);

  if (args.send) {
    await send({ ...args, run: runDir });
  }

  if (args.wait) {
    await waitForResults(runDir, roles, args.waitTimeout);
  }
}

async function setup(args) {
  const workspace = await resolveWorkspace(args);
  const project = workspace.primaryProject;
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
    const roleProject = projectForRole(workspace, role);
    const prompt = role === 'commander'
      ? commanderBootPrompt(workspace, args.kickoffTask)
      : workerBootPrompt(role, roleProject);
    const promptFile = path.join(runDir, `${role}.boot.md`);
    const commandFile = path.join(runDir, `${role}.command.sh`);
    const model = modelForRole(role, args);

    await writeFile(promptFile, prompt, 'utf8');
    await writeFile(
      commandFile,
      makeStartCommand(
        roleProject,
        title,
        args.ai,
        promptFile,
        args.approval,
        model,
        role === 'commander' ? workspaceProjectDirs(workspace) : [],
        !isRoleScopedWorkspace(workspace) || role === 'commander',
      ),
      'utf8',
    );
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
        workspace: workspaceForManifest(workspace),
        createdAt: new Date().toISOString(),
        terminals: setupMap.terminals,
        workspaces: setupMap.workspaces,
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

function makeStartCommand(project, title, ai, promptFile, approval = 'never', model = null, extraDirs = [], includeProjectsDir = true) {
  const projectPath = shellQuote(project);
  const squadPath = shellQuote(ROOT);
  const projectsFlag = includeProjectsDir
    ? ` --add-dir ${shellQuote(path.join(os.homedir(), 'projects'))}`
    : '';
  const extraDirFlags = unique(extraDirs.map((dir) => path.resolve(dir)))
    .filter((dir) => path.resolve(dir) !== path.resolve(project))
    .map((dir) => ` --add-dir ${shellQuote(dir)}`)
    .join('');
  const titleText = title.replaceAll('\\', '\\\\').replaceAll("'", "'\\''");
  const approvalMode = normalizeApproval(approval);
  const codexFlags = approvalMode === 'request'
    ? `--sandbox workspace-write --ask-for-approval on-request`
    : `--dangerously-bypass-approvals-and-sandbox`;
  const modelFlag = model ? ` --model ${shellQuote(model)}` : '';
return `cd ${projectPath}
printf '\\033]0;${titleText}\\007'
${shellQuote(ai)} ${codexFlags}${modelFlag} --cd ${projectPath} --add-dir ${squadPath}${projectsFlag}${extraDirFlags} "$(cat ${shellQuote(promptFile)})"
`;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function workerBootPrompt(role, project) {
  const roleLine = ['backend', 'frontend'].includes(role)
    ? `- ${ROLE_LABELS[role]} Worker는 구현 지시를 받으면 실제 파일을 수정하는 구현 담당이다.`
    : '- 구현 담당이 아니라면 코드 수정 없이 네 역할 관점의 분석/검토를 한다.';
  const contextFiles = CONTEXT_FILES.map((file) => `- ${path.join(ROOT, file)}`).join('\n');
  return `너는 AI Squad의 ${ROLE_LABELS[role]} Worker다.

기본 규칙:
- ${path.join(ROOT, 'global-rules.md')}를 따른다.
- ${path.join(ROOT, 'agents', `${role}.md`)} 역할을 따른다.
- 코드 프로젝트는 ${project} 이다.
- Commander가 보낸 작업을 받으면 바로 분석한다.
- 실제 작업 프롬프트에 Worker Scope Contract가 있으면 그 allowed_paths만 수정한다. 범위 밖 변경이 필요하면 직접 고치지 말고 cross-boundary request로 보고한다.
- 실제 작업 프롬프트에 Handoff Contract가 있으면 read_files를 먼저 확인하고, 다른 역할/프로젝트 변경 요청은 write_files에 기록한다.
${roleLine}
- 결과 저장 지시가 있으면 반드시 해당 results/*.md 파일을 생성하거나 갱신한다.
- 답변은 한국어로 간단명료하게 한다.

프로젝트 문맥 파일:
${contextFiles}

부팅 직후에는 규칙 파일이나 프로젝트 파일을 읽지 말고 대기 응답만 해라.
대기 상태에서는 "대기하겠습니다." 한 문장만 답해라.
Commander가 실제 작업 프롬프트를 보내면 그때 필요한 규칙 파일과 프로젝트 파일을 읽고 바로 처리해라.`;
}

function commanderBootPrompt(workspace, kickoffTask = null) {
  const project = workspace.primaryProject;
  const dispatchTarget = workspaceDispatchFlag(workspace);
  const workspaceLines = Object.entries(workspace.projects)
    .map(([name, projectPath]) => `- ${name}: ${projectPath}`)
    .join('\n');
  const roleProjectLines = ROLE_ORDER
    .map((role) => `- ${role}: ${projectForRole(workspace, role)}`)
    .join('\n');
  const kickoffBlock = kickoffTask
    ? `
시작 작업:
- 이 세션이 준비되면 아래 작업을 사용자 추가 입력 없이 바로 시작한다.
- worker 탭들이 뜰 시간을 짧게 둔 뒤 자동 분배 명령을 실행한다.

\`\`\`bash
sleep 10
cd ${shellQuote(ROOT)}
node bin/squad.mjs dispatch ${dispatchTarget} --task ${shellQuote(kickoffTask)} --send --submit --wait
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
cd ${shellQuote(ROOT)}
node bin/squad.mjs dispatch ${dispatchTarget} --task "사용자가 준 작업 내용" --send --submit --wait
\`\`\`
${kickoffBlock}

운영 규칙:
1. 사용자가 새 작업을 말하면 작업을 한 문장으로 요약한다.
2. 위 자동 분배 명령을 실행해서 worker들에게 작업을 보낸다. dispatch는 프로젝트 구조를 스캔해 worker별 Worker Scope Contract를 프롬프트에 포함한다.
3. 구현/수정/추가/개발 작업이면 Backend/Frontend Worker가 실제 구현 담당이다. 화면/UI 작업은 Frontend가 구현하고, 서버/API 작업은 Backend가 구현한다. Reviewer/Planner는 사용자가 요청했거나 작업상 꼭 필요할 때만 호출한다.
4. DB schema/migration, API contract, generated file, lockfile, 빌드/배포 설정은 exclusive artifact로 보고 단일 owner에게만 맡긴다.
5. API contract나 DB 변경이 필요하면 병렬 구현보다 DB/contract owner → backend → frontend → tester 순서로 진행한다.
6. 자동 분배 명령은 worker 결과 파일이 생길 때까지 기다린다.
7. 명령이 완료되면 출력된 .squad-runs 경로 아래 manifest.json과 results/*.md 파일을 읽어 worker 결과를 취합한다.
8. .squad-runs 경로 아래 handoff/*.md를 반드시 읽는다. handoff에 상대 역할 요청이나 contract 변경이 있으면 필요한 worker에게 후속 작업을 순차 분배한다.
9. 구현 작업이면 프로젝트 git diff와 구현 담당 worker의 results/*.md 존재 여부를 확인한다.
10. changed_files가 Worker Scope Contract의 allowed_paths 밖이면 좋은 수정이어도 merge하지 말고 cross-boundary request로 재분배한다.
11. 중복 migration, 중복 메서드/심볼, 서로 다른 API contract 수정, exclusive artifact 복수 수정 여부를 확인한다.
12. 사용자에게 구현 결과, 변경 파일, handoff/contract 변경, 위험 요소, 테스트 결과만 보고한다.
13. 직접 구현하지 말고 worker 결과와 handoff를 검증하고 취합한다.

프로젝트:
- ${project}

Workspace projects:
${workspaceLines}

Role project assignment:
${roleProjectLines}

참고 문서:
- ${path.join(ROOT, 'global-rules.md')}
- ${path.join(ROOT, 'agents/commander.md')}
- ${path.join(ROOT, 'ai/project-context.md')}
- ${path.join(ROOT, 'ai/tech-stack.md')}
- ${path.join(ROOT, 'ai/conventions.md')}
- ${path.join(ROOT, 'ai/constraints.md')}
- ${path.join(ROOT, 'ai/current-task.md')}

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
  const squadState = await loadSquadState(manifest.project, manifest.workspace);
  const missingRoles = [];
  const matchedRoles = [];
  let sentCount = 0;

  const sendRoles = args.includeCommander
    ? manifest.roles
    : manifest.roles.filter((role) => role !== 'commander');

  for (const role of sendRoles) {
    const index = manifest.roles.indexOf(role);
    const filename = `${String(index + 1).padStart(2, '0')}-${role}.prompt.md`;
    const workspaceId = squadState.workspaces?.[role] ?? '';

    if (!workspaceId) {
      missingRoles.push(role);
      continue;
    }

    matchedRoles.push(`${role}->${workspaceId}`);

    if (args.dryRun) {
      continue;
    }

    const promptText = await readFile(path.join(runDir, filename), 'utf8');
    runCmux(['send-key', '--workspace', workspaceId, 'ctrl+c'], `cancel pending input for ${role}`);
    runCmux(['send-key', '--workspace', workspaceId, 'ctrl+u'], `clear pending input for ${role}`);
    runCmux(['send', '--workspace', workspaceId, promptText], `send prompt to ${role}`);

    if (args.submit) {
      runCmux(['send-key', '--workspace', workspaceId, 'enter'], `submit prompt to ${role}`);
    }

    sentCount += 1;
  }

  console.log(`Matched: ${matchedRoles.join(', ')} / Sent prompts: ${sentCount} / Missing tabs: ${missingRoles.join(', ')}`);
}

function runCmux(args, description) {
  const result = spawnSync(CMUX_CLI, args, {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 10,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${description} failed: ${result.stderr.trim() || result.stdout.trim() || 'unknown cmux error'}`);
  }
}

async function loadSquadState(project, workspace = null) {
  try {
    const state = JSON.parse(await readFile(TERMINAL_MAP_FILE, 'utf8'));
    if (workspace?.source && state.workspace?.source && path.resolve(state.workspace.source) !== path.resolve(workspace.source)) {
      return {};
    }
    if (state.project && path.resolve(state.project) !== path.resolve(project)) {
      return {};
    }
    return state;
  } catch {
    return {};
  }
}

async function waitForResults(runDir, roles, timeoutSeconds = 900) {
  const resultRoles = roles.filter((role) => role !== 'commander');
  const runId = path.basename(runDir);

  if (!resultRoles.length) {
    console.log('No worker results to wait for.');
    return;
  }

  const timeoutMs = Number.isFinite(timeoutSeconds) && timeoutSeconds > 0
    ? timeoutSeconds * 1000
    : 900000;
  const deadline = Date.now() + timeoutMs;

  console.log(`Waiting for worker results: ${resultRoles.join(', ')}`);

  while (Date.now() < deadline) {
    const pending = [];

    for (const role of resultRoles) {
      const resultPath = path.join(runDir, 'results', `${role}.md`);
      const info = await stat(resultPath).catch(() => null);
      if (!info || info.size === 0) {
        pending.push(role);
        continue;
      }

      const resultText = await readFile(resultPath, 'utf8').catch(() => '');
      if (!resultText.includes(`작업 ID: ${runId}`)) {
        pending.push(role);
      }
    }

    if (!pending.length) {
      console.log(`All worker results ready: ${path.join(runDir, 'results')}`);
      return;
    }

    await sleep(5000);
  }

  throw new Error(`Timed out waiting for worker results in ${runDir}`);
}

function appleString(value) {
  return JSON.stringify(value);
}

function help() {
  console.log(`AI Squad helper

Usage:
  squad new <name-or-path> [--type blank|next|nest|expo] [--approval request|never] [--model MODEL] [--role-models role=model,...] [--task "첫 작업"] [--dry-run]
  squad start [/path/to/project] [--workspace /path/to/squad.json] [--approval request|never] [--model MODEL] [--role-models role=model,...] [--dry-run]
  squad ask "작업 내용" [--project /path/to/project] [--workspace /path/to/squad.json]
  squad status [--run latest|/path/to/run]

Lower-level commands:
  node bin/squad.mjs setup [--project /path/to/project] [--workspace /path/to/squad.json] [--ai codex] [--model MODEL] [--role-models role=model,...] [--dry-run]
  node bin/squad.mjs dispatch [--mode auto|feature|bugfix|release] [--project /path/to/project] [--workspace /path/to/squad.json] [--roles planner,backend,database,frontend,infra,commander,reviewer,tester] [--task "extra instruction"] [--send] [--submit] [--wait]
  node bin/squad.mjs send [--run latest|/path/to/run] [--dry-run] [--submit] [--include-commander]

Examples:
  squad new my-app --type next --approval request
  squad new my-app --type next --approval never
  squad new my-app --type next --model gpt-5.4-mini --role-models commander=gpt-5.5
  squad new mobile-app --type expo --task "Expo 앱 초기 구조 만들고 로그인 화면부터 시작" --approval never
  squad start /Users/james/daldale-api-backend --approval request
  squad start --workspace /Users/james/projects/my-product/squad.json --approval request
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
