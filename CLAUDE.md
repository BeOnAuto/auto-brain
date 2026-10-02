# CLAUDE.md

## What this is

`auto-brain` is the runtime for business brains, a pnpm monorepo. It is source-available under the Elastic License 2.0 (see `LICENSING.md`); never call it open source. Its container image runs self-hosted and in Auto's cloud hosting on Cloudflare Containers. Auto Studio (the management plane, with governance and observability) and the Cloudflare side live in the private `on.auto` repo, not here.

- `packages/server`: the Node.js server (`@beonauto/server`), plus everything that packages it into a container (`Dockerfile`, `Dockerfile.dockerignore`)
- `packages/api`: the API (`@beonauto/api`), a Hono app that answers every request, with problem documents, the `Origin` and `Host` checks, authentication and the operation routes
- `packages/identity`: API keys, the local-mode rule and the key command (`@beonauto/identity`)
- `packages/*`: the server's libraries (`@beonauto/*`), including the ledger
- `primitives/*`: one package per brain primitive (interaction, orchestration, inference, prediction, computation, recollection, dream)
- `TODO.md`: setup work that is still outstanding

## Commands

```bash
pnpm dev               # Temporal's dev server, then the server, restarted on every save
pnpm dev:lean          # the server alone, restarted on every save, without workflows
pnpm --filter @beonauto/server container:build   # build the image locally
pnpm test:watch        # every package's tests in one Vitest watch process
pnpm typecheck:watch   # TypeScript 7 over the whole repo
pnpm check             # the full gate: format, lint, typecheck, test (100% coverage), knip, sherif
pnpm format            # oxfmt --write
pnpm lint:fix          # oxlint --fix
pnpm commit            # guided conventional commit (czg)
```

Run one package's gate with `pnpm turbo run lint typecheck test --filter @beonauto/server`.

## How the code runs

- Node runs `.ts` directly (native type stripping). There is no build step for the server or internal packages.
- Only erasable TypeScript: no `enum`, `namespace`, parameter properties or decorators.
- Relative imports carry the `.ts` extension. Type-only imports use `import type`.
- Workspace packages export their `src/index.ts`; import them by package name, never by relative path across packages.
- Tests run on Node's own module loader (`experimental.viteModuleRunner: false`), exactly as production does.

## Rules

- Follow the lint and TypeScript rules. You are not allowed to relax them, add disable directives, `@ts-ignore`, `any`, or `as` assertions. Fix the underlying problem.
- 100% coverage per file is the gate. Never add coverage-ignore comments or coverage excludes; write the test.
- Do not write comments. Make the code read like English through names and ordering.
- Tests live next to the code as `*.test.ts`, test behaviour through the public interface, and prefer injected fakes over mocks.
- A package with more than about 12 source files groups them one level deep, in folders named after concepts that hold fewer than about 15 files each, with tests beside the code they test. Nothing new goes directly under `src`, and there are no barrel files: the entry points are `src/index.ts`, `src/testing/index.ts` and a package's commands (the server's `src/main.ts` and `dev.ts`, the identity package's `src/key-command.ts`).
- Commits are conventional with a scope named after a package or primitive folder (`feat(server): ...`, `docs(inference): ...`); `global`, `deps`, `ci` and `release` are the other scopes.
- `pnpm check` must pass before you finish. Fixing a problem is a change, so rerun it.
- When something fails, assume your change broke it. What is on `main` passed the same gate.
