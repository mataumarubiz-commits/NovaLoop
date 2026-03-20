import OpenAI from "openai"
import { trackServerEvent } from "@/lib/analytics"
import { EXTERNAL_CHAT_COPY } from "./externalCopy"
import { writeExternalAiAuditLog } from "./externalAudit"
import { runInternalTool } from "./internalTools"
import type { ExternalActorContext, ExternalChannelType, InternalToolName, ToolExecutionResult } from "./externalTypes"

type IntentCategory =
  | "overall"
  | "contents"
  | "billing"
  | "vendor_invoices"
  | "payouts"
  | "notifications"
  | "manuals"

type GatewayStatus = "completed" | "denied"

type GatewayResult = {
  response: string
  selectedTools: InternalToolName[]
  toolResults: ToolExecutionResult[]
  category: IntentCategory
  followups: string[]
  status: GatewayStatus
}

type IntentPlan = {
  category: IntentCategory
  tools: InternalToolName[]
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map((item) => asRecord(item)) : []
}

function asText(value: unknown) {
  return typeof value === "string" ? value : ""
}

function asNumber(value: unknown) {
  const num = Number(value ?? 0)
  return Number.isFinite(num) ? num : 0
}

function normalizeMessage(message: string) {
  return message.toLowerCase().replace(/\s+/g, "")
}

function containsAny(text: string, patterns: string[]) {
  return patterns.some((pattern) => text.includes(pattern))
}

function formatYen(value: number) {
  return `${value.toLocaleString("ja-JP")}円`
}

function uniqueReferences(results: ToolExecutionResult[]) {
  return Array.from(new Set(results.flatMap((result) => result.references)))
}

function findResult(results: ToolExecutionResult[], tool: InternalToolName) {
  return results.find((result) => result.tool === tool)
}

function toolDenied(result: ToolExecutionResult | undefined) {
  return result?.data.denied === true
}

function anyDenied(results: ToolExecutionResult[]) {
  return results.some((result) => result.data.denied === true)
}

function allDenied(results: ToolExecutionResult[]) {
  return results.length > 0 && results.every((result) => result.data.denied === true)
}

function restrictedLine(label: string) {
  return `${label}: 権限外のため集計対象外です。`
}

function pickIntent(message: string): IntentPlan {
  const text = normalizeMessage(message)

  if (containsAny(text, ["通知", "未読", "お知らせ", "アラート"])) {
    return { category: "notifications", tools: ["get_notifications_summary"] }
  }

  if (containsAny(text, ["手順", "マニュアル", "ヘルプ", "使い方", "ページ手順", "manual"])) {
    return { category: "manuals", tools: ["search_pages_manuals", "get_help_answer_candidates", "get_manual_steps_for_topic"] }
  }

  if (containsAny(text, ["支払い", "振込", "payout", "入金予定"])) {
    return { category: "payouts", tools: ["get_payout_summary", "get_upcoming_payouts", "get_vendor_invoice_summary"] }
  }

  if (containsAny(text, ["外注請求", "ベンダー請求", "未提出外注", "差し戻し外注", "vendorinvoice"])) {
    return {
      category: "vendor_invoices",
      tools: ["get_vendor_invoice_summary", "get_unsubmitted_vendor_invoices", "get_returned_vendor_invoices", "get_upcoming_payouts"],
    }
  }

  if (containsAny(text, ["請求", "未入金", "請求依頼", "invoice", "billing"])) {
    return { category: "billing", tools: ["get_billing_summary", "get_unpaid_invoices", "get_pending_invoice_requests", "get_invoices_summary"] }
  }

  if (containsAny(text, ["案件", "コンテンツ", "遅延", "納期", "contents"])) {
    return { category: "contents", tools: ["get_org_dashboard_summary", "get_contents_summary", "get_delayed_contents", "get_contents_by_client"] }
  }

  return {
    category: "overall",
    tools: ["get_org_dashboard_summary", "get_overdue_items", "get_billing_summary", "get_vendor_invoice_summary", "get_payout_summary", "get_notifications_summary"],
  }
}

