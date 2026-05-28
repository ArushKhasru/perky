import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { execa } from 'execa';

import { CliError, resolveUserPath } from '../commands/shared.js';
import { launchDetached } from './process.js';

const WINDOWS_APP_PATHS = [
  'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths',
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths',
];
const WINDOWS_EXECUTABLE_EXTENSIONS = ['.com', '.exe', '.bat', '.cmd'];

const APP_ALIAS_GROUPS = [
  {
    aliases: ['chrome', 'chrom', 'google chrome', 'googlechrome'],
    commands: ['chrome'],
  },
  {
    aliases: ['edge', 'microsoft edge', 'ms edge', 'msedge'],
    commands: ['msedge'],
  },
  {
    aliases: ['firefox', 'mozilla firefox', 'mozilla', 'ff'],
    commands: ['firefox'],
  },
  {
    aliases: ['brave', 'brave browser', 'bravebrowser'],
    commands: ['brave'],
  },
  {
    aliases: ['vscode', 'vs code', 'visual studio code', 'visualstudiocode'],
    commands: ['code', 'code-insiders'],
  },
  {
    aliases: ['antigravity', 'antigravity ide', 'google antigravity'],
    commands: ['antigravity'],
  },
  {
    aliases: ['terminal', 'term', 'shell', 'console', 'windows terminal', 'windowsterminal'],
    commands: () => process.platform === 'win32'
      ? ['wt', 'powershell', 'cmd']
      : process.platform === 'darwin'
        ? ['Terminal']
        : [process.env.TERMINAL || 'x-terminal-emulator'],
  },
  {
    aliases: ['command prompt', 'commandprompt'],
    commands: ['cmd'],
  },
  {
    aliases: ['powershell', 'power shell', 'ps'],
    commands: ['powershell', 'pwsh'],
  },
];

export async function openApp(nameParts) {
  const appName = normalizeAppName(nameParts);
  if (!appName) {
    throw new CliError('Missing app name.');
  }

  const launcher = await resolveAppLauncher(appName);
  if (!launcher) {
    throw new CliError(`App not found: ${appName}. Use "perky open <project>" to open a configured project.`);
  }

  await launchDetached(launcher.command, launcher.args ?? [], launcher.options);
  console.log(`Opening app: ${launcher.label ?? appName}`);
}

async function resolveAppLauncher(appName) {
  if (isExplicitPath(appName)) {
    const resolvedPath = resolveUserPath(appName);
    const launchablePath = process.platform === 'win32'
      ? await resolveWindowsLaunchableFile(resolvedPath) ?? resolvedPath
      : resolvedPath;

    await assertFileExists(launchablePath, appName);
    return createAppLauncher(launchablePath, [], launchablePath);
  }

  for (const candidateName of getAppNameCandidates(appName)) {
    const pathMatch = await resolveExecutableOnPath(candidateName);
    if (pathMatch) {
      return createAppLauncher(pathMatch, [], appName);
    }

    if (process.platform === 'win32') {
      const registryMatch = await resolveWindowsAppPath(candidateName);
      if (registryMatch) {
        return createAppLauncher(registryMatch, [], appName);
      }
    }
  }

  return null;
}

export function getAppNameCandidates(appName) {
  return dedupePreservingOrder([
    appName,
    ...getAliasCommandCandidates(appName),
  ].filter(Boolean).map((candidate) => String(candidate).trim()).filter(Boolean));
}

function getAliasCommandCandidates(appName) {
  const aliasKey = normalizeAliasKey(appName);
  const exactGroup = APP_ALIAS_GROUPS.find((group) => (
    group.aliases.some((alias) => normalizeAliasKey(alias) === aliasKey)
  ));

  if (exactGroup) {
    return resolveAliasGroupCommands(exactGroup);
  }

  const fuzzyGroup = APP_ALIAS_GROUPS.find((group) => (
    aliasKey.length >= 4
      && group.aliases.some((alias) => isCloseAlias(aliasKey, normalizeAliasKey(alias)))
  ));

  return fuzzyGroup ? resolveAliasGroupCommands(fuzzyGroup) : [];
}

function resolveAliasGroupCommands(group) {
  return typeof group.commands === 'function' ? group.commands() : group.commands;
}

function normalizeAliasKey(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isCloseAlias(inputKey, aliasKey) {
  if (!inputKey || !aliasKey) {
    return false;
  }

  return aliasKey.startsWith(inputKey) || levenshteinDistance(inputKey, aliasKey) <= 2;
}

function levenshteinDistance(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let lastDiagonal = previous[0];
    previous[0] = leftIndex;

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const previousDiagonal = lastDiagonal;
      lastDiagonal = previous[rightIndex];
      previous[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + 1,
        previousDiagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
  }

  return previous[right.length];
}

function dedupePreservingOrder(values) {
  const seen = new Set();
  const output = [];

  for (const value of values) {
    const key = value.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      output.push(value);
    }
  }

  return output;
}

