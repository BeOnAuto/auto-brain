# CLAUDE.md

## What this is

`auto-brain` is a pnpm monorepo for a Node.js server runtime. The same container image runs on Cloudflare Containers (the public offering) and on-prem.

- `apps/server`: the Node.js server (`@beonauto/server`)
- `apps/cloudflare`: the Cloudflare Worker that fronts the server container (`@beonauto/cloudflare`)
- `packages/*`: internal libraries (`@beonauto/*`)

## Commands

```bash
pnpm dev               # server with node --watch
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
- Commits are conventional with a workspace scope (`feat(server): ...`); `global`, `deps`, `ci` and `release` are the other scopes.
- `pnpm check` must pass before you finish. Fixing a problem is a change, so rerun it.
- When something fails, assume your change broke it. What is on `main` passed the same gate.
