import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  getDefaultConfig,
  mergeConfig,
  getByPath,
  setByPath,
  deleteByPath,
  parseConfigValue,
  validateConfigValue,
  resolveUserPath,
  readJson,
  writeJson
} from '../../src/utils/config.js';

test('getDefaultConfig returns expected shape and fields', () => {
  const defaults = getDefaultConfig();
  assert.ok(defaults.ai);
  assert.equal(defaults.ai.provider, 'gemini');
  assert.ok(defaults.projects);
  assert.ok(defaults.defaults);
});

test('mergeConfig merges deep structures and handles primitive overrides', () => {
  const base = {
    a: 1,
    nested: { b: 2, c: 3 }
  };

  const override = {
    nested: { c: 30, d: 40 },
    other: 'hello'
  };

  const merged = mergeConfig(base, override);
  assert.deepEqual(merged, {
    a: 1,
    nested: { b: 2, c: 30, d: 40 },
    other: 'hello'
  });
});

test('getByPath, setByPath, and deleteByPath modify object paths', () => {
  const obj = {
    user: {
      profile: {
        name: 'perkysh'
      }
    }
  };

  // getByPath
  assert.equal(getByPath(obj, 'user.profile.name'), 'perkysh');
  assert.equal(getByPath(obj, 'user.missing.key'), undefined);

  // setByPath
  setByPath(obj, 'user.profile.age', 25);
  setByPath(obj, 'user.settings.theme', 'dark');
  assert.equal(obj.user.profile.age, 25);
  assert.equal(obj.user.settings.theme, 'dark');

  // deleteByPath
  assert.equal(deleteByPath(obj, 'user.profile.age'), true);
  assert.equal(getByPath(obj, 'user.profile.age'), undefined);
  assert.equal(deleteByPath(obj, 'user.missing.path'), false);
});

test('parseConfigValue converts string representations to target types', () => {
  assert.equal(parseConfigValue('true'), true);
  assert.equal(parseConfigValue('false'), false);
  assert.equal(parseConfigValue('null'), null);
  assert.equal(parseConfigValue('42'), 42);
  assert.equal(parseConfigValue('-3.14'), -3.14);
  assert.deepEqual(parseConfigValue('{"a":1}'), { a: 1 });
  assert.equal(parseConfigValue('{"malformed}'), '{"malformed}');
  assert.equal(parseConfigValue('plain-string'), 'plain-string');
});

test('validateConfigValue rejects invalid config values', () => {
  assert.doesNotThrow(() => validateConfigValue('ai.provider', 'gemini'));
  assert.doesNotThrow(() => validateConfigValue('ai.provider', 'openai'));
  assert.doesNotThrow(() => validateConfigValue('ai.provider', 'ollama'));

  assert.throws(() => validateConfigValue('ai.provider', 'invalid-provider'), /Unsupported provider/);
});

test('resolveUserPath resolves path containing tilde and relative paths', () => {
  const homedir = os.homedir();
  assert.equal(resolveUserPath('~/some/dir'), path.resolve(homedir, 'some/dir'));
  assert.equal(resolveUserPath('relative/path', '/base'), path.resolve('/base', 'relative/path'));
  assert.equal(resolveUserPath('', '/base'), '/base');
});

test('readJson and writeJson perform file system operations', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'perky-config-test-'));
  const tempFile = path.join(tempDir, 'test.json');

  try {
    // Read missing file returns null
    const val = await readJson(tempFile);
    assert.equal(val, null);

    // Write file
    const data = { hello: 'world' };
    await writeJson(tempFile, data);

    // Read file
    const readData = await readJson(tempFile);
    assert.deepEqual(readData, data);

    // Read malformed file
    await fs.writeFile(tempFile, 'malformed-json');
    await assert.rejects(() => readJson(tempFile), /Invalid JSON/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
