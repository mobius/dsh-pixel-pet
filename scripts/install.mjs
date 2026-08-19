#!/usr/bin/env node
/*
 * Install dsh-pixel-liangzu into the default dsh web profile.
 *
 * Equivalent manual steps:
 *   cd ~/.dsh/profiles/web
 *   pnpm add "file:<this plugin directory>"
 *   # then add the insert row to cordis.patch.yml (this script does that too)
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(scriptDir, '..');
const dshHome = process.env.DSH_HOME
  ? path.resolve(process.env.DSH_HOME)
  : path.join(os.homedir(), '.dsh');
const profileDir = path.join(dshHome, 'profiles', 'web');
const patchPath = path.join(profileDir, 'cordis.patch.yml');

function fail(message) {
  console.error(`[dsh-pixel-liangzu] ${message}`);
  process.exitCode = 1;
}

if (!existsSync(path.join(profileDir, 'package.json'))) {
  fail(`profile directory not found: ${profileDir}`);
  fail('Run `dsh web` once first so the web profile is initialized, or set DSH_HOME.');
  process.exit(1);
}

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
// Drop a previous installed copy first; pnpm file: deps can otherwise keep
// stale files from an earlier package layout around.
for (const oldName of ['dsh-pixel-liangzu', 'dsh-pixel-pet']) {
  spawnSync(pnpm, ['--dir', profileDir, 'remove', oldName], {
    stdio: 'ignore',
    env: process.env,
  });
}
const add = spawnSync(pnpm, ['--dir', profileDir, 'add', `file:${pluginDir}`], {
  stdio: 'inherit',
  env: process.env,
});

if (add.error) {
  if (add.error.code === 'ENOENT') {
    fail('pnpm was not found on PATH. Install pnpm (`npm install -g pnpm`) or run the manual steps in README.md.');
  } else {
    fail(`pnpm add failed: ${add.error.message}`);
  }
  process.exit(1);
}
if (add.status !== 0) {
  fail(`pnpm add exited with status ${add.status}`);
  process.exit(1);
}

const patchEntry = [
  '- insert:',
  '    - id: dsh-pixel-liangzu',
  '      name: dsh-pixel-liangzu',
  '',
].join('\n');

let patch;
if (existsSync(patchPath)) {
  patch = readFileSync(patchPath, 'utf8');
} else {
  mkdirSync(profileDir, { recursive: true });
  patch = '';
}

if (patch.includes('name: dsh-pixel-pet') && !patch.includes('name: dsh-pixel-liangzu')) {
  patch = patch.replace(/id: dsh-pixel-pet/g, 'id: dsh-pixel-liangzu');
  patch = patch.replace(/name: dsh-pixel-pet/g, 'name: dsh-pixel-liangzu');
  writeFileSync(patchPath, patch, 'utf8');
  console.log(`[dsh-pixel-liangzu] renamed profile row in ${patchPath}`);
}

if (!patch.includes('name: dsh-pixel-liangzu')) {
  const emptyArrayMatch = /^\[\]\s*$/m.exec(patch);
  if (emptyArrayMatch) {
    // Initial profile file: replace the standalone `[]` line with the insert entry.
    patch = patch.slice(0, emptyArrayMatch.index) + patchEntry + patch.slice(emptyArrayMatch.index + emptyArrayMatch[0].length);
  } else {
    patch = patch.replace(/\s*$/, '');
    patch += (patch ? '\n\n' : '') + patchEntry;
  }
  writeFileSync(patchPath, patch, 'utf8');
  console.log(`[dsh-pixel-liangzu] patched ${patchPath}`);
} else {
  console.log(`[dsh-pixel-liangzu] ${patchPath} already contains the row`);
}

console.log('[dsh-pixel-liangzu] installed. Restart dsh web to load the pet.');
