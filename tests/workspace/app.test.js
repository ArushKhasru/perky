import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createWindowsAppLauncher,
  getAppNameCandidates,
  selectWindowsLaunchablePath,
} from '../../src/workspace/app.js';

test('getAppNameCandidates expands common app aliases', () => {
  assert.deepEqual(getAppNameCandidates('vscode'), ['vscode', 'code', 'code-insiders']);
  assert.deepEqual(getAppNameCandidates('chrom'), ['chrom', 'chrome']);

  const originalPlatform = process.platform;
  try {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    assert.deepEqual(getAppNameCandidates('terminal'), ['terminal', 'wt', 'powershell', 'cmd']);
  } finally {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  }
});

test('selectWindowsLaunchablePath prefers a launchable Windows shim over an extensionless script', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'perky-app-test-'));
  const extensionlessShim = path.join(tempDir, 'tool');
  const cmdShim = `${extensionlessShim}.cmd`;

  try {
    await fs.writeFile(extensionlessShim, '#!/usr/bin/env sh\n');
    await fs.writeFile(cmdShim, '@echo off\n');

    assert.equal(
      await selectWindowsLaunchablePath([extensionlessShim, cmdShim]),
      cmdShim,
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('createWindowsAppLauncher opens GUI apps and terminals through start', () => {
  assert.deepEqual(
    createWindowsAppLauncher('D:\\Antigravity\\bin\\antigravity.cmd', [], 'antigravity'),
    {
      command: 'cmd',
      args: ['/c', 'start', '', 'D:\\Antigravity\\bin\\antigravity.cmd'],
      label: 'antigravity',
      options: { windowsHide: true },
    },
  );

  assert.deepEqual(
    createWindowsAppLauncher('C:\\Windows\\System32\\cmd.exe', [], 'cmd'),
    {
      command: 'cmd',
      args: ['/c', 'start', '', 'C:\\Windows\\System32\\cmd.exe', '/k'],
      label: 'cmd',
      options: { windowsHide: true },
    },
  );
});
