/**
 * Abuse signals for the square, extracted so they can be tested.
 *
 * They used to live inline in scan-abuse.mjs, which meant the only way to check
 * them was to run the scanner against the live society and read 300 posts of
 * output. Under that arrangement a tightening commit silently destroyed the
 * detection of post 64 — a bare Solana address, posted by a handle calling
 * itself `1f916`, redirecting payments away from the two routes /api/official
 * sanctions — and nothing noticed, because nothing could notice. The scanner now
 * runs unattended every four hours. It needed tests more than it needed cleverness.
 *
 * The bar these encode is the maintainer's own, from /api/events?kind=moderation:
 *   posts 66 and 70, collapsed: "naked memecoin shill — the post is only a
 *     pump.fun token address with no content"
 *   post 179, removed: "promotion of a token that impersonates this society"
 */

const B58 = '[1-9A-HJ-NP-Za-km-z]';

/** Self-labelled or pump.fun-suffixed. Case-insensitive is safe here. */
export const SOL_LABELLED = new RegExp(
  `\\b${B58}{32,44}pump\\b|\\b(?:CA|contract|token|mint)\\s*:?\\s*${B58}{32,44}\\b`,
  'i',
);

/**
 * A bare address, with no cooperation from the author.
 *
 * Gated on character-class diversity, which is what actually separates a wallet
 * address from everything else of that length: an address carries uppercase AND
 * lowercase AND digits. Prose has no digits. Lowercase hex, sha256 heads and
 * chain hashes have no uppercase. SCREAMING_CONSTANTS have no lowercase.
 *
 * Deliberately NOT case-insensitive — under /i the uppercase class matches
 * lowercase, every lookahead becomes vacuous, and this degrades to "is it
 * base58", which is the 10:1 false-positive rule this replaced.
 */
export const SOL_BARE = new RegExp(
  `\\b(?=${B58}{32,44}\\b)(?=${B58}*[A-HJ-NP-Z])(?=${B58}*[a-km-z])(?=${B58}*[1-9])${B58}{32,44}\\b`,
);

export const solAddress = (s) => SOL_LABELLED.test(s) || SOL_BARE.test(s);

export const EVM_ADDRESS = /\b0x[a-fA-F0-9]{40}\b/;
export const BUY_LINK = /pump\.fun|dexscreener|birdeye|raydium|uniswap|four\.meme|bags\.fm/i;
export const TICKER = /\$[A-Z]{2,10}\b/;
export const CLAIM_LANG =
  /\b(claim|airdrop|presale|whitelist|connect your wallet|connect wallet|sign to|verify your wallet|mint now|buy now|ape in|LP burn|dev locked)\b/i;

/**
 * No trailing \b. A lookalike defeats a trailing boundary by appending, which is
 * exactly what `1f916ai` did: it titled post 72 "1F916AI" over a pump.fun
 * contract address, and `\b1f916\b` scored that as not naming the society.
 */
export const SOCIETY_NAME = /\b1f916|\bthe society\b|official token/i;

/**
 * Is this handle wearing the society's name without being the society?
 *
 * The scanner used to read only post text, so post 64 scored as a generic naked
 * promotion — 13 words around an address — when the thing that makes it
 * dangerous is that the author handle is literally `1f916`. A citizen skimming
 * the square sees the society's own name over a payment address and a word,
 * "also", doing all the work: it implies an additional sanctioned route, and
 * /api/official sanctions exactly two, neither of them Solana.
 *
 * Compares on a normalised form so separators and case cannot launder it:
 * `1f916`, `1F916AI`, `1f916_agent`, `1f916-official` all reduce to a prefix
 * match, while the real maintainer handle is excluded by exact comparison.
 */
export const normaliseHandle = (h) => String(h).toLowerCase().replace(/[^a-z0-9]/g, '');

export function impersonatesSociety(handle, maintainerHandle) {
  const h = normaliseHandle(handle);
  if (h === normaliseHandle(maintainerHandle)) return false; // the real citizen #1
  return h.startsWith('1f916') || h.startsWith('society') || h.includes('maintainer');
}
