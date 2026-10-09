# CLAUDE.md

## What this is

`auto-brain` is the runtime for business brains, a pnpm monorepo. It is source-available under the Elastic License 2.0 (see `LICENSING.md`); never call it open source. Its container image runs self-hosted and in Auto's cloud hosting. Auto Studio (the management plane, with governance and observability) and the hosting side live in the private `on.auto` repo, not here.

- `packages/server`: the Node.js server (`@beonauto/server`), plus everything that packages it into a container (`Dockerfile`, `Dockerfile.dockerignore`)
- `packages/api`: the API (`@beonauto/api`), a Hono app that answers every request, with problem documents, the `Origin` and `Host` checks, authentication and the operation routes
- `packages/identity`: API keys, the local-mode rule and the key command (`@beonauto/identity`)
- `packages/*`: the server's libraries (`@beonauto/*`), including the ledger
- `capabilities/*`: the runtime adapters of the brain's capabilities. `reasoning` implements reasoning functions, `interaction` interaction functions, `computation` computation functions, `recall` recall functions and `coordination` workflows; `prediction` has a design note only.
- `TODO.md`: setup work that is still outstanding

Use the vocabulary in [Brain terminology](docs/concepts/terminology.md) in product text and domain code. A brain reasons, interacts, predicts, recalls and computes. Workflows coordinate those functions. The five function categories are Reasoning, Interaction, Prediction, Recall and Computation, in that order; coordination is a capability, not a sixth function type. A reasoning function has a prompt. A workflow or function definition is reusable; a run executes it against particular inputs.

The product is not live and has no stored data, so nothing keeps an old name beside a new one: no alias, no mapping, no anchor for an old heading and no test that an old name or an old record still works, and a local database made before a rename is deleted. Brain terminology is the one vocabulary, on the wire, in the ledger, in the package names and in the code: a definition has a `type`, `reasoning`, `interaction`, `computation`, `recall` or `workflow`, and a run has a `run_id`; a record whose own `type` names it, such as a ledger event, carries `definition_type`. The workflow engine's run-log formats are internal replay formats and follow their own rule, which its README sets out under [State formats](packages/workflow-engine/README.md#state-formats). `Capability` is the contract a capability package implements for the runtime, and is named for what it is.

Domain code names a definition for its resource: `WorkflowDefinition`, and `ReasoningFunctionDefinition`, `InteractionFunctionDefinition`, `PredictionFunctionDefinition`, `RecallFunctionDefinition` or `ComputationFunctionDefinition` once that function type is implemented. A definition's `type` is its one discriminator: `reasoning`, `interaction`, `prediction`, `recall` and `computation` for the five function types, and `workflow`, which is not a function type. A parsed source document is a `...DefinitionDocument`, and a factory of a runtime adapter is `make...Adapter`. **inference** names a model call and its provider's terms, **agent** an actual actor, such as an external coding agent, and **memory** the retention of information.

## Commands

```bash
pnpm dev               # the server, which runs workflows itself, restarted on every save
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
- A package with more than about 12 source files groups them one level deep, in folders named after concepts that hold fewer than about 15 files each, with tests beside the code they test. Nothing new goes directly under `src`, and there are no barrel files: a package's entry points are the few paths its `exports` map names (`src/index.ts`, `src/testing/index.ts` and, where its README says why, a subpath) and its commands (the server's `src/main.ts` and `dev.ts`, the identity package's `src/key-command.ts`).
- Commits are conventional with a scope named after a package or capability folder (`feat(server): ...`, `docs(reasoning): ...`); `global`, `deps`, `ci` and `release` are the other scopes.
- `pnpm check` must pass before you finish. Fixing a problem is a change, so rerun it.
- When something fails, assume your change broke it. What is on `main` passed the same gate.
