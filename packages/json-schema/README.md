# @on.auto/json-schema

The runtime's one JSON Schema compiler: the input, output and view schemas a person writes in a definition, the answer schema of a reasoning function, the input schemas of the tools of a tool server, and the values checked against any of them. It sits below every package that reads a schema, so [`@on.auto/definitions`](../definitions/README.md) and the capabilities import it and it imports nothing of theirs: only `effect`, whose JSON Schema importer it compiles with.

## Compiling a schema

`compileJsonSchema(document, { what, nesting })` checks a JSON Schema's shape, size, references and loops, and compiles a validator that answers issues with JSON pointers; `what` names the schema in its issues and `nesting` bounds the values it validates. `jsonSchemaLimits` are its bounds, a schema of at most 65,536 bytes as JSON nested at most 64 levels with at most 20 issues named, `boundedJsonSchema` its first check alone, of the size and nesting of a schema, which reasoning also runs on the input schema of a tool, and `shapeIssues`, `isKnownKeyword` and the helpers of `json-bounds.ts`, `pointerOf`, `utf8Bytes`, `nestedDeeperThan`, `boundedIssues`, `hiddenIssues` and `mostIssues`, the checks it is built from (`src/document`).

The dialect is JSON Schema 2020-12, or draft-07 when the schema says so or keeps `definitions` without `$defs`, bounded on purpose for documents a person writes: a reference is local, `#/$defs/<name>` or `#/definitions/<name>`, and `pattern`, `patternProperties`, `if`, `then`, `else`, `contains`, the dependent keywords, `unevaluatedItems`, `unevaluatedProperties`, `additionalItems` and the dynamic and recursive anchors are refused with words that say why (`src/document/schema-shape.ts`); a definition that leads into a loop of `$ref`, `allOf`, `anyOf` or `oneOf` with no property or item in between is refused at its pointer (`src/document/reference-loops.ts`).

## Checking a value

`schemaCheckOf(schema, { what, nesting })` is a check of a value that names at most three of its issues, and `issuesDetail(issues, what)` the one wording of them, each at its pointer or as the output or the view itself at the root (`src/checking`). The checked worker of `@on.auto/definitions` checks the outputs and views of computation and recall functions with them, and the interaction capability words a refused answer with `issuesDetail`.

## Source

`src/document` holds the compiler and its bounds, and `src/checking` the check of a value. The tests beside them pin the dialect and the hostile schemas it refuses.
