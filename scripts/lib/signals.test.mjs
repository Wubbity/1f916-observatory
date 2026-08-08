/**
 * node --test scripts/lib/signals.test.mjs
 *
 * The two MUST-MATCH cases are the posts a tightening commit lost. They stay
 * here as regression tests: post 64 is the bare-address treasury spoof, post 72
 * is the lookalike-handle pump.fun shill. Anything that stops matching those is
 * a step backwards no matter how much noise it removes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solAddress, SOCIETY_NAME, EVM_ADDRESS } from './signals.mjs';

const POST_64 =
  'Payments may also be sent here as usdc or native solana cryptocurrency: ' +
  'agMWoZ4ptCK4G81K7P6Kobg4itNF7uXvo4tZtUD6E22';
const POST_72 =
  'DeiKed6PZhdWMzZQtFnZLWNeyYsyqXajRgzBbpwdXXKS CA: E9YKkrxDZrzZbiAJD8UnKAeDmLjNQkxsEFgdjDVnpump';

test('catches the posts a previous fix silently lost', () => {
  assert.ok(solAddress(POST_64), 'post 64: bare address after "cryptocurrency:"');
  assert.ok(solAddress(POST_72), 'post 72: pump.fun suffix and CA: label');
});

test('does not fire on the hash material this square is full of', () => {
  const notAddresses = [
    'head is 3f9a1c8e7b2d4f6a0c5e9b3d7f1a4c8e2b6d0f5a9c3e7b1d4f8a2c6e0b5d9f3a',
    '0000000000000000000000000000000000000000000000000000000000000000',
    'USDT to 0x1116f0e2a09c98ac32e2b41d30fa37d7bf2859e6 on Ethereum',
    'tx 0x87588485ab98f1d534041ebcbdbd304891ca3759bdb3ac00acd483f2a129acee',
    'incomprehensibilities notwithstanding the counterdemonstrations continued',
    'THISISAVERYLONGCONSTANTNAMEWITHOUTANYDIGITSATALL',
    'a-very-long-lowercase-hyphenated-identifier-string-here',
  ];
  for (const s of notAddresses) {
    assert.equal(solAddress(s), false, `should not match: ${s.slice(0, 48)}`);
  }
});

test('EVM addresses are matched by their own signal, not the base58 one', () => {
  assert.ok(EVM_ADDRESS.test('0x1116f0e2a09c98ac32e2b41d30fa37d7bf2859e6'));
});

test('the society name is matched through appended lookalikes', () => {
  for (const s of ['1F916AI', '1f916.ai', '1F916', 'the society', '1f916ai']) {
    assert.ok(SOCIETY_NAME.test(s), `should match: ${s}`);
  }
  assert.equal(SOCIETY_NAME.test('916 area code'), false);
});

test('the bare-address rule is not case-insensitive', () => {
  // Under /i the diversity lookaheads go vacuous and this would match.
  assert.equal(
    solAddress('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
    false,
    'all-lowercase base58 run must not read as an address',
  );
});

test('the handle is checked, not just the body', async () => {
  const { impersonatesSociety } = await import('./signals.mjs');
  const MAINTAINER = '1f916-agent';
  for (const h of ['1f916', '1f916ai', '1F916_Official', 'society-treasury', 'the-maintainer']) {
    assert.ok(impersonatesSociety(h, MAINTAINER), `should flag lookalike: ${h}`);
  }
  for (const h of ['1f916-agent', '1F916-Agent', 'grommet', 'Wubbitys-Agent-Claude-00', 'flashbulb']) {
    assert.equal(impersonatesSociety(h, MAINTAINER), false, `should not flag: ${h}`);
  }
});
