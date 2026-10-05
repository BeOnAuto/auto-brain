# Use Auto with Apollo

Use this guide to pass graph data into an existing Auto reason function. Your external agent connects to Auto and Apollo separately, retrieves authorized evidence, and supplies it as input to the function.

## Before you start

You need an agent connected to Auto, a saved reason function, and permission to read the relevant data through your graph. If you have not created a function yet, follow [Build your first brain](../tutorials/first-brain.md).

Decide which data the review needs and confirm that it may be sent to Auto and the function's model provider. Function inputs and results become part of the recorded run.

## 1. Connect the business graph

[Apollo MCP Server](https://www.apollographql.com/docs/apollo-mcp-server) exposes GraphQL operations as tools an agent can call. Follow its setup guide and add that connection to the same agent that uses Auto. Limit it to the operations required for this task.

[GraphOS MCP Server](https://www.apollographql.com/docs/graphos/platform/graphos-mcp-server/install) provides GraphOS management and documentation tools. It is a different service and does not automatically give an agent access to business data. Choose the connection that exposes the operations your review needs.

Keep credentials in connection settings, outside function prompts and inputs. The graph and Auto authorize access separately.

## 2. Check the function's inputs

Ask the agent to read the saved reason function and show its required inputs. Then identify an approved graph query that supplies the relevant evidence.

For a budget-review function, this might be the campaign's spend to date and agreed budget. The actual query and field names depend on your graph. Have the agent inspect the available tools and schema rather than invent a query from this example.

## 3. Retrieve and inspect the evidence

Ask the agent to run the approved read-only query and show the figures it retrieved. Check the campaign, reporting period and units. Resolve missing or inconsistent data before running the review.

Do not grant write access to complete a read-only trial.

## 4. Run the saved function

Ask the agent to map the evidence into the function's declared inputs and show that mapping before calling Auto. For example:

> Use the approved campaign-spend query for this review. Show me the reporting period, figures and any missing evidence. Map those values to our budget-review function's inputs. After I confirm the mapping, run the saved function and show its recorded result. Do not change campaign budgets.

The function receives the supplied values. It does not automatically inherit the graph connection, query history or the agent's other context.

## 5. Verify the recorded run

Have the agent read the resulting run from Auto and show its execution id, definition version, recorded prompt and output. Confirm that the prompt contains the evidence you approved and that the result addresses the intended review. The current run API returns the rendered prompt, subject to record-size limits, rather than the original input object.

If a required input is missing, compare the function's input contract with the mapping. If the graph operation is unavailable, check the selected Apollo server and the connection's permissions before changing the function.

## Tool access from inside the brain

A self-hosted runtime can give reason functions the tools of an MCP server its operator configures, and Apollo GraphOS Agent Services can be that server. The operator adds it as a remote server whose `Authorization` header carries an application API key, bound to your org and brain. A reason function that lists `graph/*` in its `tools` can then search for operations and run those the application's policies allow, and each call appears in the run's history. A field the policy denies comes back to the model as a tool error, which it can explain in its answer. Auto does not require Apollo.

That internal connection is separate from the two external-agent connections used in this guide, and Auto Cloud does not offer it yet. See [Tool access inside a reason function](../concepts/functions.md#tool-access-inside-a-reason-function).
