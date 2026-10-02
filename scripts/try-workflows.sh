#!/usr/bin/env bash
set -euo pipefail

usage='Usage: scripts/try-workflows.sh <base-url> <provider/model>'
base_url="${1:?$usage}"
model="${2:?$usage}"
org="${AUTO_BRAIN_ORG:-demo}"
brain="try-$(date +%s)"
headers=(--header 'content-type: application/json')
if [ -n "${AUTO_BRAIN_KEY:-}" ]; then
  headers+=(--header "authorization: Bearer $AUTO_BRAIN_KEY")
fi

call() {
  local response
  if ! response="$(curl --silent --show-error --fail-with-body "${headers[@]}" "$@")"; then
    printf '%s\n' "$response" >&2
    return 1
  fi
  printf '%s\n' "$response"
}

settled() {
  local execution
  for _ in $(seq 1 60); do
    execution="$(call "$brains/$brain/executions/$1")"
    if [ "$(jq --raw-output .status <<< "$execution")" != started ]; then
      printf '%s\n' "$execution"
      return 0
    fi
    sleep 1
  done
  printf 'The execution %s was still started after a minute\n' "$1" >&2
  return 1
}

brains="$base_url/v1/orgs/$org/brains"
call --data "{\"brain\": \"$brain\", \"name\": \"Trying workflows\"}" "$brains" > /dev/null
greeting="$(printf '%s\n' '---' "model: $model" 'config: {max_output_tokens: 200}' '---' \
  '{% system %}Answer in one sentence.{% endsystem %}Greet {{ input.name }} and name today, {{ today }}.')"
call --data "$(jq --null-input --arg source "$greeting" '{name: "greeting", source: $source}')" \
  "$brains/$brain/specs/inference" > /dev/null
welcome="$(cat << 'YAML'
document:
  dsl: '1.0.3'
  namespace: demo
  name: welcome
  version: '1.0.0'
  summary: Greets a customer, then waits for their reply.
do:
  - greet:
      call: execute_spec
      with:
        primitive: inference
        name: greeting
        input:
          name: ${ .name }
      output:
        as: '${ { greeting: . } }'
  - await:
      listen:
        to:
          one:
            with: { type: com.example.customer.replied }
      output:
        as: '${ $input + { reply: .[0] } }'
YAML
)"
call --data "$(jq --null-input --arg source "$welcome" '{name: "welcome", source: $source}')" \
  "$brains/$brain/specs/orchestration" > /dev/null
started="$(call --data '{"input": {"name": "Ada"}}' "$brains/$brain/specs/orchestration/welcome/execute")"
execution_id="$(jq --raw-output .execution_id <<< "$started")"
call --data '{"event": {"type": "com.example.customer.replied", "data": "Thank you!"}}' \
  "$brains/$brain/executions/$execution_id/events" > /dev/null
settled "$execution_id" | jq .
