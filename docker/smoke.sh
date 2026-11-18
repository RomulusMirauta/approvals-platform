#!/usr/bin/env bash
# Smoke test for the Docker Compose stack, through the web service's single origin (nginx -> api):
# the API is ready, a requester files two requests, the approver approves one and rejects the other, and the
# notification worker turns both decisions into notifications for the requester (API -> outbox -> worker).
# Needs curl and jq. Usage: docker compose up -d --wait && docker/smoke.sh [base url]
set -euo pipefail

BASE_URL="${1:-${BASE_URL:-http://localhost:8080}}"
PASSWORD='demo-password' # the seeded demo accounts' public password (apps/api/src/db/seed.ts)

fail() { echo "FAIL: $*" >&2; exit 1; }

# api METHOD PATH [TOKEN] [JSON BODY]: prints the response body, fails on a non-2xx status.
api() {
  local method=$1 path=$2 token=${3:-} body=${4:-}
  local args=(-sS -X "$method" -H 'Accept: application/json' -w '\n%{http_code}')
  [[ -n $token ]] && args+=(-H "Authorization: Bearer $token")
  [[ -n $body ]] && args+=(-H 'Content-Type: application/json' --data "$body")
  local response status
  response=$(curl "${args[@]}" "$BASE_URL$path")
  status=${response##*$'\n'}
  response=${response%$'\n'*}
  [[ $status == 2* ]] || fail "$method $path answered $status: $response"
  printf '%s' "$response"
}

login() {
  api POST /v1/auth/login '' "$(jq -nc --arg email "$1" --arg password "$PASSWORD" '{email: $email, password: $password}')" | jq -er .token
}

echo "Readiness"
[[ $(api GET /ready | jq -r .status) == ready ]] || fail '/ready is not ready'
curl -sSf "$BASE_URL/" | grep -q '<div id="root">' || fail 'the dashboard did not serve index.html'

echo "Sign in as the requester (alice) and the approver (bob)"
alice=$(login alice@example.com)
bob=$(login bob@example.com)

run=$(date +%s)
create() {
  api POST /v1/requests "$alice" "$(jq -nc --arg title "$1 ($run)" '{title: $title, type: "purchase", amount: {amountMinor: 12345, currency: "EUR"}}')" | jq -er .request.id
}

echo "Create two requests"
approved_id=$(create 'Docker smoke: approve me')
rejected_id=$(create 'Docker smoke: reject me')

echo "Approve one and reject the other"
[[ $(api POST "/v1/requests/$approved_id/decision" "$bob" '{"decision":"approved"}' | jq -r .status) == approved ]] || fail 'approval not recorded'
[[ $(api POST "/v1/requests/$rejected_id/decision" "$bob" '{"decision":"rejected","comment":"Not in this quarter'"'"'s budget."}' | jq -r .status) == rejected ]] ||
  fail 'rejection not recorded'

echo "Wait for the worker to deliver both decisions to the requester"
for _ in $(seq 1 30); do
  notifications=$(api GET /v1/notifications "$alice")
  found=$(jq --arg a "$approved_id" --arg r "$rejected_id" \
    '[.items[] | select((.requestId == $a and .event == "request.approved") or (.requestId == $r and .event == "request.rejected"))] | length' \
    <<<"$notifications")
  if [[ $found == 2 ]]; then
    echo "OK: the worker processed the outbox; alice has both notifications"
    exit 0
  fi
  sleep 1
done
fail "the worker did not deliver the notifications within 30 s; alice has: $notifications"
