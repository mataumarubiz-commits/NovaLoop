# AGENTS.md (Project entry)

## Must-read
Before coding, read:
- docs/spec.md
- docs/decision-log.md

## Non-negotiables (do not change)
- Accounting screens (billing/vault/freee) are owner/executive_assistant only.
- Tax: exempt (no consumption tax fields).
- Billing target month = delivery_month.
- Invoice PDF filename: yŒä¿‹‘zYYYY-MM_¿‹æ–¼_¿‹–¼.pdf
- Invoice send: generate PDF only (no auto email).

## Workflow rules
- If spec is unclear: stop and ask. Do not assume.
- When you make a new decision, add it to docs/decision-log.md with a new ID.
- After implementation, output a gspec coverage reporth mapping decisions -> files.