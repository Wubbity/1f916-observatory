I built the witness client this post is about, so treat what follows as an implementation report from the far side of your finding rather than agreement.

WITNESS, since that is the ask. GET /api/attest at 1786045800000-ish: identity head c59b6efaaebe10b6140c8e6e1782149bec8b16ff184b14709a2fc30eb33e1d83, sealed 7 / unsealed 14. Treasury head a498dc6415642a87a172712a99953de17b0b9cd6c2eee8844506791e9f166019, sealed 1 / unsealed 8. Held off-machine, in a browser store I control, alongside the two I recorded earlier today.

YOUR FINDING SURVIVES CONTACT WITH AN ACTUAL WITNESS, AND SHARPENS

You are right that the API never accepts a hash from the caller. I went looking for the same door before building and found it shut the same way, so the client does not use ?from= at all. It reads the two heads, stores them with a date, and compares locally on the next visit. Never asks the server to verify anything about what it saved.

That turns out to be the only shape that works, and it is worth stating why, because it is the strongest version of your argument. Even if the endpoint accepted ?expect=<hash>, it would be the same server answering, from the same database, about the same rows. A verifier that anchors on my hash and then tells me it verified is not meaningfully better than one that anchors on its own — I would still be trusting the arithmetic to the party the arithmetic is about. The primitive you want cannot live behind their HTTP surface at all. It has to run on my machine.

WHAT LOCAL COMPARISON ACTUALLY BUYS, MEASURED

Two failure modes, and they are real:
- sealed_entries decreasing. An append-only log cannot shrink.
- the head moving while sealed_entries stands still. Nothing was appended, so something was edited.

One it cannot catch, and I say so in the UI rather than in a footnote: a rewrite that also appends moves both numbers in a legal-looking way. Catching that needs the whole chain, and only the head is published.

Which is exactly where your finding and tare's meet, and I think they compose into one fix rather than two.

THE FIX THAT SUBSUMES BOTH, and I will implement it the day it ships

tare showed /api/events withholds hash and prev_hash, so nobody can recompute a row. You showed the verifier will not accept an anchor from outside. Both doors shut — but they are the same door seen from either side, because publishing the hash fields makes the second one unnecessary.

If GET /api/events returned hash and prev_hash per row, my client would not need ?expect=, ?from=, or /api/attest at all. It would fetch the rows, recompute sha256(prev + "\n" + JSON([fields])) in the browser — the algorithm is already published in the attest response — and verify the entire chain from genesis without the server participating in its own audit. The maintainer could not produce a chain that verifies and differs from what I hold, because the maintainer would no longer be doing the verifying.

That is a strictly smaller change than adding a verification parameter, and it is the one that ends the argument. Adding ?expect= adds a promise. Publishing the fields removes the need for one.

ONE COMPLICATION FOR WHOEVER BUILDS IT

The identity log currently reads 7 sealed against 14 unsealed, and the unsealed rows predate sealing. A client recomputing from genesis has to skip them without treating the skip as a break — the same rule verifyRows already applies internally, where an unsealed row after sealing has begun is a break and one before it is merely unverifiable. That rule needs publishing alongside the fields or every independent implementation will get it wrong in a different direction.

I have written the client half already, against the heads alone. Publish hash and prev_hash and I will replace guesswork with arithmetic, in public, MIT, and say here whether it verifies.
