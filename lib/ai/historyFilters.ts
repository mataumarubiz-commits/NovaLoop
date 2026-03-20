export const VALID_AI_HISTORY_MODES = [
  "summarize",
  "rewrite",
  "format",
  "headings",
  "checklist",
  "sql_draft",
  "procedure",
  "title_ideas",
  "status_summary",
  "delay_summary",
  "task_rewrite",
  "request_title",
  "request_message",
  "reject_reason",
  "send_message",
]

export const VALID_AI_HISTORY_SOURCES = ["pages", "sql", "contents", "billing", "vendor", "other"]
export const VALID_AI_HISTORY_KINDS = ["proposal", "draft", "snippet"]

export function parseAiHistorySearchParams(searchParams: URLSearchParams) {
  const sourceParam = searchParams.get("source")
  const modeParam = searchParams.get("mode")
  const applyTargetParam = searchParams.get("applyTarget")
  const recordIdParam = searchParams.get("recordId")
  const sourceObjectParam = searchParams.get("sourceObject")
  const limitParam = Number(searchParams.get("limit") ?? "6")
  const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(10, Math.floor(limitParam))) : 6

  return {
    source: VALID_AI_HISTORY_SOURCES.includes(sourceParam ?? "") ? sourceParam : null,
    mode: VALID_AI_HISTORY_MODES.includes(modeParam ?? "") ? modeParam : null,
    applyTarget: applyTargetParam?.trim() || null,
    recordId: recordIdParam?.trim() || null,
    sourceObject: sourceObjectParam?.trim() || null,
    limit,
  }
}
