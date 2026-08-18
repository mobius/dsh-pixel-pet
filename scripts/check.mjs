#!/usr/bin/env node
/*
 * Static package-contract check. Run from anywhere:
 *   node scripts/check.mjs
 *
 * It verifies the parts of the DSH client-plugin contract that can be checked
 * without booting a Harness profile:
 *   - package.json declares dsh.client { platform: web, inject: string[] }
 *   - exports["./client"] points at an existing file
 *   - the client bundle registers the same id as the package name
 *   - the host main entry exists
 *   - all 30 state gifs are present
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

const checks = [];
function check(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    checks.push(error);
    console.error(`FAIL - ${name}: ${error.message}`);
  }
}

check('dsh.bundle.patch exists', () => {
  const patch = pkg.dsh?.bundle?.patch;
  if (typeof patch !== 'string') throw new Error('missing dsh.bundle.patch');
  if (!existsSync(path.join(root, patch))) throw new Error(`${patch} does not exist`);
});

check('dsh.client.platform is web', () => {
  if (pkg.dsh?.client?.platform !== 'web') throw new Error('missing or not "web"');
});

check('dsh.client.inject is a string array', () => {
  if (!Array.isArray(pkg.dsh?.client?.inject) || pkg.dsh.client.inject.some((id) => typeof id !== 'string')) {
    throw new Error('missing or malformed inject array');
  }
});

check('exports["./client"] resolves to an existing file', () => {
  const client = pkg.exports?.['./client'];
  if (typeof client !== 'string') throw new Error('exports["./client"] must be a string');
  if (!existsSync(path.join(root, client))) throw new Error(`${client} does not exist`);
});

check('host main entry exists', () => {
  const main = pkg.main || pkg.exports?.['.'] || pkg.exports?.['.']?.default;
  const file = typeof main === 'string' ? main : null;
  if (!file || !existsSync(path.join(root, file))) throw new Error(`main entry missing: ${file}`);
});

check('client bundle registers the package-name id', () => {
  const client = pkg.exports['./client'];
  const source = readFileSync(path.join(root, client), 'utf8');
  if (!source.includes(`id: '${pkg.name}'`) && !source.includes(`id: "${pkg.name}"`)) {
    throw new Error(`no window.__ModuleLoader__.load id for "${pkg.name}"`);
  }
  if (!source.includes('window.__ModuleLoader__.load')) {
    throw new Error('client bundle does not use window.__ModuleLoader__.load');
  }
});

check('client bundle injects the services it uses', () => {
  const client = pkg.exports['./client'];
  const source = readFileSync(path.join(root, client), 'utf8');
  if (!source.includes("const inject = ['sessions', 'slots', 'locale'];")) {
    throw new Error('factory inject list missing or changed');
  }
});

const TIERS = ['01', '02', '03', '04', '05', '06'];
const STATES = ['idle', 'rest', 'work', 'done', 'wait'];
check('all 30 state gifs are present', () => {
  const dir = path.join(root, 'assets', 'gifs');
  for (const tier of TIERS) {
    for (const state of STATES) {
      const file = path.join(dir, `${tier}_${state}.gif`);
      if (!existsSync(file)) throw new Error(`missing ${tier}_${state}.gif`);
    }
  }
  const extra = readdirSync(dir).filter((f) => f !== '.DS_Store' && !/^\d{2}_(idle|rest|work|done|wait)\.gif$/.test(f));
  if (extra.length > 0) throw new Error(`unexpected files in assets/gifs: ${extra.join(', ')}`);
});

if (checks.length > 0) {
  console.error(`\n${checks.length} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
