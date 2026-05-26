#!/usr/bin/env node

import { createServer } from 'node:http';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RUNS_DIR = path.join(ROOT, '.squad-runs');
const PORT = Number(process.env.PORT ?? 4180);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function latestRunDir() {
  const entries = await readdir(RUNS_DIR, { withFileTypes: true });
  const runs = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('setup-'))
      .map(async (entry) => {
        const dir = path.join(RUNS_DIR, entry.name);
        const manifestPath = path.join(dir, 'manifest.json');
        const info = await stat(dir);
        return {
          id: entry.name,
          dir,
          mtimeMs: info.mtimeMs,
          hasManifest: await pathExists(manifestPath),
        };
      }),
  );

  return runs
    .filter((run) => run.hasManifest)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
}

function previewMarkdown(markdown) {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*_>`-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
}

async function readLatestRun() {
  const latest = await latestRunDir();
  if (!latest) {
    return { run: null, roles: [], results: [] };
  }

  const manifest = JSON.parse(
    await readFile(path.join(latest.dir, 'manifest.json'), 'utf8'),
  );
  const resultsDir = path.join(latest.dir, 'results');
  const resultNames = (await pathExists(resultsDir))
    ? await readdir(resultsDir)
    : [];
  const results = await Promise.all(
    resultNames
      .filter((name) => name.endsWith('.md'))
      .sort()
      .map(async (name) => {
        const content = await readFile(path.join(resultsDir, name), 'utf8');
        return {
          file: name,
          role: path.basename(name, '.md').toLowerCase(),
          preview: previewMarkdown(content),
          content,
        };
      }),
  );

  return {
    run: {
      id: manifest.runId ?? latest.id,
      mode: manifest.mode ?? 'unknown',
      project: manifest.project ?? '',
      task: manifest.inferenceText ?? '',
      path: latest.dir,
    },
    roles: manifest.roles ?? [],
    results,
    updatedAt: new Date().toISOString(),
  };
}

function sendJson(response, data, status = 200) {
  response.writeHead(status, { 'Content-Type': MIME_TYPES['.json'] });
  response.end(JSON.stringify(data, null, 2));
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  const requestedPath = path.normalize(decodeURIComponent(pathname));
  const filePath = path.join(__dirname, requestedPath);

  if (!filePath.startsWith(__dirname)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  try {
    const body = await readFile(filePath);
    const ext = path.extname(filePath);
    response.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream',
    });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname === '/api/runs/latest') {
      sendJson(response, await readLatestRun());
      return;
    }

    await serveStatic(request, response);
  } catch (error) {
    sendJson(
      response,
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500,
    );
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`AI Squad Town: http://127.0.0.1:${PORT}`);
});
