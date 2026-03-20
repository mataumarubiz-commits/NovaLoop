const SQL_DRAFT_MODE = "sql_draft"

const ADMIN_ONLY_MODES = [
  "rewrite",
  "format",
  "headings",
  "checklist",
  "procedure",
  "sql_draft",
  "title_ideas",
  "task_rewrite",
  "request_title",
  "request_message",
  "reject_reason",
  "send_message",
]

export function buildSystemPrompt(mode: string, customInstruction?: string) {
  const additional = customInstruction?.trim() ? `Additional instruction: ${customInstruction.trim()}` : ""

  if (mode === SQL_DRAFT_MODE) {
    return [
      "You are a careful SQL assistant for Supabase/PostgreSQL.",
      "You ONLY output SQL, no explanations.",
      "Never run or modify data yourself.",
      "Prefer safe, additive, idempotent drafts when possible.",
      additional,
    ]
      .filter(Boolean)
      .join("\n")
  }

  const base = "You are a Japanese writing assistant for internal SaaS operations. Always answer in Japanese."
  const prompts: Record<string, string> = {
    summarize: `${base}\nSummarize the given text concisely and clearly.`,
    rewrite: `${base}\nRewrite the text to be clearer and more natural while keeping the original meaning.`,
    format: `${base}\nReformat the text for readability with line breaks, bullets, and short sections when helpful.`,
    headings: `${base}\nGenerate a concise heading structure or outline for the text.`,
    checklist: `${base}\nConvert the text into a practical checklist. Use one item per line and prefix each line with '- [ ]'.`,
    procedure: `${base}\nConvert the text into a numbered step-by-step procedure in imperative form. Output only the procedure.`,
    title_ideas: `${base}\nPropose 3 to 5 short title candidates. Output one candidate per line with no explanation.`,
    status_summary: `${base}\nWrite a short internal status summary that is easy to paste into chat or notes.`,
    delay_summary: `${base}\nSummarize the delay, impact, and next action in a concise operator-facing format.`,
    task_rewrite: `${base}\nRewrite the text into a clear actionable task message.`,
    request_title: `${base}\nPropose 3 concise subject line candidates for an invoice request. Output one candidate per line.`,
    request_message: `${base}\nDraft a polite invoice request message body in Japanese. Keep it practical and ready to send.`,
    reject_reason: `${base}\nRewrite the rejection reason into a concise, respectful, and actionable Japanese message.`,
    send_message: `${base}\nDraft a short send/cover message in Japanese for sharing an invoice or PDF.`,
    sql_draft: "",
  }

  return [prompts[mode] ?? prompts.summarize, additional].filter(Boolean).join("\n")
}

export function isAdminOnlyMode(mode: string) {
  return ADMIN_ONLY_MODES.includes(mode)
}

export function kindForMode(mode: string) {
  switch (mode) {
    case "title_ideas":
    case "request_title":
    case "headings":
      return "proposal"
    case "summarize":
    case "status_summary":
    case "delay_summary":
      return "snippet"
    default:
      return "draft"
  }
}

export function trimForLog(value: string, maxLength: number) {
  const normalized = value.trim()
  if (!normalized) return null
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}...`
}