function normalizeAppName(nameParts) {
  if (Array.isArray(nameParts)) {
    return nameParts.join(' ').trim();
  }
  return String(nameParts ?? '').trim();
}

function isExplicitPath(value) {
  if (!value) return false;
  return value.includes('\\')
    || value.includes('/')
    || value.startsWith('.')
    || /^[a-z]:/i.test(value);
}

async function assertFileExists(targetPath, displayName) {
  try {
    const stat = await fs.stat(targetPath);
    if (!stat.isFile()) {
      throw new CliError(`App path is not a file: ${displayName}`);
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new CliError(`App path not found: ${displayName}`);
    }
    throw error;
  }
}

async function fileExists(targetPath) {
  try {
    const stat = await fs.stat(targetPath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function resolveExecutableOnPath(command) {
  if (process.platform === 'win32') {
    try {
      const { stdout } = await execa('where.exe', [command]);
      const candidates = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      return await selectWindowsLaunchablePath(candidates);
    } catch {
      return null;
    }
  }

  try {
    const { stdout } = await execa('sh', ['-lc', `command -v -- ${shellSingleQuote(command)}`]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function selectWindowsLaunchablePath(candidates) {
  for (const candidate of candidates) {
    const launchablePath = await resolveWindowsLaunchableFile(candidate);
    if (launchablePath) {
      return launchablePath;
    }
  }

  return null;
}

async function resolveWindowsLaunchableFile(targetPath) {
  const cleanedPath = stripQuotes(targetPath);
  const extension = path.win32.extname(cleanedPath).toLowerCase();

  if (WINDOWS_EXECUTABLE_EXTENSIONS.includes(extension)) {
    return await fileExists(cleanedPath) ? cleanedPath : null;
  }

  for (const executableExtension of getWindowsExecutableExtensions()) {
    const candidatePath = `${cleanedPath}${executableExtension}`;
    if (await fileExists(candidatePath)) {
      return candidatePath;
    }
  }

  return await fileExists(cleanedPath) ? cleanedPath : null;
}

function getWindowsExecutableExtensions() {
  const configuredExtensions = (process.env.PATHEXT ?? '')
    .split(';')
    .map((extension) => extension.trim().toLowerCase())
    .filter(Boolean);

  return dedupePreservingOrder([
    ...configuredExtensions,
    ...WINDOWS_EXECUTABLE_EXTENSIONS,
  ]);
}

async function resolveWindowsAppPath(appName) {
  const keyName = appName.toLowerCase().endsWith('.exe') ? appName : `${appName}.exe`;

  for (const hive of WINDOWS_APP_PATHS) {
    const keyPath = `${hive}\\${keyName}`;
    try {
      const { stdout } = await execa('reg', ['query', keyPath, '/ve']);
      const match = stdout.match(/\(Default\)\s+REG_\w+\s+(.+)/i);
      if (match) {
        const rawPath = match[1].trim();
        const cleaned = normalizeExecutablePath(expandWindowsEnv(stripQuotes(rawPath)));
        if (cleaned && await fileExists(cleaned)) {
          return cleaned;
        }
      }
    } catch {
      // Try the next hive.
    }
  }

  return null;
}

function stripQuotes(value) {
  if (!value) return value;
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function normalizeExecutablePath(value) {
  if (!value) return value;
  const trimmed = value.trim();
  const match = trimmed.match(/^(.+?\.exe)\b/i);
  return match ? match[1] : trimmed;
}

function expandWindowsEnv(value) {
  return value.replace(/%([^%]+)%/g, (match, envKey) => process.env[envKey] ?? match);
}

function createAppLauncher(command, args = [], label = command) {
  if (process.platform === 'win32') {
    return createWindowsAppLauncher(command, args, label);
  }

  if (process.platform === 'darwin' && command === 'Terminal') {
    return { command: 'open', args: ['-a', 'Terminal'], label };
  }

  return { command, args, label };
}

export function createWindowsAppLauncher(command, args = [], label = command) {
  const commandBaseName = path.win32.basename(command).toLowerCase().replace(/\.(exe|cmd|bat|com)$/i, '');
  const launcher = {
    command: 'cmd',
    args: ['/c', 'start', '', command, ...args],
    label,
    options: { windowsHide: true },
  };

  if (commandBaseName === 'cmd') {
    return {
      ...launcher,
      args: ['/c', 'start', '', command, '/k', ...args],
    };
  }

  if (commandBaseName === 'powershell' || commandBaseName === 'pwsh') {
    return {
      ...launcher,
      args: ['/c', 'start', '', command, '-NoExit', ...args],
    };
  }

  return launcher;
}

function shellSingleQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}