function followupPrompts(category: IntentCategory) {
  switch (category) {
    case "overall":
      return ["遅延案件だけ", "未入金だけ", "未読通知だけ"]
    case "contents":
      return ["遅延案件だけ", "A社案件だけ", "今週納期だけ"]
    case "billing":
      return ["未入金だけ", "請求依頼だけ", "A社請求だけ"]
    case "vendor_invoices":
      return ["未提出外注だけ", "差し戻しだけ", "支払い予定だけ"]
    case "payouts":
      return ["今週支払いだけ", "未払い外注だけ", "支払済みだけ"]
    case "notifications":
      return ["未読通知だけ", "今日の通知だけ", "外注通知だけ"]
    case "manuals":
      return ["請求手順", "外注請求フロー", "Pagesの使い方"]
  }
}

function summarizeOverall(results: ToolExecutionResult[]) {
  const dashboardResult = findResult(results, "get_org_dashboard_summary")
  const billingResult = findResult(results, "get_billing_summary")
  const vendorResult = findResult(results, "get_vendor_invoice_summary")
  const payoutResult = findResult(results, "get_payout_summary")
  const notificationResult = findResult(results, "get_notifications_summary")

  const lines: string[] = []

  if (toolDenied(dashboardResult)) {
    lines.push(restrictedLine("案件サマリー"))
  } else {
    const dashboard = asRecord(dashboardResult?.data)
    lines.push(`本日納期 ${asNumber(dashboard.today_due_count)} 件 / 遅延 ${asNumber(dashboard.overdue_count)} 件`)
  }

  if (toolDenied(billingResult)) {
    lines.push(restrictedLine("請求サマリー"))
  } else {
    const billing = asRecord(billingResult?.data)
    lines.push(`請求 ${asNumber(billing.total_count)} 件 / 合計 ${formatYen(asNumber(billing.total_amount))}`)
  }

  if (toolDenied(vendorResult)) {
    lines.push(restrictedLine("外注請求"))
  } else {
    const vendorItems = asArray(asRecord(vendorResult?.data).items)
    const submittedVendor = vendorItems.filter((item) => asText(item.status) === "submitted").length
    const draftVendor = vendorItems.filter((item) => asText(item.status) === "draft").length
    lines.push(`外注請求 未提出 ${draftVendor} 件 / 提出済み ${submittedVendor} 件`)
  }

  if (toolDenied(payoutResult)) {
    lines.push(restrictedLine("支払い予定"))
  } else {
    const payouts = asRecord(payoutResult?.data)
    lines.push(`支払い予定 ${asNumber(payouts.total_count)} 件 / 合計 ${formatYen(asNumber(payouts.total_amount))}`)
  }

  if (toolDenied(notificationResult)) {
    lines.push(restrictedLine("通知"))
  } else {
    const notifications = asRecord(notificationResult?.data)
    lines.push(
      asNumber(notifications.unread_count) > 0
        ? `未読通知 ${asNumber(notifications.unread_count)} 件`
        : "未読通知はありません。"
    )
  }

  return lines
}

