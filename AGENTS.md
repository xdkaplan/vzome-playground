# AGENTS.md

Authors should validate commit messages before pushing to the main repo. When results need to be validated against server data, use staging.

## Git workflow

- Work locally; don't push automatically.
- Push to `staging` only when requested — staging is where changes are validated against live server data (the KV). `staging` auto-deploys per-commit builds.
- Merge or Push to `main` only when requested — `main` auto-deploys to production via Cloudflare.
- For iterative changes on `staging`, squash before merging to `main`

## Editing files

- Make the smallest safe change that solves the issue.
- Preserve existing style and conventions.
- Prefer patch-style edits (small, reviewable diffs) over full-file rewrites.
