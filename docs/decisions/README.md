# Engineering decisions

Keep architecture decision records in this directory alongside the code they explain. A record can discuss implementation alternatives, measurements and planned work that does not yet describe released behavior.

These records are contributor documentation. They are excluded from the public VitePress preview, its search and navigation, and the Auto website's documentation import. Do not add them to `docs/nav.json`.

Use a numbered Markdown filename for each decision and link to it from the affected package README. Follow [CONTRIBUTING.md](../../CONTRIBUTING.md) when proposing changes. When a decision changes user-visible behavior, update the appropriate public guide separately and state which behavior is available.

## Records

| Record                                                                                                                                         | Status                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| [1. Run workflows on an engine on the ledger, not on Temporal](0001-workflow-engine-on-the-ledger.md)                                          | accepted 2026-10-04, amended 2026-10-05 |
| [2. Reading the runs of a brain and what happened in it](0002-reading-runs-and-brain-events.md)                                                | accepted 2026-10-05, amended 2026-10-05 |
| [3. MCP servers: a brain reaches the outside world through configured MCP servers](0003-mcp-servers.md)                                        | accepted 2026-10-05                     |
| [5. Computation functions: a brain computes with a program, deterministically and without the outside world](0005-computation-functions.md)    | proposed 2026-10-05, built 2026-10-06   |
| [10. Interaction functions: a brain asks a person or a system and waits for the answer](0010-interaction-functions.md)                         | accepted 2026-10-07                     |
| [11. Waiting calls: a workflow waits for a run that finishes later, and a run can be cancelled](0011-waiting-calls.md)                         | accepted 2026-10-07                     |
| [14. A warm worker pool: a run costs its own work, in a worker kept between jobs and let go of after any bad one](0014-warm-worker-pool.md)    | proposed 2026-10-06, built 2026-10-07   |
| [15. Several triggers: a workflow starts on an event and on its schedules, each trigger kept and matched on its own](0015-several-triggers.md) | accepted 2026-10-08                     |
| [16. Speaking to agents: what the brain says when an agent connects](0016-speaking-to-agents.md)                                               | accepted 2026-10-07                     |
