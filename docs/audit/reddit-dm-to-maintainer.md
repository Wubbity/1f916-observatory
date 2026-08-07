# DRAFT — Reddit DM to the 1F916 operator. NOT SENT.

**Subject:** Two exploitable findings in 1f916.ai — disclosing privately before posting

---

Hi — I'm the human behind `Wubbity` and `Wubbitys-Agent-Claude-00` on 1f916.ai, and the [1F916 Observatory](https://1f916-observatory.vercel.app), the read-only human mirror of the square. My agent has been auditing the source for two days; several of its findings are already merged (the `/api/changes` cursor, the collapse that did nothing to comments, the non-atomic moderation log, and PR #11 on the tag layer).

It ran a full audit this morning and found **two things I don't want to put on the square first**, because they're working exploits before they're arguments and the public write-up would read as a how-to. The source is public so both are derivable — but derivable isn't the same as published with a method, so you get them first.

**Both are fixed in [PR #17](https://github.com/1f916-ai/1f916/pull/17), already open.** Nothing was demonstrated against the live society; these are reasoned from source, and we deliberately didn't prove them by doing them.

---

**1. The daily caps aren't atomic, and nothing in the schema enforces them.**

`createPost`, `createComment` and `castVote` each do `SELECT COUNT(*)` → throw → `INSERT`, with `await` boundaries between. `idx_posts_citizen_day` is a plain index, not a unique constraint. Two requests carrying the same key, in flight together, both read the same count, both pass, both write.

Rule 3 is the constitution's load-bearing mechanism — karma means something because votes are scarce, the front page means something because posts are scarce — and it's currently advisory against anything concurrent.

The PR makes the cap part of the write itself: `INSERT ... SELECT ... WHERE (SELECT COUNT(*)) < cap`, one statement, so concurrent writers serialize under the same lock. No new table, no migration.

**2. Five free keys can collapse any post or comment in the square.**

`FLAG_COLLAPSE_THRESHOLD = 5` counts raw distinct citizens with no weighting. Registration allows 3 per IP per hour, and grommet documented an eighteen-key farm minted in forty-six seconds (post 124) that's still standing (post 150). So the cost of unilaterally hiding *anything* — an audit, a bulletin, someone's dissent — is five free registrations. The moderation row is written under `MAINTAINER_ID`, so the log doesn't even name who caused it.

The part I'd flag hardest: this is the same weakness commit `6ab20cd` already fixed one layer over. Vote *ranking* was tenure-weighted precisely because raw distinct-key counts are cheap to manufacture. The signal that decides what floats got hardened; the signal that decides what **disappears** didn't.

The PR applies the same curve to flags and makes the moderation row name the flagging handles. A five-key farm minted today carries 0.5 against a threshold of 5; five week-old citizens still clear it.

---

Five more findings are in the PR and are safe to discuss openly — a patron inscription that could forge a transaction reference into the sealed books, `/treasury` amplifying one anonymous GET into four uncached outbound RPC calls, `recordLedger` enforcing none of the "must cite the on-chain tx" constraint its own commit claims, plus two lower ones.

**One honest caveat, stated in the PR too:** the concurrency fixes have no database test, because the test suite is pure-function only and D1 isn't exercised in CI. Someone should exercise both against a local D1 before merging. My agent couldn't, and would rather say so than let a green checkmark imply more than it covers.

**One request.** The PR adds an RFC 9116 `security.txt` at `/.well-known/security.txt`, with **placeholder** contact values, because only you can supply real ones. Given that hundreds of agents scour that source and several have already found genuine defects — every one of which arrived as a public post, because a public post was the only door — a machine-readable contact seems worth more on 1f916.ai than on almost any site on the internet. Agents parse that file by convention. If you tell me what address you want in it, I'll update the PR; if you'd rather drop it, that's fine too.

We're planning to post the audit to the square today, describing findings 1 and 2 **by class only** — "the caps aren't atomic", "the flag threshold inherits the sybil weakness votes already fixed" — with no exploitation detail, and only after you've had a chance to respond. Say the word if you'd like us to hold longer, or if you'd rather we not post them at all.

Genuinely: this has been the most interesting thing on the internet for two days, and the speed you fix things at is most of why. Happy to keep going.

— Wubbity
