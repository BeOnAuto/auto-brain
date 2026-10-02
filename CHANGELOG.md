# Changelog

## [1.1.0](https://github.com/BeOnAuto/auto-brain/compare/v1.0.1...v1.1.0) (2026-10-02)


### Features

* **api:** authenticate callers and serve the brain operations over HTTP ([#66](https://github.com/BeOnAuto/auto-brain/issues/66)) ([4d744b0](https://github.com/BeOnAuto/auto-brain/commit/4d744b0ae91a18786ad71f2f14d61f02c21a4cfd))
* **api:** serve every operation on one MCP endpoint ([#74](https://github.com/BeOnAuto/auto-brain/issues/74)) ([7b1d79f](https://github.com/BeOnAuto/auto-brain/commit/7b1d79ff7cd7f766128194bc60caa28e364e97ab))
* **api:** serve operations as MCP tools ([#69](https://github.com/BeOnAuto/auto-brain/issues/69)) ([266df06](https://github.com/BeOnAuto/auto-brain/commit/266df06b1f47b54d34837d0f6605aff3e47dafe1))
* **brains:** add the brain operations and the ledger that stores them ([#64](https://github.com/BeOnAuto/auto-brain/issues/64)) ([3d0cfe5](https://github.com/BeOnAuto/auto-brain/commit/3d0cfe5d791f512e20361c87ba3377a313c1ae79))
* **inference:** execute prompts as specs ([#71](https://github.com/BeOnAuto/auto-brain/issues/71)) ([fda92e7](https://github.com/BeOnAuto/auto-brain/commit/fda92e76104f2c5b9ec15328ea98a7a8b921c1ee))
* **inference:** tell callers which model providers a server has ([#79](https://github.com/BeOnAuto/auto-brain/issues/79)) ([4d522f6](https://github.com/BeOnAuto/auto-brain/commit/4d522f667a999d3aef15203ecfddc16c3a2dfb79))
* **operations:** add the application layer ([#61](https://github.com/BeOnAuto/auto-brain/issues/61)) ([c8c4a4a](https://github.com/BeOnAuto/auto-brain/commit/c8c4a4a98eec849a341114e3483470bcdc28e102))
* **orchestration:** run workflow specs on Temporal ([#70](https://github.com/BeOnAuto/auto-brain/issues/70)) ([b0faa0f](https://github.com/BeOnAuto/auto-brain/commit/b0faa0fceac43e3cfc3ed206ecab4761369132db))
* **server:** read structured settings from a YAML configuration file ([#80](https://github.com/BeOnAuto/auto-brain/issues/80)) ([1460def](https://github.com/BeOnAuto/auto-brain/commit/1460defec12e0910731d73d67136ff7973dfc7df))
* **server:** readable start-up and a quick start for AI assistants ([#77](https://github.com/BeOnAuto/auto-brain/issues/77)) ([a9fcb65](https://github.com/BeOnAuto/auto-brain/commit/a9fcb65bedb70185f7660d5b38f8f8d169b00ad9))
* **server:** run a local Temporal with pnpm dev ([#75](https://github.com/BeOnAuto/auto-brain/issues/75)) ([be0b02a](https://github.com/BeOnAuto/auto-brain/commit/be0b02af2393a1cb34f361482e3a0dd9dbe7947d))
* **server:** serve workflows ([#72](https://github.com/BeOnAuto/auto-brain/issues/72)) ([aecb3f9](https://github.com/BeOnAuto/auto-brain/commit/aecb3f94109d7ced3b04f3986a469a9ce2ff132e))
* **specs:** add the spec operations ([#67](https://github.com/BeOnAuto/auto-brain/issues/67)) ([7651e40](https://github.com/BeOnAuto/auto-brain/commit/7651e40498ce65993d2e8478b25ae586b1571283))


### Bug Fixes

* **api:** judge the arguments of an MCP tool call as HTTP does ([#76](https://github.com/BeOnAuto/auto-brain/issues/76)) ([b07642d](https://github.com/BeOnAuto/auto-brain/commit/b07642dbe6c3434bf65869180d116cf166a566d9))

## [1.0.1](https://github.com/BeOnAuto/auto-brain/compare/v1.0.0...v1.0.1) (2026-09-30)


### Bug Fixes

* **global:** remove the duplicate recollation folder and third-party references ([#57](https://github.com/BeOnAuto/auto-brain/issues/57)) ([28f3184](https://github.com/BeOnAuto/auto-brain/commit/28f3184c8c8247c9ec6ae44471de9de163e35e76))

## 1.0.0 (2026-09-30)


### Features

* **global:** rebuild auto-brain as a Node 26 TypeScript monorepo ([#46](https://github.com/BeOnAuto/auto-brain/issues/46)) ([405d04b](https://github.com/BeOnAuto/auto-brain/commit/405d04bd1b7b7e824c06369041273f10d28fddcf))
