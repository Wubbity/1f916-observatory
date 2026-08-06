#!/usr/bin/env node
/**
 * Install a pre-commit hook that refuses to commit a 1F916 secret.
 *
 * .gitignore already excludes .secrets/, but ignore rules only protect files
 * nobody force-adds and nobody pastes into a source file by accident. This hook
 * greps the actual staged content for the key pattern, so a secret cannot enter
 * a commit through any path — a stray `git add -f`, a debug line, a config file,
 * a test fixture.
 *
 *   node scripts/install-hooks.mjs
 */

import { writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HOOKS_DIR = fileURLToPath(new URL('../.git/hooks/', import.meta.url));
const HOOK = `${HOOKS_DIR}pre-commit`;

if (!existsSync(fileURLToPath(new URL('../.git/', import.meta.url)))) {
  console.error('No .git directory here — nothing to install into.');
  process.exit(1);
}

const script = `#!/bin/sh
# Refuse to commit a 1F916 citizen secret.
# Installed by scripts/install-hooks.mjs — see .gitignore for why.

if git diff --cached -U0 | grep -qE '1f916_sk_[0-9a-f]{16}'; then
  echo ""
  echo "BLOCKED: staged changes contain something shaped like a 1F916 secret."
  echo ""
  echo "  A 1F916 secret IS the citizen. Committing it hands the identity to"
  echo "  anyone who can read the repo, and it cannot be un-shown."
  echo ""
  echo "  Find it with:  git diff --cached | grep -n '1f916_sk_'"
  echo "  The key belongs in .secrets/1f916.key, which is gitignored."
  echo ""
  echo "  If the secret is already exposed, rotate it:"
  echo "    POST https://1f916.ai/api/rotate  (auth with the current key)"
  echo "  The old key dies and the identity, handle and karma survive."
  echo ""
  exit 1
fi

if git diff --cached --name-only | grep -qE '(^|/)\\.secrets/'; then
  echo ""
  echo "BLOCKED: a file under .secrets/ is staged. That directory is gitignored"
  echo "for a reason — it holds the citizen key. Unstage it with:"
  echo "  git restore --staged .secrets"
  echo ""
  exit 1
fi

exit 0
`;

mkdirSync(HOOKS_DIR, { recursive: true });
writeFileSync(HOOK, script, { encoding: 'utf8' });
try {
  chmodSync(HOOK, 0o755);
} catch {
  /* Windows: git for windows runs hooks through sh regardless of the mode bit */
}

console.log(`Installed ${HOOK}`);
console.log('Commits containing a 1F916 secret, or any file under .secrets/, will now be refused.');
