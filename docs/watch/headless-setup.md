# Option 2 — headless watch via Windows Task Scheduler

Runs whether or not any app is open, survives reboots, and does not depend on a
session staying alive. This is the one to use if the square is ever relying on
the watch rather than merely benefiting from it.

Option 1 (the `scheduled-tasks` entry, already live) runs every 4 hours at :23
while the app is open, and catches up on next launch if it was closed. Good for
a trial. This replaces it if the trial holds.

---

## The command

```bat
claude -p "Read C:\Coding Projects\1f916-observatory\docs\watch\night-watch-prompt.md and follow it exactly. It is the authoritative brief. HARD RULE: never write to 1f916.ai — no posting, commenting, voting, flagging, moderating or registering. post.mjs, comment.mjs, vote.mjs and flag.mjs are off limits. Anything urgent goes at the top of the report marked URGENT and stops there; a human decides. Never print or transmit a citizen key." --add-dir "C:\Coding Projects\1f916-observatory"
```

The brief lives in the repo, not in the scheduler, on purpose: it is
version-controlled, reviewable in a diff, and cannot drift out of sync with the
scripts it calls. The scheduler entry is a trigger, not a policy.

## Creating the task

Run as your own user, not SYSTEM — it needs your Claude credentials and your
`gh` auth.

```powershell
$action  = New-ScheduledTaskAction -Execute "cmd.exe" -Argument '/c "C:\Coding Projects\1f916-observatory\docs\watch\run-watch.bat"'
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date.AddMinutes(23) -RepetitionInterval (New-TimeSpan -Hours 4)
$set     = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName "1F916 night watch" -Action $action -Trigger $trigger -Settings $set -Description "Read-only 1F916 chain witness, mention scan and scam triage. Never writes to the society."
```

`-StartWhenAvailable` makes it catch up after the machine was asleep.
`-MultipleInstances IgnoreNew` stops a slow run stacking on the next one.
`:23` rather than `:00` because every scheduler on the planet fires on the hour.

## Why not SYSTEM, and why not `-RunLevel Highest`

The task reads `.secrets/` and authenticates to GitHub as you. Running it
elevated or as SYSTEM widens what a bug in it can reach for no benefit — it
needs your user's files and nothing more.

## What it can and cannot do

**Can:** read every public 1F916 endpoint, recompute both hash chains, read the
repo, run `gh` read commands, write reports and logs into the repo, commit
locally.

**Cannot, by construction of the brief:** post, comment, vote, flag, moderate,
register, or push. The write scripts are named as off limits and the urgent path
terminates in a report rather than an action.

That boundary is a prompt, not a sandbox, and it should be treated as one. If
this ever needs to be a real guarantee rather than a strong instruction, the
right move is a separate key with no write scope — which 1F916 does not
currently offer, since a key is the citizen and carries every power the citizen
has. Worth knowing that limitation exists rather than assuming the instruction
is enforcement.

## Turning it off

```powershell
Unregister-ScheduledTask -TaskName "1F916 night watch" -Confirm:$false
```
