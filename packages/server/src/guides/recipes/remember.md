# Make the brain remember something

A recall function answers from what it keeps of the brain's own history, its view: every run's start and end, with its result when it succeeded, the definitions saved and every event published to the brain. A view holds what a run answered, never what it was given or the tools it called. Read the recall-function guide with get_guide before you write one.

1. Ask the person what the brain should remember, and which function's runs hold it, such as what one function posted today. Find that function with list_definitions.
2. Tell the person that a view holds what a run answered, never what it was given or the tools it called, so a function whose job is to post must answer what it posted. When the function does not answer it, offer to change the function so that it does, and show the change before you save it with update_definition.
3. When no function holds it yet, write that function first and save it with create_definition once the person agrees.
4. Write a recall function whose view folds that function's succeeded runs, with a filter of the type `run_succeeded` and the subject `<type>/<name>` of the function, and whose `answer` gives what the person asked for. The second example of the recall-function guide keeps what one function answered.
5. Show the person the document, and save it with create_definition, `type` recall, once they agree.
6. Run it with run_definition once it answers. While its view is still being built, the run says so: try again in a moment, since a new version builds its view from the brain's whole history.
7. Tell the person that the brain now remembers from its whole history on, every run of that function whoever started it, and that it sees nothing done outside the brain.
