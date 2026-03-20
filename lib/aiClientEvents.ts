export type AiMode =
  | "summarize"
  | "rewrite"
  | "format"
  | "headings"
  | "checklist"
  | "sql_draft"
  | "procedure"
  | "title_ideas"
  | "status_summary"
  | "delay_summary"
  | "task_rewrite"
  | "request_title"
  | "request_message"
  | "reject_reason"
  | "send_message"

export type AiSource = "pages" | "sql" | "contents" | "billing" | "vendor" | "other"

export type AiApplyTransform = "raw" | "first_line"

export type AiResultKind = "proposal" | "draft" | "snippet"

export type AiMeta = Record<string, unknown>

export type AiTextResult = {
  kind: AiResultKind
  mode: AiMode
  text: string
}

export type AiApiSuccessPayload = {
  result: AiTextResult
}

export type AiHistoryItem = {
  id: string
  source: AiSource
  mode: AiMode
  kind: AiResultKind
  text: string
  createdAt: string
  applyTarget?: string | null
  meta?: AiMeta | null
}

export type AiHistoryResponsePayload = {
  items: AiHistoryItem[]
}

export type OpenAiPaletteDetail = {
  source?: AiSource
  text?: string
  context?: string
  mode?: AiMode
  modes?: AiMode[]
  title?: string
  compareText?: string
  applyLabel?: string
  applyTarget?: string
  applyTransform?: AiApplyTransform
  meta?: AiMeta
}

export type ApplyAiResultDetail = {
  source: AiSource
  mode: AiMode
  result: AiTextResult
  applyTarget?: string
  meta?: AiMeta
}
