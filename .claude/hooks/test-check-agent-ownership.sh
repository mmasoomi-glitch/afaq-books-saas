#!/usr/bin/env bash
# .claude/hooks/test-check-agent-ownership.sh
#
# Integration tests for check-agent-ownership.sh
# At least 20 cases through the hook. Prints PASS/FAIL per case.
# Exits non-zero if any case fails.
#
# Dependencies: jq (optional — uses grep fallback if absent), bash 4+

set -u

HOOK=".claude/hooks/check-agent-ownership.sh"
PASS=0
FAIL=0
TOTAL=0

# Helper: run a case
# Args: $1=test_name $2=AFAQ_AGENT $3=json_payload $4=expected_exit
run_case() {
  local name="$1"
  local agent="${2:-}"
  local payload="$3"
  local expected="$4"
  TOTAL=$((TOTAL + 1))

  local actual
  if [[ -n "$agent" ]]; then
    actual=$(AFAQ_AGENT="$agent" bash "$HOOK" <<< "$payload" 2>/dev/null; echo $?)
  else
    actual=$(bash "$HOOK" <<< "$payload" 2>/dev/null; echo $?)
  fi

  if [[ "$actual" == "$expected" ]]; then
    echo "PASS [$TOTAL] $name (exit=$actual, expected=$expected)"
    PASS=$((PASS + 1))
  else
    echo "FAIL [$TOTAL] $name (exit=$actual, expected=$expected)"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== check-agent-ownership.sh test suite ==="
echo ""

# ── Case 1: AFAQ_AGENT unset -> allow any path ──────────────────
run_case "unset AFAQ_AGENT -> allow" "" \
  '{"tool_name":"Write","tool_input":{"file_path":"CLAUDE.md"}}' \
  "0"

# ── Case 2: sales-ar writes src/modules/ledger/posting.ts -> BLOCKED ──
run_case "sales-ar writes ledger module -> BLOCKED" "sales-ar" \
  '{"tool_name":"Write","tool_input":{"file_path":"src/modules/ledger/posting.ts"}}' \
  "2"

# ── Case 3: ledger-core writes src/modules/ledger/posting.ts -> ALLOWED ──
run_case "ledger-core writes ledger module -> ALLOWED" "ledger-core" \
  '{"tool_name":"Write","tool_input":{"file_path":"src/modules/ledger/posting.ts"}}' \
  "0"

# ── Case 4: frontend-ux edits prisma/schema.prisma -> BLOCKED ──
run_case "frontend-ux edits prisma schema -> BLOCKED" "frontend-ux" \
  '{"tool_name":"Edit","tool_input":{"file_path":"prisma/schema.prisma"}}' \
  "2"

# ── Case 5: auth-tenancy edits prisma/schema.prisma -> ALLOWED ──
run_case "auth-tenancy edits prisma schema -> ALLOWED" "auth-tenancy" \
  '{"tool_name":"Edit","tool_input":{"file_path":"prisma/schema.prisma"}}' \
  "0"

# ── Case 6: Bash read (cat pipe) is allowed for sales-ar ─────────
run_case "sales-ar cat prisma/schema.prisma | head -> ALLOWED" "sales-ar" \
  '{"tool_name":"Bash","tool_input":{"command":"cat prisma/schema.prisma | head"}}' \
  "0"

# ── Case 7: Bash python3 write to prisma/schema.prisma blocked ──
run_case "sales-ar python3 write prisma/schema.prisma -> BLOCKED" "sales-ar" \
  $'{"tool_name":"Bash","tool_input":{"command":"python3 -c \\"open(\'prisma/schema.prisma\',\'w\').write(\'x\')\\""}}' \
  "2"

# ── Case 8: qa-auditor writes tests/integration/ledger/x.test.ts -> ALLOWED ──
run_case "qa-auditor writes integration test -> ALLOWED" "qa-auditor" \
  '{"tool_name":"Write","tool_input":{"file_path":"tests/integration/ledger/x.test.ts"}}' \
  "0"

# ── Case 9: sales-ar writes tests/integration/ledger/x.test.ts -> BLOCKED ──
run_case "sales-ar writes integration test -> BLOCKED" "sales-ar" \
  '{"tool_name":"Write","tool_input":{"file_path":"tests/integration/ledger/x.test.ts"}}' \
  "2"

# ── Case 10: platform-guardian writes .claude/settings.json -> ALLOWED ──
run_case "platform-guardian writes settings.json -> ALLOWED" "platform-guardian" \
  '{"tool_name":"Write","tool_input":{"file_path":".claude/settings.json"}}' \
  "0"

# ── Case 11: sales-ar writes .claude/settings.json -> BLOCKED ────
run_case "sales-ar writes settings.json -> BLOCKED" "sales-ar" \
  '{"tool_name":"Write","tool_input":{"file_path":".claude/settings.json"}}' \
  "2"

# ── Case 12: ledger-core writes prisma/migrations/001.sql -> ALLOWED ──
run_case "ledger-core writes prisma migration -> ALLOWED" "ledger-core" \
  '{"tool_name":"Write","tool_input":{"file_path":"prisma/migrations/001_add_users.sql"}}' \
  "0"

# ── Case 13: sales-ar writes prisma/migrations/001.sql -> BLOCKED ──
run_case "sales-ar writes prisma migration -> BLOCKED" "sales-ar" \
  '{"tool_name":"Write","tool_input":{"file_path":"prisma/migrations/001_add_users.sql"}}' \
  "2"

# ── Case 14: documents-ai-safety writes src/server/ai/model.ts -> ALLOWED ──
run_case "documents-ai-safety writes src/server/ai -> ALLOWED" "documents-ai-safety" \
  '{"tool_name":"Write","tool_input":{"file_path":"src/server/ai/model.ts"}}' \
  "0"

# ── Case 15: ledger-core writes src/server/ai/model.ts -> BLOCKED ──
run_case "ledger-core writes src/server/ai -> BLOCKED" "ledger-core" \
  '{"tool_name":"Write","tool_input":{"file_path":"src/server/ai/model.ts"}}' \
  "2"

# ── Case 16: frontend-ux writes src/ui/button.tsx -> ALLOWED ─────
run_case "frontend-ux writes src/ui -> ALLOWED" "frontend-ux" \
  '{"tool_name":"Write","tool_input":{"file_path":"src/ui/button.tsx"}}' \
  "0"

# ── Case 17: ledger-core writes src/ui/button.tsx -> BLOCKED ─────
run_case "ledger-core writes src/ui -> BLOCKED" "ledger-core" \
  '{"tool_name":"Write","tool_input":{"file_path":"src/ui/button.tsx"}}' \
  "2"

# ── Case 18: gitkeeper-integrator writes anything -> ALLOWED ─────
run_case "gitkeeper-integrator writes CLAUDE.md -> ALLOWED" "gitkeeper-integrator" \
  '{"tool_name":"Write","tool_input":{"file_path":"CLAUDE.md"}}' \
  "0"

# ── Case 19: architect writes CLAUDE.md -> ALLOWED ───────────────
run_case "architect writes CLAUDE.md -> ALLOWED" "architect" \
  '{"tool_name":"Write","tool_input":{"file_path":"CLAUDE.md"}}' \
  "0"

# ── Case 20: sales-ar writes CLAUDE.md -> BLOCKED ────────────────
run_case "sales-ar writes CLAUDE.md -> BLOCKED" "sales-ar" \
  '{"tool_name":"Write","tool_input":{"file_path":"CLAUDE.md"}}' \
  "2"

# ── Case 21: Bash mv SRC DEST -> DEST is write target ────────────
run_case "sales-ar mv src/modules/ledger/x.ts -> BLOCKED" "sales-ar" \
  '{"tool_name":"Bash","tool_input":{"command":"mv src/modules/ledger/x.ts src/modules/ledger/y.ts"}}' \
  "2"

# ── Case 22: Bash rm on protected path -> blocked ────────────────
run_case "sales-ar rm .claude/settings.json -> BLOCKED" "sales-ar" \
  '{"tool_name":"Bash","tool_input":{"command":"rm .claude/settings.json"}}' \
  "2"

# ── Case 23: platform-guardian writes package.json -> ALLOWED ────
run_case "platform-guardian writes package.json -> ALLOWED" "platform-guardian" \
  '{"tool_name":"Write","tool_input":{"file_path":"package.json"}}' \
  "0"

# ── Case 24: sales-ar writes package.json -> BLOCKED ─────────────
run_case "sales-ar writes package.json -> BLOCKED" "sales-ar" \
  '{"tool_name":"Write","tool_input":{"file_path":"package.json"}}' \
  "2"

# ── Case 25: Bash git log is read -> allowed ────────────────────
run_case "sales-ar git log -> ALLOWED (read)" "sales-ar" \
  '{"tool_name":"Bash","tool_input":{"command":"git log --oneline -10"}}' \
  "0"

# ── Case 26: node -e write detection ────────────────────────────
run_case "sales-ar node -e write -> BLOCKED" "sales-ar" \
  '{"tool_name":"Bash","tool_input":{"command":"node -e \"require(\\\"fs\\\").writeFileSync(\\\"src/modules/ledger/x.ts\\\",\\\"x\\\")\""}}' \
  "2"

# ── Case 27: src/app/(auth)/login.tsx -> auth-tenancy only ──────
run_case "ledger-core writes src/app/(auth)/login.tsx -> BLOCKED" "ledger-core" \
  '{"tool_name":"Write","tool_input":{"file_path":"src/app/(auth)/login.tsx"}}' \
  "2"

# ── Case 28: src/app/(auth)/login.tsx -> auth-tenancy ALLOWED ────
run_case "auth-tenancy writes src/app/(auth)/login.tsx -> ALLOWED" "auth-tenancy" \
  '{"tool_name":"Write","tool_input":{"file_path":"src/app/(auth)/login.tsx"}}' \
  "0"

# ── Case 29: NotebookEdit tool call blocked for wrong agent ──────
run_case "sales-ar NotebookEdit prisma/schema.prisma -> BLOCKED" "sales-ar" \
  '{"tool_name":"NotebookEdit","tool_input":{"file_path":"prisma/schema.prisma"}}' \
  "2"

# ── Case 30: MultiEdit tool call blocked for wrong agent ─────────
run_case "sales-ar MultiEdit .claude/settings.json -> BLOCKED" "sales-ar" \
  '{"tool_name":"MultiEdit","tool_input":{"file_path":".claude/settings.json"}}' \
  "2"

echo ""
echo "=== Results: $PASS/$TOTAL passed, $FAIL failed ==="

if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi

exit 0
