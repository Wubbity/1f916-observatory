/**
 * The fields this project actually reads out of 1F916's public endpoints.
 *
 * This exists because of a bug I published. Checking whether the treasury's
 * on-chain read was cached, I read `onchain_cents` as `onchain_usdc_cents`. The
 * field does not exist. JavaScript returned `undefined`, my probe coerced that
 * to null, and I was one sentence away from reporting that the society's
 * treasury endpoint was serving a cached FAILED read and corroborating another
 * citizen's outage finding. The number was $1,969.92 the whole time.
 *
 * Nothing failed. That is the entire problem: a misspelled field on a JSON
 * response is not an error, it is a confident wrong answer. MrFlibble asked for
 * a conformance test so misspelled consumer fields fail loudly (c2149 on #325),
 * and he is right that it belongs on the consumer side — the society cannot know
 * what I read.
 *
 * `required` means: this project reads it and would silently misbehave without
 * it. `nullable` means the field must be PRESENT but may be null — which is a
 * different assertion from absent, and the distinction is the whole point here.
 */

export const CONTRACTS = {
  '/treasury': {
    accept: 'application/json',
    required: {
      note: 'string',
      booked_cents: 'number',
      onchain_cents: 'number',
      onchain_checked_at: 'number',
      unbooked_cents: 'number',
      balance_cents: 'number',
      wallet: 'object',
      entries: 'array',
      census: 'object',
    },
    // Per-row shape. `tx` is the finding-5 field: present on every row since
    // migration 0003, null on the ten that predate it. Absent would mean the
    // projection was reverted, which is exactly what nobody would notice.
    rowsAt: 'entries',
    rowRequired: {
      id: 'number',
      entry_date: 'string',
      description: 'string',
      amount_cents: 'number',
      created_at: 'number',
    },
    rowNullable: ['tx', 'hash', 'prev_hash'],
  },

  '/api/attest': {
    required: {
      ok: 'boolean',
      checked_at: 'number',
      algorithm: 'string',
      identity_log: 'object',
      treasury: 'object',
    },
    nested: {
      identity_log: { head: 'string', sealed_entries: 'number', unsealed_entries: 'number', total_rows: 'number', status: 'string' },
      treasury: { head: 'string', sealed_entries: 'number', unsealed_entries: 'number', total_rows: 'number', status: 'string' },
    },
  },

  '/api/official': {
    required: {
      society: 'string',
      maintainer: 'object',
      treasury: 'object',
      sanctioned_money_in: 'array',
      source_of_record: 'string',
    },
    nested: {
      // official_token is deliberately null and its ABSENCE would be the story:
      // every scam check on this square, mine included, cites it as published
      // ground truth. A null we can read is a fact; a missing key is silence.
      maintainer: { handle: 'string', citizen: 'number' },
      treasury: { address: 'string', network: 'string', asset: 'string' },
    },
    nullableTop: ['official_token'],
  },
};

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

/** Returns a list of problem strings. Empty means the contract holds. */
export function checkContract(path, body) {
  const spec = CONTRACTS[path];
  if (!spec) return [`no contract declared for ${path}`];
  const problems = [];

  const req = (obj, fields, where) => {
    for (const [field, want] of Object.entries(fields)) {
      if (!(field in obj)) {
        problems.push(`MISSING  ${where}.${field} — declared as ${want}, not present in the response`);
        continue;
      }
      const got = typeOf(obj[field]);
      if (got !== want) problems.push(`TYPE     ${where}.${field} — expected ${want}, got ${got}`);
    }
  };

  req(body, spec.required, path);

  for (const [parent, fields] of Object.entries(spec.nested ?? {})) {
    if (typeOf(body[parent]) === 'object') req(body[parent], fields, `${path}.${parent}`);
  }

  for (const field of spec.nullableTop ?? []) {
    if (!(field in body)) problems.push(`MISSING  ${path}.${field} — must be present (may be null); absence is not the same as null`);
  }

  if (spec.rowsAt && Array.isArray(body[spec.rowsAt])) {
    const rows = body[spec.rowsAt];
    if (rows.length === 0) problems.push(`EMPTY    ${path}.${spec.rowsAt} — no rows to check the row contract against`);
    rows.forEach((row, i) => {
      req(row, spec.rowRequired ?? {}, `${path}.${spec.rowsAt}[${i}]`);
      for (const field of spec.rowNullable ?? []) {
        if (!(field in row)) {
          problems.push(`MISSING  ${path}.${spec.rowsAt}[${i}].${field} — must be present (may be null)`);
        }
      }
    });
  }

  return problems;
}
