import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { normalizeProject, resolveStoredProjectName, getProjectOpenUrls, getProjectServices, getClosestMatch } from '../../src/workspace/resolver.js';

test('resolveStoredProjectName exact, case-insensitive, and multiple match scenarios', () => {
  const projects = {
    ctf: {},
    Ctf: {},
    OtherApp: {},
  };

  // Exact match
  assert.equal(resolveStoredProjectName(projects, 'OtherApp'), 'OtherApp');

  // Case-insensitive single match
  assert.equal(resolveStoredProjectName(projects, 'otherapp'), 'OtherApp');

  // No match
  assert.equal(resolveStoredProjectName(projects, 'missing'), null);
  assert.equal(resolveStoredProjectName(projects, null), null);

  // Ambiguous match throws error when there is no exact match and multiple case-insensitive matches
  assert.throws(() => resolveStoredProjectName(projects, 'CTF'), /matches multiple configured projects/);
});

test('normalizeProject fills defaults from config', () => {
  const project = {
    path: '/path/to/project',
    shell: 'bash'
  };
  const defaults = {
    editor: 'code-insiders',
    browser: 'firefox',
    shell: 'cmd'
  };

  const normalized = normalizeProject('my-proj', project, defaults);
  assert.equal(normalized.name, 'my-proj');
  assert.equal(normalized.editor, 'code-insiders'); // from defaults
  assert.equal(normalized.shell, 'bash'); // overridden by project
  assert.equal(normalized.browserCommand, 'firefox'); // from browser default
});

test('getProjectOpenUrls retrieves URLs from different fields', () => {
  // array
  const proj1 = { openUrls: ['http://a.com', 'http://b.com'] };
  assert.deepEqual(getProjectOpenUrls(proj1), ['http://a.com', 'http://b.com']);

  // browser string looking like url
  const proj2 = { browser: 'http://c.com' };
  assert.deepEqual(getProjectOpenUrls(proj2), ['http://c.com']);

  // url string
  const proj3 = { url: 'http://d.com' };
  assert.deepEqual(getProjectOpenUrls(proj3), ['http://d.com']);

  // default / empty
  assert.deepEqual(getProjectOpenUrls({}), []);
});

test('getProjectServices parses services array, frontend/backend, startCmd', () => {
  const resolvedPath = path.resolve('/path/to/project');
  const project = {
    path: resolvedPath,
    services: [
      { name: 'db', cmd: 'docker-compose up', port: 5432 }
    ],
    frontend: {
      startCmd: 'npm run dev',
      port: 3000
    },
    backend: {
      cmd: 'go run main.go',
      port: 8080
    },
    cmd: 'npm run build'
  };

  const services = getProjectServices(project);

  assert.equal(services.length, 4);

  assert.deepEqual(services[0], {
    name: 'db',
    cmd: 'docker-compose up',
    cwd: resolvedPath,
    port: 5432
  });

  assert.deepEqual(services[1], {
    name: 'frontend',
    cmd: 'npm run dev',
    cwd: resolvedPath,
    port: 3000
  });

  assert.deepEqual(services[2], {
    name: 'backend',
    cmd: 'go run main.go',
    cwd: resolvedPath,
    port: 8080
  });

  // Since name is omitted, it defaults to project.name ?? 'app'
  assert.equal(services[3].name, 'app');
  assert.equal(services[3].cmd, 'npm run build');
});

test('getClosestMatch retrieves closest suggestion', () => {
  const candidates = ['perkyApp', 'Backend', 'Frontend'];

  // substring match
  assert.equal(getClosestMatch('backend', candidates), 'Backend');
  assert.equal(getClosestMatch('perky', candidates), 'perkyApp');

  // Levenshtein close match
  assert.equal(getClosestMatch('perkyap', candidates), 'perkyApp'); // 1 edit distance

  // Too far
  assert.equal(getClosestMatch('xyz', candidates), null);

  // Empty inputs
  assert.equal(getClosestMatch('', candidates), null);
  assert.equal(getClosestMatch('perky', []), null);
});
