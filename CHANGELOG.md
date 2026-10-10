# Changelog

## [1.1.0](https://github.com/BeOnAuto/auto-brain/compare/v1.0.1...v1.1.0) (2026-10-10)


### Features

* **api:** a browser opening the server finds a page that opens the console ([#92](https://github.com/BeOnAuto/auto-brain/issues/92)) ([7dc46cb](https://github.com/BeOnAuto/auto-brain/commit/7dc46cb5b2e2adb3c0389a6f7f199e23c64f74fb))
* **api:** authenticate callers and serve the brain operations over HTTP ([#66](https://github.com/BeOnAuto/auto-brain/issues/66)) ([4d744b0](https://github.com/BeOnAuto/auto-brain/commit/4d744b0ae91a18786ad71f2f14d61f02c21a4cfd))
* **api:** instructions, tool descriptions, guides and prompts for agents over MCP ([#126](https://github.com/BeOnAuto/auto-brain/issues/126)) ([f4a7d7f](https://github.com/BeOnAuto/auto-brain/commit/f4a7d7f64360e325e33245c13e6722804e23e402))
* **api:** lead MCP tool results and errors with plain words ([#83](https://github.com/BeOnAuto/auto-brain/issues/83)) ([1021942](https://github.com/BeOnAuto/auto-brain/commit/1021942da9c150bca93c39bdb8a03b67859f9731))
* **api:** serve every operation on one MCP endpoint ([#74](https://github.com/BeOnAuto/auto-brain/issues/74)) ([7b1d79f](https://github.com/BeOnAuto/auto-brain/commit/7b1d79ff7cd7f766128194bc60caa28e364e97ab))
* **api:** serve operations as MCP tools ([#69](https://github.com/BeOnAuto/auto-brain/issues/69)) ([266df06](https://github.com/BeOnAuto/auto-brain/commit/266df06b1f47b54d34837d0f6605aff3e47dafe1))
* **brains:** add the brain operations and the ledger that stores them ([#64](https://github.com/BeOnAuto/auto-brain/issues/64)) ([3d0cfe5](https://github.com/BeOnAuto/auto-brain/commit/3d0cfe5d791f512e20361c87ba3377a313c1ae79))
* **computation:** a brain computes with a program, exactly and the same way every time ([#106](https://github.com/BeOnAuto/auto-brain/issues/106)) ([99b59df](https://github.com/BeOnAuto/auto-brain/commit/99b59df03544a5031a912f25e0241403031215d4))
* **global:** add README quickstart and Studio invite links ([#95](https://github.com/BeOnAuto/auto-brain/issues/95)) ([68b0f3b](https://github.com/BeOnAuto/auto-brain/commit/68b0f3b75c74095c13d4ee0af1568415b47d2278))
* **inference:** call what a brain does by its functions ([#84](https://github.com/BeOnAuto/auto-brain/issues/84)) ([7eaf4dc](https://github.com/BeOnAuto/auto-brain/commit/7eaf4dcdac2cbff81b488ee4adbab54ca1f00309))
* **inference:** execute prompts as specs ([#71](https://github.com/BeOnAuto/auto-brain/issues/71)) ([fda92e7](https://github.com/BeOnAuto/auto-brain/commit/fda92e76104f2c5b9ec15328ea98a7a8b921c1ee))
* **inference:** list the models a server can call ([#87](https://github.com/BeOnAuto/auto-brain/issues/87)) ([90f3cde](https://github.com/BeOnAuto/auto-brain/commit/90f3cdee395765168d0cf72e8a6c600218368c64))
* **inference:** tell callers which model providers a server has ([#79](https://github.com/BeOnAuto/auto-brain/issues/79)) ([4d522f6](https://github.com/BeOnAuto/auto-brain/commit/4d522f667a999d3aef15203ecfddc16c3a2dfb79))
* **interaction:** a brain asks a person or a system and takes the answer later ([#123](https://github.com/BeOnAuto/auto-brain/issues/123)) ([b4512c0](https://github.com/BeOnAuto/auto-brain/commit/b4512c0d7f9a2946cae06fe11a7d08de26187faa))
* **interaction:** an interaction function calls a tool and answers with its result ([#139](https://github.com/BeOnAuto/auto-brain/issues/139)) ([d6998f1](https://github.com/BeOnAuto/auto-brain/commit/d6998f19d796cd083ff976c824d8d445ea0d0988))
* **interaction:** an interaction function names the tool it sends through and reads its replies ([#135](https://github.com/BeOnAuto/auto-brain/issues/135)) ([af87111](https://github.com/BeOnAuto/auto-brain/commit/af87111ccb256b914790d9791e4e2630c62c3d15))
* **interaction:** an open request lists the shape its answer takes ([#129](https://github.com/BeOnAuto/auto-brain/issues/129)) ([04201ab](https://github.com/BeOnAuto/auto-brain/commit/04201ab02815b97737703ad29926cdbfbc62541c))
* **ledger:** keep the ledger in PostgreSQL ([#86](https://github.com/BeOnAuto/auto-brain/issues/86)) ([cbf6c4a](https://github.com/BeOnAuto/auto-brain/commit/cbf6c4a7d1a5dad143a3936838252ea25c31b483))
* **ledger:** open the ledger on any Emmett SQLite driver, without sqlite3 ([#82](https://github.com/BeOnAuto/auto-brain/issues/82)) ([a4c766a](https://github.com/BeOnAuto/auto-brain/commit/a4c766aa783f5c17d802c13004a8cbd0005b8351))
* **ledger:** read what a brain recorded, bound to the brain ([#89](https://github.com/BeOnAuto/auto-brain/issues/89)) ([618517a](https://github.com/BeOnAuto/auto-brain/commit/618517a357a0a9405bfd909bfbf33bee69967b13))
* **mcp:** a server's tools are allowed and marked testable on its own entry ([#134](https://github.com/BeOnAuto/auto-brain/issues/134)) ([9203df9](https://github.com/BeOnAuto/auto-brain/commit/9203df9da2a9102b7608bf1794b4dc4725de262e))
* **mcp:** an agent tests a tool call through the brain before writing a function ([#131](https://github.com/BeOnAuto/auto-brain/issues/131)) ([498219d](https://github.com/BeOnAuto/auto-brain/commit/498219da0e465e58b65d090d22e3041bffe204be))
* **mcp:** list the tool servers a brain may use, with the tools each offers ([#119](https://github.com/BeOnAuto/auto-brain/issues/119)) ([d71c0cd](https://github.com/BeOnAuto/auto-brain/commit/d71c0cd0c3e747922c6b409f1f9aad63f183251a))
* **mcp:** reason functions use tools from the MCP servers the operator configures ([#98](https://github.com/BeOnAuto/auto-brain/issues/98)) ([f86bd00](https://github.com/BeOnAuto/auto-brain/commit/f86bd0036b203b52da60fc1288cf022c4560c077))
* **operations:** add the application layer ([#61](https://github.com/BeOnAuto/auto-brain/issues/61)) ([c8c4a4a](https://github.com/BeOnAuto/auto-brain/commit/c8c4a4a98eec849a341114e3483470bcdc28e102))
* **orchestration:** a workflow starts on a schedule and on events, with up to three triggers ([#130](https://github.com/BeOnAuto/auto-brain/issues/130)) ([a06e969](https://github.com/BeOnAuto/auto-brain/commit/a06e9692de35ac0277e658866fa61ef50f8d4e6c))
* **orchestration:** a workflow waits for runs that finish later, with deadlines and cancel ([#115](https://github.com/BeOnAuto/auto-brain/issues/115)) ([48d90dd](https://github.com/BeOnAuto/auto-brain/commit/48d90ddc6f6bf26a7afdf28c0f03cb557977f1d3))
* **orchestration:** run workflow specs on Temporal ([#70](https://github.com/BeOnAuto/auto-brain/issues/70)) ([b0faa0f](https://github.com/BeOnAuto/auto-brain/commit/b0faa0fceac43e3cfc3ed206ecab4761369132db))
* **recollection:** a brain keeps views of its own history and answers from them ([#112](https://github.com/BeOnAuto/auto-brain/issues/112)) ([bd334af](https://github.com/BeOnAuto/auto-brain/commit/bd334af99c85e3cc025b8d7af80e2b055d763bcb))
* **server:** read structured settings from a YAML configuration file ([#80](https://github.com/BeOnAuto/auto-brain/issues/80)) ([1460def](https://github.com/BeOnAuto/auto-brain/commit/1460defec12e0910731d73d67136ff7973dfc7df))
* **server:** readable start-up and a quick start for AI assistants ([#77](https://github.com/BeOnAuto/auto-brain/issues/77)) ([a9fcb65](https://github.com/BeOnAuto/auto-brain/commit/a9fcb65bedb70185f7660d5b38f8f8d169b00ad9))
* **server:** run a local Temporal with pnpm dev ([#75](https://github.com/BeOnAuto/auto-brain/issues/75)) ([be0b02a](https://github.com/BeOnAuto/auto-brain/commit/be0b02af2393a1cb34f361482e3a0dd9dbe7947d))
* **server:** serve workflows ([#72](https://github.com/BeOnAuto/auto-brain/issues/72)) ([aecb3f9](https://github.com/BeOnAuto/auto-brain/commit/aecb3f94109d7ced3b04f3986a469a9ce2ff132e))
* **specs:** add the spec operations ([#67](https://github.com/BeOnAuto/auto-brain/issues/67)) ([7651e40](https://github.com/BeOnAuto/auto-brain/commit/7651e40498ce65993d2e8478b25ae586b1571283))
* **specs:** answer a brain's analytics from a table of run outcomes kept in the ledger ([#105](https://github.com/BeOnAuto/auto-brain/issues/105)) ([f71f442](https://github.com/BeOnAuto/auto-brain/commit/f71f442e182c954f6d16d656cfdd7d378d61e5fe))
* **specs:** every event names itself, its cause and its run, and a workflow's steps are events ([#107](https://github.com/BeOnAuto/auto-brain/issues/107)) ([adf527b](https://github.com/BeOnAuto/auto-brain/commit/adf527bcb334c854cec7f8bbc08d0959c3394f71))
* **specs:** list a brain's runs, read a run's history and follow a brain's events ([#93](https://github.com/BeOnAuto/auto-brain/issues/93)) ([2019e5b](https://github.com/BeOnAuto/auto-brain/commit/2019e5b65bd5f421204add5a0b89aac1fc6788f2))
* **specs:** publish events into a brain and present its own facts as events ([#104](https://github.com/BeOnAuto/auto-brain/issues/104)) ([77e8f8f](https://github.com/BeOnAuto/auto-brain/commit/77e8f8f61a868585d252b77b622bebf7688c6540))
* **workflow-engine:** the brain's one language is TypeScript, run in a QuickJS sandbox ([#141](https://github.com/BeOnAuto/auto-brain/issues/141)) ([5791aff](https://github.com/BeOnAuto/auto-brain/commit/5791aff2ac668b3670e49ed9c0e5328953fc789c))
* **workflow-engine:** the contract of a workflow engine on the ledger ([#85](https://github.com/BeOnAuto/auto-brain/issues/85)) ([a862223](https://github.com/BeOnAuto/auto-brain/commit/a862223708362f6de9382105e54d9b4f179a8d94))
* **workflow-engine:** the workflow machine, its engine and an in-memory driver ([#88](https://github.com/BeOnAuto/auto-brain/issues/88)) ([61d3ade](https://github.com/BeOnAuto/auto-brain/commit/61d3ade0cb13317e5c5052f10cc7f2071621ba15))
* **workflow-host:** run every workflow in the server, on the workflow engine, without Temporal ([#96](https://github.com/BeOnAuto/auto-brain/issues/96)) ([13f4a7e](https://github.com/BeOnAuto/auto-brain/commit/13f4a7ea875f3c35547e440bb52c679dd492af3b))
* **workflow-host:** workflows react to what their brain records, on events and on a schedule ([#113](https://github.com/BeOnAuto/auto-brain/issues/113)) ([41baa13](https://github.com/BeOnAuto/auto-brain/commit/41baa13f3104b4296e434cb48bcfad6211b66d64))


### Bug Fixes

* **api:** judge the arguments of an MCP tool call as HTTP does ([#76](https://github.com/BeOnAuto/auto-brain/issues/76)) ([b07642d](https://github.com/BeOnAuto/auto-brain/commit/b07642dbe6c3434bf65869180d116cf166a566d9))
* **api:** the served tools advertise no output schema ([#136](https://github.com/BeOnAuto/auto-brain/issues/136)) ([b140126](https://github.com/BeOnAuto/auto-brain/commit/b1401264c1720beb565ddecf9fb9aeb7dcd77769))
* **api:** the server's page opens the studio on this server again ([#128](https://github.com/BeOnAuto/auto-brain/issues/128)) ([fad12d6](https://github.com/BeOnAuto/auto-brain/commit/fad12d6a0451c45b3ea5315d9769e4b794748aae))
* **api:** the server's page opens the studio, whose origin is the one always allowed ([#94](https://github.com/BeOnAuto/auto-brain/issues/94)) ([5765599](https://github.com/BeOnAuto/auto-brain/commit/576559945d6724fbbe2c6b75dcd8f7651f180832))
* **global:** settle three tests, show a rejected run's record, and instruct connecting agents ([#118](https://github.com/BeOnAuto/auto-brain/issues/118)) ([4f99a5e](https://github.com/BeOnAuto/auto-brain/commit/4f99a5ef4d45101a1165e21437b2a4a140a7af03))
* **global:** settle two flaky tests and bound what tool servers log ([#103](https://github.com/BeOnAuto/auto-brain/issues/103)) ([55f1360](https://github.com/BeOnAuto/auto-brain/commit/55f136084917994963fecfab91653ff9aa12d33a))
* **interaction:** answers survive a restart, timers run while receivers hang ([#125](https://github.com/BeOnAuto/auto-brain/issues/125)) ([c4d01f9](https://github.com/BeOnAuto/auto-brain/commit/c4d01f900c9e25f4d237f5e8284aa42dd250c002))
* **ledger:** the run list fills every page when filtered by primitive or name ([#127](https://github.com/BeOnAuto/auto-brain/issues/127)) ([6c9fd7e](https://github.com/BeOnAuto/auto-brain/commit/6c9fd7e83e3667c1393b2dcd27625248b9d80e10))
* **mcp:** list only reachable tool servers, refuse an unknown server, and decode MCP inputs once ([#120](https://github.com/BeOnAuto/auto-brain/issues/120)) ([73cb2ab](https://github.com/BeOnAuto/auto-brain/commit/73cb2ab9b8d061a95a7ea0e33a06af325c70b579))
* **mcp:** the tool-server listing answers for the org when no brain is named ([#132](https://github.com/BeOnAuto/auto-brain/issues/132)) ([50fb66a](https://github.com/BeOnAuto/auto-brain/commit/50fb66af4d12df84c036d21d25d4a63ee91aa821))
* **operations:** a key limited to some brains is told to name one ([#133](https://github.com/BeOnAuto/auto-brain/issues/133)) ([c437767](https://github.com/BeOnAuto/auto-brain/commit/c43776767d23051e3d823d985f3f8f502dae0666))
* **operations:** make UUIDv7 ids portable to Cloudflare Workers ([#81](https://github.com/BeOnAuto/auto-brain/issues/81)) ([c5a48c4](https://github.com/BeOnAuto/auto-brain/commit/c5a48c4c6b71e12083103bca50793058e727634c))
* **server:** computation and recall run under the development runner again ([#121](https://github.com/BeOnAuto/auto-brain/issues/121)) ([40e4f82](https://github.com/BeOnAuto/auto-brain/commit/40e4f8215ca1116c50c436adb7db98fc9a3d432a))
* **specs:** bound nested event data and close the gaps a published event could use ([#108](https://github.com/BeOnAuto/auto-brain/issues/108)) ([5584e7f](https://github.com/BeOnAuto/auto-brain/commit/5584e7fa083dc6811349d3cd370d9c6b9b5a4d08))
* **specs:** keep the deferral out of the history, and cap how deep an expression's value may nest ([#110](https://github.com/BeOnAuto/auto-brain/issues/110)) ([14c9774](https://github.com/BeOnAuto/auto-brain/commit/14c9774755e4391dd1736f1dad84e929fc2ecc92))
* **workflow-engine:** bound regular expressions and object keys, and give expressions a deadline ([#99](https://github.com/BeOnAuto/auto-brain/issues/99)) ([749bda9](https://github.com/BeOnAuto/auto-brain/commit/749bda98b2f474c22593277ffafac66ef6764349))
* **workflow-engine:** workers inherit no flag from the server ([#122](https://github.com/BeOnAuto/auto-brain/issues/122)) ([4441b3e](https://github.com/BeOnAuto/auto-brain/commit/4441b3e2a6440877250a378f06c63d2eb6fd021f))
* **workflow-host:** a lone recall function is never shown waiting behind others ([#137](https://github.com/BeOnAuto/auto-brain/issues/137)) ([3df2373](https://github.com/BeOnAuto/auto-brain/commit/3df2373e6ed4fb254bcdbc33ae407dddd72136f2))


### Performance Improvements

* **ledger:** size each fill listing by what the batch before showed fits in 16 MiB ([#111](https://github.com/BeOnAuto/auto-brain/issues/111)) ([673b4ab](https://github.com/BeOnAuto/auto-brain/commit/673b4ab832e4f6b343055321acb98be7246285b4))
* **workflow-engine:** keep workers warm between jobs, so a run costs only its own work ([#117](https://github.com/BeOnAuto/auto-brain/issues/117)) ([3a47712](https://github.com/BeOnAuto/auto-brain/commit/3a477124f2908cc12efc434c4921662ccf37c2b5))

## [1.0.1](https://github.com/BeOnAuto/auto-brain/compare/v1.0.0...v1.0.1) (2026-09-30)


### Bug Fixes

* **global:** remove the duplicate recollation folder and third-party references ([#57](https://github.com/BeOnAuto/auto-brain/issues/57)) ([28f3184](https://github.com/BeOnAuto/auto-brain/commit/28f3184c8c8247c9ec6ae44471de9de163e35e76))

## 1.0.0 (2026-09-30)


### Features

* **global:** rebuild auto-brain as a Node 26 TypeScript monorepo ([#46](https://github.com/BeOnAuto/auto-brain/issues/46)) ([405d04b](https://github.com/BeOnAuto/auto-brain/commit/405d04bd1b7b7e824c06369041273f10d28fddcf))
