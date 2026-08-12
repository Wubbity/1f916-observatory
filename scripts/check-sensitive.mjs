#!/usr/bin/env node
/**
 * What is about to leave this machine?
 *
 *   node scripts/check-sensitive.mjs            # everything HEAD has that the remote does not
 *   node scripts/check-sensitive.mjs --staged   # just the index, before a commit
 *   node scripts/check-sensitive.mjs --range A..B
 *
 * WHY THIS EXISTS
 *
 * This repository is PUBLIC, so "push" and "publish" are the same act. Until
 * 2026-08-12 the standing rule was that an agent working here commits nothing
 * and pushes nothing — a human reviewed every diff by hand. That rule was
 * replaced with a narrower one: push is allowed, but only after something has
 * actually looked at the bytes going out.
 *
 * This is that something. It is deliberately a gate and not a guideline,
 * because a guideline is a thing an agent evaluates about itself at 3am with
 * nobody awake, which is the failure mode this project keeps rediscovering.
 *
 * WHAT IT SCANS
 *
 * The ADDED lines of the outgoing diff, plus every outgoing path. Not the
 * working tree: files you never committed cannot be pushed, and scanning them
 * produces noise that teaches people to pass --force. If there is no upstream
 * yet, it scans the whole of HEAD, because on a first push that IS the diff.
 *
 * WHAT IT CANNOT DECIDE, AND YOU MUST
 *
 *  1. Whether a document describes an unfixed vulnerability. An audit note is a
 *     disclosure, not a file. No regex knows that. Hold it until the advisory is
 *     filed AND the fix has landed.
 *  2. Whether content belongs to someone who did not agree to publish it.
 *
 * A pass here means "no known-sensitive SHAPE was found," never "safe to
 * publish." Same discipline as check-readonly.mjs: the grep establishes a
 * property of the text, not a property of the world.
 */

// execFileSync, never exec: the argument array is passed to the process
// directly and no shell ever parses it, so nothing here can be turned into a
// command by the content of a branch name or a path. Every call site below
// passes a fixed literal argv.
import { execFileSync } from 'node:child_process';
import { homedir, userInfo } from 'node:os';
import { basename } from 'node:path';

const argv = process.argv.slice(2);
const rangeArg = argv.indexOf('--range');
const MODE = argv.includes('--staged') ? 'staged' : rangeArg !== -1 ? 'range' : 'outgoing';
const RANGE = rangeArg !== -1 ? argv[rangeArg + 1] : null;

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const tryGit = (...args) => {
  try {
    return git(...args).trim();
  } catch {
    return null;
  }
};

/**
 * The local identity, derived at runtime and never written down.
 *
 * Hardcoding the operator's home path into a file that gets pushed to a public
 * repo would be the exact leak this script exists to prevent. os.homedir() and
 * userInfo() give the same coverage with nothing to commit.
 */
const HOME = homedir();
const USER = userInfo().username;
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const RULES = [
  {
    id: 'operator-home-path',
    why: "a home directory carries the operator's account name",
    // Both the literal local home and the general shape, so this keeps working
    // on another machine and catches a teammate's path too.
    rx: new RegExp(
      `${escape(HOME)}|${escape(HOME.replace(/\\/g, '/'))}|[A-Za-z]:\\\\Users\\\\[A-Za-z0-9._-]+|/(?:Users|home)/[A-Za-z0-9._-]+`,
      'gi',
    ),
    allow: /\/(?:Users|home)\/(?:user|username|example|placeholder|yourname|runner|<)/i,
  },
  {
    id: 'operator-username',
    why: 'the local account name identifies a person and their machine',
    rx: new RegExp(`\\b${escape(USER)}\\b`, 'g'),
    // The public GitHub handle and the public citizen handle are not this.
    allow: /^(?:Wubbity|Wubbitys-Agent-Claude-00)$/,
  },
  {
    id: 'citizen-secret',
    why: 'a 1F916 bearer secret IS the citizen; there is no recovery',
    rx: /\b1f916_sk_[A-Za-z0-9]+/g,
  },
  {
    id: 'vendor-token',
    why: 'a credential in a public commit is compromised the moment it lands',
    rx: /\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[A-Za-z0-9_-]{30,})\b/g,
  },
  {
    id: 'private-key-block',
    why: 'a PEM block is the key itself, not a reference to one',
    rx: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  },
  {
    id: 'assigned-secret',
    why: 'a secret assigned inline is a secret whatever the variable is called',
    rx: /\b(?:secret|passwd|password|api[_-]?key|access[_-]?token|auth[_-]?token|private[_-]?key)\s*[:=]\s*["'][^"'\n]{8,}["']/gi,
    allow: /["'](?:<[^>]*>|\$\{?[A-Z_]+|process\.env|xxx+|placeholder|example|redacted|your-)/i,
  },
  {
    id: 'email-address',
    why: 'an email in a public commit outlives every intention its author had',
    rx: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    allow: /@(?:example\.(?:com|org|net)|users\.noreply\.github\.com|1f916\.ai)$/i,
  },
  {
    id: 'private-ip-literal',
    why: "a private address maps the operator's network",
    rx: /\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/g,
  },
];

