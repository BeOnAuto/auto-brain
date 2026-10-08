# Give the brain tools

A reasoning function can call the tools of the tool servers that whoever runs this server set up for the brain, naming each tool as `server/tool`, or `server/*` for every tool of a server. Read the reasoning-function guide with get_guide before you write one.

1. Call list_tool_servers to see the tool servers this brain may use and the tools each offers; when the person named a server, give its name as `server`.
2. When no server is listed, tell the person that whoever runs this server sets tool servers up in its settings file, `auto-brain.yaml`, under `mcp_servers`: the server's address, a header that takes its key from an environment variable, and the org it serves, with `allowed_tools` naming the tools a function may call. The server reads them when it starts again. Nothing more can be done here until then.
3. When a server says it cannot be asked just now, tell the person why, in its words; whoever runs the server can look into it.
4. To learn what a tool answers, test it with test_tool_call, with the arguments its input_schema takes, and read the answer: that is what the function's model will see. Never make a function to look. When a prompt needs an id, such as a channel's, test the tool that lists them and take the id from its answer, confirming the choice with the person. A tool that cannot be tested may change something; list_tool_servers says which can.
5. Ask the person what the function should do with the tools, and which of them it needs.
6. Write a reasoning function whose `tools` name those tools in the format of the reasoning-function guide, show it to the person, and save it with create_spec, `primitive` inference, once they agree.
7. Run it with execute_spec. A run that called tools and did not succeed is not run again under its id, since a tool may have changed something: read what it called with get_execution_history, and start a new run only if the person still wants one.
8. Tell the person what the run did with the tools, and that the function can call only the tools it names.
