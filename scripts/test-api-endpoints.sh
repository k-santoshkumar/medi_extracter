#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:8000}"
TOKEN="${TOKEN:-demo-user-id}"

printf '\n== /health ==\n'
curl -sS -i "$API_BASE/health"

printf '\n\n== /api/v1/reports ==\n'
curl -sS -i -H "Authorization: Bearer $TOKEN" "$API_BASE/api/v1/reports"

printf '\n\n== /api/v1/dashboard/stats ==\n'
curl -sS -i -H "Authorization: Bearer $TOKEN" "$API_BASE/api/v1/dashboard/stats"

printf '\n\n== / ==\n'
curl -sS -i "$API_BASE/"
