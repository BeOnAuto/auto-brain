#!/usr/bin/env bash
set -euo pipefail

usage='Usage: scripts/try-reasoning.sh <base-url> <provider/model>'
base_url="${1:?$usage}"
model="${2:?$usage}"
org="${AUTO_BRAIN_ORG:-local}"
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

brains="$base_url/v1/orgs/$org/brains"
call --data "{\"brain\": \"$brain\", \"name\": \"Trying reasoning functions\"}" "$brains" > /dev/null
source="$(printf '%s\n' '---' "model: $model" 'config: {max_output_tokens: 200}' '---' \
  '{% system %}Answer in one sentence.{% endsystem %}Greet {{ input.name }} and name today, {{ today }}.')"
call --data "$(jq --null-input --arg source "$source" '{name: "greeting", source: $source}')" \
  "$brains/$brain/definitions/reasoning" > /dev/null
run="$(call --data '{"input": {"name": "Ada"}}' "$brains/$brain/definitions/reasoning/greeting/run")"
call "$brains/$brain/runs/$(jq --raw-output .run_id <<< "$run")" | jq .
