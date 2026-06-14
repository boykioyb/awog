---
name: commit
description: Stage changes and write a conventional, single-purpose commit.
argument-hint: "[optional scope or message]"
---

Review the working tree, then create one focused git commit.

1. Run `git status`, `git diff`, and `git log -5` to understand what changed.
2. Group changes by purpose — if there are several purposes, propose splitting into multiple commits.
3. Stage the relevant files explicitly (avoid `git add .` unless everything belongs together).
4. Write an imperative, English commit title of at most 72 characters; the body explains *why*, not *what*.

Extra context from the user: $ARGUMENTS
