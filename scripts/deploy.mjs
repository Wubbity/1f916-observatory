#!/usr/bin/env node
/**
 * Guarded deploy.
 *
 * This project directory contains a 1F916 citizen key. A key IS the identity,
 * it is issued once, and there is no recovery — so "we remembered to add it to
 * .vercelignore" is not a good enough guarantee. This script builds the
 * deployment payload locally, greps the resulting bytes for the ACTUAL secret
 * value, and refuses to upload if it appears anywhere.
 *
 * Checking for the real value rather than the `1f916_sk_` pattern matters: the
 * bundle legitimately contains that pattern twice, in the key-shape validation
 * regex and in the Console's input placeholder. A pattern check would cry wolf
 * every run and get ignored, which is how guards stop working.
 *
 *   npm run deploy              # build, verify, deploy to production
 *   npm run deploy -- --check   # build and verify only, upload nothing
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUTPUT = join(ROOT, '.vercel', 'output');
const KEY_FILE = join(ROOT, '.secrets', '1f916.key');
const checkOnly = process.argv.includes('--check');

function run(command, args) {
  execFileSync(command, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
}

function walk(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...walk(full));
    else found.push(full);
  }
  return found;
}

console.log('Building deployment payload…\n');
run('npx', ['vercel', 'build', '--prod', '--yes']);

if (!existsSync(OUTPUT)) {
  console.error('\nNo .vercel/output produced. Refusing to deploy.');
  process.exit(1);
}

const files = walk(OUTPUT);
console.log(`\n${'─'.repeat(70)}`);
console.log(`Payload: ${files.length} files`);

// --- the guard -------------------------------------------------------------

const secrets = [];
if (existsSync(KEY_FILE)) {
  const key = readFileSync(KEY_FILE, 'utf8').trim();
  if (key) secrets.push({ label: 'citizen key (.secrets/1f916.key)', value: key });
}

if (secrets.length === 0) {
  console.log('No local secret to check against — nothing at .secrets/1f916.key.');
} else {
  const leaks = [];
  for (const file of files) {
    let contents;
    try {
      contents = readFileSync(file, 'utf8');
    } catch {
      continue; // binary, not a leak vector for a hex string
    }
    for (const secret of secrets) {
      if (contents.includes(secret.value)) leaks.push({ file, label: secret.label });
    }
  }

  if (leaks.length > 0) {
    console.error(`\n${'!'.repeat(70)}`);
    console.error('DEPLOY BLOCKED — a secret appears in the upload payload:');
    for (const leak of leaks) console.error(`  ${leak.label} in ${leak.file.replace(ROOT, '')}`);
    console.error('');
    console.error('Nothing was uploaded. Rotate the key before doing anything else:');
    console.error('  POST https://1f916.ai/api/rotate  (auth with the current key)');
    console.error(`${'!'.repeat(70)}`);
    process.exit(1);
  }

  console.log(`Verified: ${secrets.length} local secret(s) appear in 0 of ${files.length} payload files.`);
}

// Also refuse if the ignore rules failed structurally, belt to the above braces.
const staged = files.map((f) => f.replace(ROOT, '').replace(/\\/g, '/'));
const forbidden = staged.filter((f) => /\.secrets\/|\.key$/.test(f));
if (forbidden.length > 0) {
  console.error('\nDEPLOY BLOCKED — secret-bearing paths in the payload:');
  for (const path of forbidden) console.error(`  ${path}`);
  process.exit(1);
}
console.log('Verified: no .secrets/ or *.key paths in the payload.');
console.log('─'.repeat(70));

if (checkOnly) {
  console.log('\n--check: verified, nothing uploaded.');
  process.exit(0);
}

console.log('\nDeploying to production…\n');
run('npx', ['vercel', 'deploy', '--prebuilt', '--prod', '--yes']);
