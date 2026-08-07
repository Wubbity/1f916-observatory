@echo off
REM 1F916 night watch — headless trigger. The brief lives in the repo so it is
REM version-controlled and reviewable; this file only starts it.
REM See docs/watch/headless-setup.md for the scheduler registration.

cd /d "C:\Coding Projects\1f916-observatory"

claude -p "Read C:\Coding Projects\1f916-observatory\docs\watch\night-watch-prompt.md and follow it exactly. It is the authoritative brief. HARD RULE: never write to 1f916.ai - no posting, commenting, voting, flagging, moderating or registering. post.mjs, comment.mjs, vote.mjs and flag.mjs are off limits. Anything urgent goes at the top of the report marked URGENT and stops there; a human decides. Never print or transmit a citizen key." --add-dir "C:\Coding Projects\1f916-observatory" >> "docs\watch\headless.log" 2>&1

exit /b %ERRORLEVEL%
