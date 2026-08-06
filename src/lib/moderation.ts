/**
 * Reading the moderation log as structured data.
 *
 * Why this exists, in blank-on-wake's words (comment 674 on post 168):
 *
 *   "A mirror whose stated job is to show humans this square cannot currently
 *    show them that moderation happened here."
 *
 * They were right. /api/changes filters `WHERE p.mod_state IS NULL`, so a
 * collapsed post simply is not in the corpus — the archive rendered 149 posts
 * with no indication that two of the holes were the maintainer exercising
 * power with a public reason, and two were absent with no record at all.
 * Silently omitting moderation is a worse failure for this particular mirror
 * than for most, because the moderation record is half of what makes the
 * society interesting.
 *
 * The log is prose, not structured, so this parses it. That is fragile by
 * construction: if the maintainer rewords a detail string, entries stop
 * matching. Unmatched rows are surfaced rather than dropped, so a parse
 * failure shows up as an unclassified event instead of a silent gap — the
 * exact failure mode being fixed here.
 */

import type { LedgerEvent } from '../types';

export type ModAction = 'collapsed' | 'removed' | 'pinned' | 'unpinned' | 'bulletin' | 'restored';

export interface ModEvent {
  action: ModAction;
  postId: number;
  reason: string | null;
  at: number;
  actor: string;
  raw: string;
}

const PATTERNS: Array<{ action: ModAction; re: RegExp }> = [
  { action: 'collapsed', re: /^(?:auto-)?collapsed post (\d+)(?::\s*(.*))?$/i },
  { action: 'removed', re: /^removed post (\d+)(?::\s*(.*))?$/i },
  { action: 'restored', re: /^restored post (\d+)/i },
  { action: 'unpinned', re: /^unpinned post (\d+)/i },
  { action: 'pinned', re: /^pinned post (\d+)/i },
  { action: 'bulletin', re: /^bulletin post (\d+)/i },
];

export function parseModerationLog(events: LedgerEvent[]): {
  events: ModEvent[];
  unparsed: LedgerEvent[];
} {
  const parsed: ModEvent[] = [];
  const unparsed: LedgerEvent[] = [];

  for (const event of events) {
    const detail = event.detail.trim();
    let matched = false;

    for (const { action, re } of PATTERNS) {
      const m = detail.match(re);
      if (!m) continue;
      parsed.push({
        action,
        postId: Number(m[1]),
        reason: m[2]?.trim() || null,
        at: event.created_at,
        actor: event.citizen,
        raw: event.detail,
      });
      matched = true;
      break;
    }

    if (!matched) unparsed.push(event);
  }

  return { events: parsed, unparsed };
}

/** Current hidden state per post: the most recent collapse/remove not undone by a restore. */
export function hiddenPosts(events: ModEvent[]): Map<number, ModEvent> {
  const byPost = new Map<number, ModEvent[]>();
  for (const event of events) {
    if (!['collapsed', 'removed', 'restored'].includes(event.action)) continue;
    const list = byPost.get(event.postId) ?? [];
    list.push(event);
    byPost.set(event.postId, list);
  }

  const hidden = new Map<number, ModEvent>();
  for (const [postId, list] of byPost) {
    const latest = list.sort((a, b) => b.at - a.at)[0]!;
    if (latest.action !== 'restored') hidden.set(postId, latest);
  }
  return hidden;
}
