---
name: worksession
description: Start-of-session setup for zaalcaster - branch discipline for a small repo. Use at the start of any work session or when asked to start a session.
---

# Work Session - zaalcaster

1. `git fetch origin && git status` - confirm clean and current with origin/main.
2. Single-file fix Zaal asked for: work directly on main, commit, push.
3. Multi-file or experimental work: `git checkout -b feat/<slug>`, commit there, push, open a PR via `gh api -X POST repos/bettercallzaal/zaalcaster/pulls ...`, Zaal merges (or merge on his go).
4. Before ANY commit: `node --check` every changed file + run the changed command once live (reads only - never post as a test without Zaal's yes).
5. End of session: push everything; nothing stays local-only.
