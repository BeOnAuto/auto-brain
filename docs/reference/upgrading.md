# Upgrade to playbooks

This checkout introduces the playbook API. Released `auto-brain:1.0.1` images and older Studio clients use the earlier brain API. Treat this as a coordinated breaking release; do not deploy the updated Studio or publish these docs against an older runtime.

## Public names

| Previous contract                                                          | Current contract                                                                          |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `/v1/orgs/{org}/brains/{brain}`                                            | `/v1/orgs/{org}/playbooks/{playbook}`                                                     |
| `/orgs/{org}/brains/{brain}/mcp`                                           | `/orgs/{org}/playbooks/{playbook}/mcp`                                                    |
| `create_brain`, `list_brains`, `get_brain`, `update_brain`, `retire_brain` | `create_playbook`, `list_playbooks`, `get_playbook`, `update_playbook`, `retire_playbook` |
| `list_brain_events`, `get_brain_analytics`                                 | `list_playbook_events`, `get_playbook_analytics`                                          |
| Request scope `brain`; collection `brains`                                 | Request scope `playbook`; collection `playbooks`                                          |
| `brain:read`, `brain:write`                                                | `playbook:read`, `playbook:write`                                                         |
| API key and MCP server restrictions `brains`                               | Restrictions `playbooks`                                                                  |

Update `RECALL_BRAINS_AT_ONCE` to `RECALL_PLAYBOOKS_AT_ONCE`, preserving its value, if you set this throughput limit.

The `/mcp` and org MCP endpoints remain available. Rediscover their tool lists after upgrading. Functions, workflows and run identifiers keep their identity. A playbook automatically contains its brain of reusable functions; there is no separate brain creation operation.

## Preserve access and history

Before upgrading, stop the runtime and back up its ledger and workflow database using the normal procedure for your deployment. Preserve configuration and credentials separately. Rehearse the upgrade on a private copy, including a waiting workflow and an outstanding interaction request.

Update every API key permission and restricted playbook list together, in `API_KEYS` or `api_keys`. Retain the same key id, SHA-256 digest, org and explicit resource list; a naming change does not require issuing a broader key. Update `MCP_SERVERS` or `mcp_servers` restrictions from `brains` to `playbooks`, retaining the exact allowed ids and tools. Unknown fields and obsolete permissions are rejected; they must never be discarded to make the runtime start.

Do not rename stored `brain/` streams, the org's `brains` registry stream, `brain_created` / `brain_updated` / `brain_retired` events, their `brain` data field, SQL `brain_key` columns, workflow tables or recorded `brain:<id>` actors. These are durable identities. The runtime maps them to playbooks in its domain. Workflow attributes retain their stored format, including restricted caller permissions, and are decoded at the persistence boundary. Existing run ids, correlations, approvals and workflow replay history stay attached to the same work.

Update HTTP clients, agent connection URLs and tool calls, then reconnect Studio. Existing Studio bookmarks with `?brain=` remain readable; newly written links use `?playbook=`. Website redirects preserve the old concepts and first-tutorial URLs. Old HTTP operations and configuration keys are not permanent aliases.

Verify allowed and denied operations using a restricted key, then inspect old runs and resume a controlled pending approval. Confirm that the original workflow resumes rather than creating an unrelated run. Resume normal traffic only after these checks.

## Distribution and rollback

The repository, package coordinates, executable paths, config filename `auto-brain.yaml` and image coordinate `beonauto/auto-brain` are unchanged. Publish the breaking runtime release first, update downstream image pins and clients, then pin the website docs import to that released source revision. A dirty local docs snapshot is preview-only and must not be published.

Rollback requires restoring the matching client and configuration names as well as the runtime version. Keep the backed-up configuration and data until verification completes; do not rewrite event history as part of a language migration.