// The scanner necessarily contains every shape it looks for. Scanning its own
// added lines would fail every commit that touches it, so it is exempt from
// itself — and that exemption is printed, not silent.
const SELF = 'scripts/' + basename(new URL(import.meta.url).pathname);

let range = RANGE;
let scope;
if (MODE === 'outgoing') {
  const upstream = tryGit('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}');
  if (upstream) {
    range = `${upstream}..HEAD`;
    scope = `commits on HEAD that ${upstream} does not have`;
  } else {
    range = null;
    scope = 'the entire history of HEAD (no upstream — a first push sends all of it)';
  }
} else if (MODE === 'staged') {
  scope = 'the staged index';
} else {
  scope = `the range ${range}`;
}

let diff = '';
let files = [];
if (MODE === 'staged') {
  diff = git('diff', '--cached', '--unified=0');
  files = git('diff', '--cached', '--name-only').split('\n').filter(Boolean);
} else if (range) {
  diff = git('diff', '--unified=0', range);
  files = git('diff', '--name-only', range).split('\n').filter(Boolean);
} else {
  diff = git('log', '-p', '--unified=0', 'HEAD');
  files = git('ls-files').split('\n').filter(Boolean);
}

console.log(`check-sensitive: scanning ${scope}`);
console.log(`  ${files.length} file(s), ${diff.split('\n').length} diff line(s)\n`);

if (!diff.trim()) {
  console.log('Nothing outgoing. Nothing to check.');
  process.exit(0);
}

// Added lines only, tagged with the file they landed in.
const added = [];
let current = '';
for (const line of diff.split('\n')) {
  const header = /^\+\+\+ b\/(.+)$/.exec(line);
  if (header) {
    current = header[1];
    continue;
  }
  if (line.startsWith('+') && !line.startsWith('+++')) added.push({ file: current, text: line.slice(1) });
}

const hits = [];
for (const { file, text } of added) {
  if (file === SELF) continue;
  for (const rule of RULES) {
    rule.rx.lastIndex = 0;
    for (const m of text.matchAll(rule.rx)) {
      if (rule.allow?.test(m[0])) continue;
      hits.push({ file, rule: rule.id, why: rule.why, match: m[0] });
    }
  }
}

// Paths can leak on their own — a file named for a person, or a stray .env.
const PATH_RULES = [
  { id: 'env-file', rx: /(^|\/)\.env(\.|$)/ },
  { id: 'key-file', rx: /\.(?:pem|p12|pfx|keystore|jks)$/i },
  { id: 'local-state', rx: /(^|\/)\.state\// },
];
for (const f of files) {
  for (const rule of PATH_RULES) {
    if (rule.rx.test(f)) hits.push({ file: f, rule: `path:${rule.id}`, why: 'this path should not be published', match: f });
  }
}

if (files.includes(SELF)) console.log(`Note: ${SELF} is exempt from its own patterns (it contains all of them).\n`);

if (hits.length === 0) {
  console.log('No known-sensitive shape found in the outgoing content.');
  console.log('\nThat is a property of the TEXT, not a clearance. Two things this');
  console.log('cannot see and you must decide yourself:');
  console.log('  1. Does anything here describe an unfixed vulnerability? Hold it');
  console.log('     until the advisory is filed and the fix has landed.');
  console.log('  2. Does anything here belong to someone who did not agree to publish it?');
  process.exit(0);
}

console.log(`${hits.length} possible disclosure(s):\n`);
for (const h of hits) {
  const shown = h.match.length > 60 ? h.match.slice(0, 57) + '…' : h.match;
  console.log(`  ${h.file}`);
  console.log(`    [${h.rule}] ${shown}`);
  console.log(`    ${h.why}`);
}
console.log('\nDo not push. Rewrite the content, or drop the file from the commit.');
console.log('A secret that reached a public remote is compromised even after a force-push.');
process.exit(1);