function summarizeContents(message: string, results: ToolExecutionResult[]) {
  const dashboardResult = findResult(results, "get_org_dashboard_summary")
  const contentsResult = findResult(results, "get_contents_summary")
  const delayedResult = findResult(results, "get_delayed_contents")
  const clientResult = findResult(results, "get_contents_by_client")

  const delayed = toolDenied(delayedResult) ? [] : asArray(asRecord(delayedResult?.data).items)
  const clientItems = toolDenied(clientResult) ? [] : asArray(asRecord(clientResult?.data).items)
  const contents = toolDenied(contentsResult) ? [] : asArray(asRecord(contentsResult?.data).items)
  const selected = message.includes("社") && clientItems.length > 0 ? clientItems : contents
  const thisWeek = selected.filter((item) => {
    const due = asText(item.due_client_at)
    if (!due) return false
    const diff = (new Date(due).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    return diff >= 0 && diff <= 7
  })

  const lines: string[] = []
  if (toolDenied(dashboardResult)) lines.push(restrictedLine("案件ダッシュボード"))
  else {
    const dashboard = asRecord(dashboardResult?.data)
    lines.push(`本日納期 ${asNumber(dashboard.today_due_count)} 件 / 遅延 ${asNumber(dashboard.overdue_count)} 件`)
  }
  if (toolDenied(delayedResult)) lines.push(restrictedLine("遅延案件"))
  else lines.push(delayed.length > 0 ? `遅延案件 ${delayed.length} 件` : "遅延案件はありません。")
  if (toolDenied(contentsResult)) lines.push(restrictedLine("案件一覧"))
  else lines.push(`進行中案件 ${selected.filter((item) => !["delivered", "published", "canceled"].includes(asText(item.status))).length} 件`)
  if (toolDenied(clientResult)) lines.push(restrictedLine("クライアント別案件"))
  else lines.push(thisWeek.length > 0 ? `今週納期 ${thisWeek.length} 件` : "今週納期の案件はありません。")
  lines.push(...selected.slice(0, 2).map((item) => `${asText(item.project_name || item.title)} / ${asText(item.status)} / ${asText(item.due_client_at) || "-"}`))
  return lines
}

function summarizeBilling(results: ToolExecutionResult[]) {
  const billingResult = findResult(results, "get_billing_summary")
  const unpaidResult = findResult(results, "get_unpaid_invoices")
  const requestResult = findResult(results, "get_pending_invoice_requests")
  const invoiceListResult = findResult(results, "get_invoices_summary")

  const lines: string[] = []
  if (toolDenied(billingResult)) {
    lines.push(restrictedLine("請求サマリー"))
  } else {
    const billing = asRecord(billingResult?.data)
    lines.push(
      `請求 ${asNumber(billing.total_count)} 件 / 発行済み ${asNumber(billing.issued_count)} 件 / draft ${asNumber(billing.draft_count)} 件`
    )
    lines.push(`請求合計 ${formatYen(asNumber(billing.total_amount))}`)
  }

  if (toolDenied(unpaidResult)) lines.push(restrictedLine("未入金"))
  else {
    const unpaid = asArray(asRecord(unpaidResult?.data).items)
    lines.push(unpaid.length > 0 ? `未入金 ${unpaid.length} 件` : "未入金はありません。")
  }

  if (toolDenied(requestResult)) lines.push(restrictedLine("請求依頼"))
  else {
    const requests = asArray(asRecord(requestResult?.data).items)
    lines.push(requests.length > 0 ? `対応待ち請求依頼 ${requests.length} 件` : "対応待ちの請求依頼はありません。")
  }

  if (toolDenied(invoiceListResult)) lines.push(restrictedLine("請求一覧"))
  else {
    const invoices = asArray(asRecord(invoiceListResult?.data).items)
    lines.push(...invoices.slice(0, 2).map((item) => `${asText(item.invoice_no || item.invoice_title)} / ${asText(item.status)} / ${formatYen(asNumber(item.total))}`))
  }

  return lines
}

function summarizeVendorInvoices(results: ToolExecutionResult[]) {
  const allResult = findResult(results, "get_vendor_invoice_summary")
  const unsubmittedResult = findResult(results, "get_unsubmitted_vendor_invoices")
  const returnedResult = findResult(results, "get_returned_vendor_invoices")
  const payoutResult = findResult(results, "get_upcoming_payouts")

  const lines: string[] = []
  if (toolDenied(allResult)) lines.push(restrictedLine("外注請求一覧"))
  else {
    const all = asArray(asRecord(allResult?.data).items)
    const submitted = all.filter((item) => asText(item.status) === "submitted").length
    const approved = all.filter((item) => asText(item.status) === "approved").length
    lines.push(`外注請求 ${all.length} 件 / 提出済み ${submitted} 件 / 承認済み ${approved} 件`)
  }
  if (toolDenied(unsubmittedResult)) lines.push(restrictedLine("未提出外注"))
  else {
    const unsubmitted = asArray(asRecord(unsubmittedResult?.data).items)
    lines.push(unsubmitted.length > 0 ? `未提出 ${unsubmitted.length} 件` : "未提出はありません。")
  }
  if (toolDenied(returnedResult)) lines.push(restrictedLine("差し戻し外注"))
  else {
    const returned = asArray(asRecord(returnedResult?.data).items)
    lines.push(returned.length > 0 ? `差し戻し ${returned.length} 件` : "差し戻しはありません。")
  }
  if (toolDenied(payoutResult)) lines.push(restrictedLine("支払い予定"))
  else {
    const upcoming = asArray(asRecord(payoutResult?.data).items)
    lines.push(upcoming.length > 0 ? `7日以内の支払い予定 ${upcoming.length} 件` : "7日以内の支払い予定はありません。")
  }
  return lines
}

function summarizePayouts(results: ToolExecutionResult[]) {
  const payoutResult = findResult(results, "get_payout_summary")
  const upcomingResult = findResult(results, "get_upcoming_payouts")
  const vendorResult = findResult(results, "get_vendor_invoice_summary")

  const lines: string[] = []
  if (toolDenied(payoutResult)) lines.push(restrictedLine("支払いサマリー"))
  else {
    const payouts = asRecord(payoutResult?.data)
    lines.push(`支払い予定 ${asNumber(payouts.total_count)} 件 / 合計 ${formatYen(asNumber(payouts.total_amount))}`)
  }
  if (toolDenied(upcomingResult)) lines.push(restrictedLine("直近支払い"))
  else {
    const upcoming = asArray(asRecord(upcomingResult?.data).items)
    lines.push(upcoming.length > 0 ? `7日以内の支払い予定 ${upcoming.length} 件` : "7日以内の支払い予定はありません。")
  }
  if (toolDenied(vendorResult)) lines.push(restrictedLine("外注請求状況"))
  else {
    const vendorItems = asArray(asRecord(vendorResult?.data).items)
    const unpaid = vendorItems.filter((item) => ["submitted", "approved"].includes(asText(item.status))).length
    const paid = vendorItems.filter((item) => asText(item.status) === "paid").length
    lines.push(`未払い相当 ${unpaid} 件 / 支払済み ${paid} 件`)
  }
  return lines
}

function summarizeNotifications(results: ToolExecutionResult[]) {
  const notificationsResult = findResult(results, "get_notifications_summary")
  if (toolDenied(notificationsResult)) return [restrictedLine("通知")]

  const notifications = asRecord(notificationsResult?.data)
  const items = asArray(notifications.items)
  const today = new Date().toISOString().slice(0, 10)
  const todayItems = items.filter((item) => asText(item.created_at).slice(0, 10) === today)
  const vendorItems = items.filter((item) => asText(item.type).includes("vendor"))

  return [
    asNumber(notifications.unread_count) > 0 ? `未読通知 ${asNumber(notifications.unread_count)} 件` : "未読通知はありません。",
    todayItems.length > 0 ? `今日の通知 ${todayItems.length} 件` : "今日の通知はありません。",
    vendorItems.length > 0 ? `外注関連通知 ${vendorItems.length} 件` : "外注関連通知はありません。",
  ]
}

function summarizeManuals(results: ToolExecutionResult[]) {
  const helpResult = findResult(results, "get_help_answer_candidates")
  const pageResult = findResult(results, "search_pages_manuals")
  const manualStepsResult = findResult(results, "get_manual_steps_for_topic")

  if (toolDenied(helpResult) && toolDenied(pageResult) && toolDenied(manualStepsResult)) {
    return [buildPermissionMessage({ role: "member" } as ExternalActorContext)]
  }

  const helpItems = toolDenied(helpResult) ? [] : asArray(asRecord(helpResult?.data).items)
  const pageItems = toolDenied(pageResult) ? [] : asArray(asRecord(pageResult?.data).items)
  const stepItems = toolDenied(manualStepsResult) ? [] : asArray(asRecord(manualStepsResult?.data).items)
  const picked = stepItems[0] ?? helpItems[0] ?? pageItems[0] ?? null
  if (!picked) return [EXTERNAL_CHAT_COPY.common.noData]

  const title = asText(picked.title) || "関連ヘルプ"
  const steps = Array.isArray(picked.steps) ? picked.steps.map((step) => asText(step)).filter(Boolean) : []
  if (steps.length === 0) {
    return [title, asText(picked.excerpt) || EXTERNAL_CHAT_COPY.common.noData]
  }

  return [title, ...steps.slice(0, 3).map((step, index) => `${index + 1}. ${step}`)]
}

function buildPermissionMessage(actor: ExternalActorContext) {
  const lines: string[] = [EXTERNAL_CHAT_COPY.common.permission]
  if (actor.role === "vendor") lines.push(EXTERNAL_CHAT_COPY.common.permissionVendor)
  else lines.push(EXTERNAL_CHAT_COPY.common.permissionAdmin)
  return lines.join("\n")
}

function buildConclusion(category: IntentCategory, message: string) {
  switch (category) {
    case "overall":
      return "全体状況を整理しました。"
    case "contents":
      return message.includes("遅延") ? "案件の遅延状況を整理しました。" : "案件状況を整理しました。"
    case "billing":
      return "請求状況を整理しました。"
    case "vendor_invoices":
      return "外注請求状況を整理しました。"
    case "payouts":
      return "支払い状況を整理しました。"
    case "notifications":
      return "通知状況を整理しました。"
    case "manuals":
      return "関連する手順を整理しました。"
  }
}

function buildSummaryLines(category: IntentCategory, message: string, results: ToolExecutionResult[]) {
  switch (category) {
    case "overall":
      return summarizeOverall(results)
    case "contents":
      return summarizeContents(message, results)
    case "billing":
      return summarizeBilling(results)
    case "vendor_invoices":
      return summarizeVendorInvoices(results)
    case "payouts":
      return summarizePayouts(results)
    case "notifications":
      return summarizeNotifications(results)
    case "manuals":
      return summarizeManuals(results)
  }
}

function buildPlainResponse(category: IntentCategory, message: string, results: ToolExecutionResult[], actor: ExternalActorContext) {
  if (allDenied(results)) return buildPermissionMessage(actor)

  const references = uniqueReferences(results)
  const followups = followupPrompts(category)
  const lines = buildSummaryLines(category, message, results)
  const partialRestriction = anyDenied(results) ? "一部の情報は権限外のため除外しています。" : null

  return [
    buildConclusion(category, message),
    ...lines.slice(0, 5),
    partialRestriction,
    `次に聞けること: ${followups.slice(0, 3).join(" / ")}`,
    `参照: ${references.join(" / ") || "-"}`,
  ]
    .filter(Boolean)
    .join("\n")
}

function buildLineResponse(category: IntentCategory, message: string, results: ToolExecutionResult[], actor: ExternalActorContext) {
  return buildPlainResponse(category, message, results, actor)
    .split("\n")
    .slice(0, 5)
    .join("\n")
}

async function renderWithOpenAI(params: {
  actor: ExternalActorContext
  message: string
  category: IntentCategory
  results: ToolExecutionResult[]
}) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null

  const client = new OpenAI({ apiKey })
  const model = process.env.OPENAI_MODEL || "gpt-5.1-chat-latest"
  const response = await client.responses.create({
    model,
    input: [
      {
        role: "system",
        content: [
          "You are NovaLoop's read-only operator AI.",
          "Always answer in Japanese.",
          "Use only provided tool results.",
          "Never invent counts or statuses.",
          "If any tool is denied, state that clearly and do not treat it as zero.",
          "Start with a short conclusion.",
          "Then provide 3 to 6 short lines with counts, amounts, months, and statuses when available.",
          "End with a short 参照 line.",
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify({
          role: params.actor.role,
          category: params.category,
          message: params.message,
          tool_results: params.results,
        }),
      },
    ],
  })

  return response.output_text?.toString().trim() || null
}

export async function answerExternalAiQuestion(params: {
  actor: ExternalActorContext
  channelType: ExternalChannelType
  message: string
}): Promise<GatewayResult> {
  const plan = pickIntent(params.message)
  const toolResults: ToolExecutionResult[] = []

  for (const tool of plan.tools) {
    toolResults.push(await runInternalTool({ actor: params.actor, tool, query: params.message }))
  }

  const status: GatewayStatus = allDenied(toolResults) ? "denied" : "completed"
  const forcePlain = params.channelType === "line" || anyDenied(toolResults)
  const response = forcePlain
    ? params.channelType === "line"
      ? buildLineResponse(plan.category, params.message, toolResults, params.actor)
      : buildPlainResponse(plan.category, params.message, toolResults, params.actor)
    : (await renderWithOpenAI({
          actor: params.actor,
          message: params.message,
          category: plan.category,
          results: toolResults,
        }).catch(() => null)) ??
      buildPlainResponse(plan.category, params.message, toolResults, params.actor)

  const followups = followupPrompts(plan.category)

  await trackServerEvent({
    orgId: params.actor.orgId,
    userId: params.actor.linkedUserId,
    role: params.actor.role,
    eventName: "ai.external_chat.answer",
    source: params.channelType,
    metadata: {
      category: plan.category,
      selected_tools: plan.tools,
      status,
    },
  })

  await writeExternalAiAuditLog({
    channelType: params.channelType,
    externalUserId: params.actor.externalUserId,
    actor: params.actor,
    userMessage: params.message,
    selectedTools: plan.tools,
    toolResultSummary: Object.fromEntries(toolResults.map((result) => [result.tool, result.summary])),
    aiResponse: response,
    status,
  })

  return {
    response,
    selectedTools: plan.tools,
    toolResults,
    category: plan.category,
    followups,
    status,
  }
}
