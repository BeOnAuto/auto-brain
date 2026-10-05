# Contribute to the documentation

Runtime documentation lives in this public repository so a pull request can change behavior and its explanation together. The Auto website publishes these pages alongside its own Cloud guides and marketing content.

## Documentation types

Use [Diátaxis](https://diataxis.fr/) to distinguish learning, completing a task, looking up a fact and understanding a concept. The sidebar uses familiar product labels; a page's purpose determines what belongs in it.

| Purpose                                            | Where it belongs | What the reader should get                                                       |
| -------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------- |
| [Explanation](https://diataxis.fr/explanation/)    | Concepts         | A model of how the pieces fit and why the distinctions matter                    |
| [Tutorial](https://diataxis.fr/tutorials/)         | Get started      | One guided exercise with supplied inputs and visible results                     |
| [How-to guide](https://diataxis.fr/how-to-guides/) | Guides           | Steps to complete a specific task, assuming the reader knows the basics          |
| [Reference](https://diataxis.fr/reference/)        | Reference        | Precise formats, fields, limits and behavior that can be looked up independently |

In a tutorial, choose the example for the reader. State prerequisites, show what should happen after each meaningful action, and include a repeatable check. Distinguish an expected model answer from output you have actually tested. Do not invent screens, endpoints or model access to make the instructions appear complete.

A guide can offer choices needed for its task, such as which Apollo connection provides business data. A reference should describe each option without turning into a walkthrough. Link to an explanation when a reader needs the reasoning behind a rule; keep that discussion out of a procedure's steps.

Use ordinary language and examples grounded in the product. Keep API names exact, avoid claims without evidence and centralize capability status on [Functions](../concepts/functions.md#availability). Repeat a status only where its absence would make the page misleading, such as an upcoming internal tool-access capability.

## What belongs here

Keep local setup and agent connection instructions, shared concepts, available function behavior, the self-hosting overview and HTTP/MCP reference in the public pages under `docs/`. Keep Cloud availability, account management, hosted OAuth setup, pricing and marketing pages in the website repository.

Implementation notes and contributor APIs remain in package READMEs and root contributor files. Link to the user guide instead of maintaining a second copy of it.

Detailed development setup, deployment configuration and transitional implementation guides belong in `docs/engineering/`. Architecture decision records belong in `docs/decisions/`. Both directories stay beside the code and are excluded from the public preview, search, navigation and website import. Do not add them to `nav.json` or link to them through a public documentation route. GitHub links can direct contributors to these repository-only notes.

Keep repository-only guides accurate for the checkout. Public workflow pages describe the behavior the runtime offers today. Update the relevant public guide when a change becomes available to users.

## Preview and check

From a checkout with pnpm installed:

```sh
pnpm install
pnpm docs:dev
```

Open the `/docs/` URL printed by VitePress. The preview uses the default theme and does not require the private website repository, an Auto account or model credentials.

Before opening a pull request:

```sh
pnpm docs:check
pnpm check
```

The docs check validates navigation and builds every public Markdown page with dead-link detection. It also checks that engineering guides and decisions stay outside the published output. The CI documentation job runs for public pull requests without private credentials. Fix build failures in the source page; do not disable link checks.

Each successful Documentation workflow uploads a `runtime-docs-<commit>` artifact containing the built preview. Open the workflow run from the pull request's checks and download it from Artifacts. Artifacts remain available for 14 days. This does not deploy a public site and needs no private repository or deployment token.

To view the downloaded build, check out the matching pull request and run `pnpm install`. Extract the artifact contents into `docs/.vitepress/dist`, then run:

```sh
pnpm docs:preview
```

Open the printed `/docs/` URL. Serve the preview through VitePress rather than opening `index.html` directly, so its routes and assets resolve correctly.

## Add or change a page

Create Markdown under the relevant directory and add its route to `docs/nav.json`. Links in that file are relative to the documentation base, such as `/concepts/brains`; do not prefix them with `/docs`.

Use relative Markdown links inside pages, such as `../concepts/functions.md`. They work in the repository, the standalone preview and the composed website. Keep assets in `docs/assets/` and refer to them relatively. Do not place secrets or Cloud account information in public examples.

Describe the checkout's implemented behavior precisely. Mark planned capabilities in their own sections and keep current API identifiers in executable examples. Inspect `structuredContent` when consuming MCP results; the first text block is a human-readable summary, not a JSON envelope.

## Publication contract

The Auto website imports public Markdown, `assets/` and `nav.json` from a pinned runtime commit. Its own documentation index can replace this preview's `index.md`. The import excludes `engineering/`, `decisions/`, `.vitepress`, generated output and tooling.

The website combines both sources in one build, with a shared sidebar and search. Imported pages link back to the corresponding public file through Edit this page. They are generated build inputs in the website; contributors edit the original here.

Updating the website's source pin publishes approved documentation changes. Release documentation should match the runtime release; documentation-only corrections can update the pin without a new runtime release. Use source links to identify the imported revision and mark upcoming capabilities on the pages that describe them.

The standalone preview is for review, not a separate production documentation website. See the repository's [contribution guidelines](https://github.com/BeOnAuto/auto-brain/blob/main/CONTRIBUTING.md) and [security reporting policy](https://github.com/BeOnAuto/auto-brain/blob/main/SECURITY.md).
