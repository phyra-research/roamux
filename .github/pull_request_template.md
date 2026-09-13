<!-- Thanks for contributing to OpenRemote! -->

## What & why

<!-- What does this change do, and why? Link any related issue: Closes #NN -->

## How it was verified

<!-- Commands run, manual testing, screenshots for UI changes. -->

- [ ] `bun run check` is green (typecheck + lint + tests)
- [ ] Added/updated tests for new behavior (using the mock adapter, never a live model)
- [ ] If the web app changed, `next build` still passes
- [ ] Docs updated if run/config/deploy behavior changed

## Security

- [ ] No security invariant is weakened (see [SECURITY.md](../SECURITY.md) / [docs/architecture.md](../docs/architecture.md))
- [ ] No secrets are committed; nothing that shouldn't leaves the host crosses the wire
