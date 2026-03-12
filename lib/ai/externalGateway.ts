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

type GatewayResult = {
  response: string
  selectedTools: InternalToolName[]
  toolResults: ToolExecutionResult[]
  category: IntentCategory
  followups: string[]
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

function allDenied(results: ToolExecutionResult[]) {
  return results.length > 0 && results.every((result) => result.data.denied === true)
}

function pickIntent(message: string): IntentPlan {
  const text = normalizeMessage(message)

  if (containsAny(text, ["未読通知", "今日の通知", "承認待ち通知", "外注請求関連の通知", "重要な通知", "通知まとめて"])) {
    return { category: "notifications", tools: ["get_notifications_summary"] }
  }

  if (containsAny(text, ["手順", "マニュアル", "確認フロー", "使い方", "月末請求", "ページ機能"])) {
    return { category: "manuals", tools: ["search_pages_manuals", "get_help_answer_candidates", "get_manual_steps_for_topic"] }
  }

  if (containsAny(text, ["支払い", "支払う", "支払済み", "未払い", "payout", "支払い予定"])) {
    return { category: "payouts", tools: ["get_payout_summary", "get_upcoming_payouts", "get_vendor_invoice_summary"] }
  }

  if (containsAny(text, ["外注請求", "未提出の外注請求", "差し戻し中の外注", "提出済みの外注", "支払い待ちの外注請求"])) {
    return {
      category: "vendor_invoices",
      tools: ["get_vendor_invoice_summary", "get_unsubmitted_vendor_invoices", "get_returned_vendor_invoices", "get_upcoming_payouts"],
    }
  }

  if (containsAny(text, ["今月の請求", "未入金", "請求未作成", "請求状況", "差し戻し中の請求"])) {
    return { category: "billing", tools: ["get_billing_summary", "get_unpaid_invoices", "get_pending_invoice_requests", "get_invoices_summary"] }
  }

  if (containsAny(text, ["案件", "遅延案件", "今週納期", "進行中案件"])) {
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
      return ["遅延案件だけ", "A社だけ", "今週納期だけ"]
    case "billing":
      return ["未入金だけ", "差し戻しだけ", "A社だけ"]
    case "vendor_invoices":
      return ["外注未提出の詳細", "差し戻しだけ", "支払い待ちだけ"]
    case "payouts":
      return ["支払い予定だけ", "今週分だけ", "未払いだけ"]
    case "notifications":
      return ["未読通知だけ", "今日の通知だけ", "外注請求関連だけ"]
    case "manuals":
      return ["請求の手順", "外注請求の確認フロー", "ページ機能の使い方"]
  }
}

function summarizeOverall(results: ToolExecutionResult[]) {
  const dashboard = asRecord(results.find((result) => result.tool === "get_org_dashboard_summary")?.data)
  const billing = asRecord(results.find((result) => result.tool === "get_billing_summary")?.data)
  const payouts = asRecord(results.find((result) => result.tool === "get_payout_summary")?.data)
  const notifications = asRecord(results.find((result) => result.tool === "get_notifications_summary")?.data)
  const vendorItems = asArray(asRecord(results.find((result) => result.tool === "get_vendor_invoice_summary")?.data).items)
  const submittedVendor = vendorItems.filter((item) => asText(item.status) === "submitted").length
  const draftVendor = vendorItems.filter((item) => asText(item.status) === "draft").length

  return [
    `今日納期は ${asNumber(dashboard.today_due_count)} 件、遅延案件は ${asNumber(dashboard.overdue_count)} 件です。`,
    `今月の請求は ${asNumber(billing.total_count)} 件、合計 ${formatYen(asNumber(billing.total_amount))} です。`,
    `外注請求は 未提出 ${draftVendor} 件 / 提出済み ${submittedVendor} 件です。`,
    `支払い予定は ${asNumber(payouts.total_count)} 件、合計 ${formatYen(asNumber(payouts.total_amount))} です。`,
    asNumber(notifications.unread_count) > 0
      ? `未読通知は ${asNumber(notifications.unread_count)} 件あります。`
      : "未読通知は見つかりませんでした。",
  ]
}

function summarizeContents(message: string, results: ToolExecutionResult[]) {
  const contents = asArray(asRecord(results.find((result) => result.tool === "get_contents_summary")?.data).items)
  const delayed = asArray(asRecord(results.find((result) => result.tool === "get_delayed_contents")?.data).items)
  const clientItems = asArray(asRecord(results.find((result) => result.tool === "get_contents_by_client")?.data).items)
  const selected = message.includes("社") && clientItems.length > 0 ? clientItems : contents
  const thisWeek = selected.filter((item) => {
    const due = asText(item.due_client_at)
    if (!due) return false
    const diff = (new Date(due).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    return diff >= 0 && diff <= 7
  })
  const inProgress = selected.filter((item) => !["delivered", "published", "canceled"].includes(asText(item.status))).length

  return [
    delayed.length > 0 ? `遅延案件は ${delayed.length} 件あります。` : "遅延案件は見つかりませんでした。",
    `進行中案件は ${inProgress} 件です。`,
    thisWeek.length > 0 ? `今週納期の案件は ${thisWeek.length} 件です。` : "今週納期の案件は見つかりませんでした。",
    ...selected.slice(0, 2).map((item) => `${asText(item.project_name || item.title)} / ${asText(item.status)} / 納期 ${asText(item.due_client_at) || "-"}`),
  ]
}

function summarizeBilling(results: ToolExecutionResult[]) {
  const billing = asRecord(results.find((result) => result.tool === "get_billing_summary")?.data)
  const unpaid = asArray(asRecord(results.find((result) => result.tool === "get_unpaid_invoices")?.data).items)
  const requests = asArray(asRecord(results.find((result) => result.tool === "get_pending_invoice_requests")?.data).items)
  const returned = requests.filter((item) => asText(item.status) === "returned")

  return [
    `今月の請求は ${asNumber(billing.total_count)} 件、発行済み ${asNumber(billing.issued_count)} 件、draft ${asNumber(billing.draft_count)} 件です。`,
    `請求総額は ${formatYen(asNumber(billing.total_amount))} です。`,
    unpaid.length > 0 ? `未入金候補は ${unpaid.length} 件あります。` : "未入金は見つかりませんでした。",
    requests.length > 0 ? `請求依頼の未対応は ${requests.length} 件です。` : "請求依頼の未対応は見つかりませんでした。",
    returned.length > 0 ? `差し戻し中の請求は ${returned.length} 件です。` : "差し戻し中の請求は見つかりませんでした。",
  ]
}

function summarizeVendorInvoices(results: ToolExecutionResult[]) {
  const all = asArray(asRecord(results.find((result) => result.tool === "get_vendor_invoice_summary")?.data).items)
  const unsubmitted = asArray(asRecord(results.find((result) => result.tool === "get_unsubmitted_vendor_invoices")?.data).items)
  const returned = asArray(asRecord(results.find((result) => result.tool === "get_returned_vendor_invoices")?.data).items)
  const submitted = all.filter((item) => asText(item.status) === "submitted").length
  const approved = all.filter((item) => asText(item.status) === "approved").length

  return [
    `外注請求は ${all.length} 件を確認しました。`,
    unsubmitted.length > 0 ? `未提出の外注請求は ${unsubmitted.length} 件です。` : "未提出の外注請求はありません。",
    returned.length > 0 ? `差し戻し中の外注請求は ${returned.length} 件です。` : "差し戻し中の外注請求は見つかりませんでした。",
    `提出済みは ${submitted} 件、承認済みは ${approved} 件です。`,
  ]
}

function summarizePayouts(results: ToolExecutionResult[]) {
  const payouts = asRecord(results.find((result) => result.tool === "get_payout_summary")?.data)
  const upcoming = asArray(asRecord(results.find((result) => result.tool === "get_upcoming_payouts")?.data).items)
  const vendorItems = asArray(asRecord(results.find((result) => result.tool === "get_vendor_invoice_summary")?.data).items)
  const unpaid = vendorItems.filter((item) => ["submitted", "approved"].includes(asText(item.status))).length
  const paid = vendorItems.filter((item) => asText(item.status) === "paid").length

  return [
    `今月の支払い予定は ${asNumber(payouts.total_count)} 件、合計 ${formatYen(asNumber(payouts.total_amount))} です。`,
    upcoming.length > 0 ? `今週支払う外注は ${upcoming.length} 件です。` : "今週支払う外注は見つかりませんでした。",
    `未払いは ${unpaid} 件、支払済みは ${paid} 件です。`,
  ]
}

function summarizeNotifications(results: ToolExecutionResult[]) {
  const notifications = asRecord(results.find((result) => result.tool === "get_notifications_summary")?.data)
  const items = asArray(notifications.items)
  const today = new Date().toISOString().slice(0, 10)
  const todayItems = items.filter((item) => asText(item.created_at).slice(0, 10) === today)
  const vendorItems = items.filter((item) => asText(item.type).includes("vendor"))

  return [
    asNumber(notifications.unread_count) > 0
      ? `未読通知は ${asNumber(notifications.unread_count)} 件あります。`
      : "未読通知は見つかりませんでした。",
    todayItems.length > 0 ? `今日の通知は ${todayItems.length} 件です。` : "今日の通知は見つかりませんでした。",
    vendorItems.length > 0 ? `外注請求関連の通知は ${vendorItems.length} 件です。` : "外注請求関連の通知は見つかりませんでした。",
  ]
}

function summarizeManuals(results: ToolExecutionResult[]) {
  const helpItems = asArray(asRecord(results.find((result) => result.tool === "get_help_answer_candidates")?.data).items)
  const pageItems = asArray(asRecord(results.find((result) => result.tool === "search_pages_manuals")?.data).items)
  const picked = helpItems[0] ?? pageItems[0] ?? null
  if (!picked) return [EXTERNAL_CHAT_COPY.common.noData]

  const steps = Array.isArray(picked.steps) ? picked.steps.map((step) => asText(step)).filter(Boolean) : []
  const title = asText(picked.title) || "関連する手順"
  return [title, ...steps.slice(0, 3).map((step, index) => `${index + 1}. ${step}`)]
}

function buildPermissionMessage(actor: ExternalActorContext) {
  const lines: string[] = [EXTERNAL_CHAT_COPY.common.permission]
  if (actor.role === "vendor") lines.push(EXTERNAL_CHAT_COPY.common.permissionVendor)
  else lines.push(EXTERNAL_CHAT_COPY.common.permissionAdmin)
  return lines.join("\n")
}

function buildPlainResponse(category: IntentCategory, message: string, results: ToolExecutionResult[], actor: ExternalActorContext) {
  if (allDenied(results)) return buildPermissionMessage(actor)

  const references = uniqueReferences(results)
  const followups = followupPrompts(category)
  let conclusion = "確認結果をまとめます。"
  let lines: string[] = []

  switch (category) {
    case "overall":
      conclusion = "全体状況を確認しました。"
      lines = summarizeOverall(results)
      break
    case "contents":
      conclusion = message.includes("遅延") ? "案件では、優先確認が必要なものがあります。" : "案件状況を確認しました。"
      lines = summarizeContents(message, results)
      break
    case "billing":
      conclusion = "請求状況を確認しました。"
      lines = summarizeBilling(results)
      break
    case "vendor_invoices":
      conclusion = "外注請求の状況を確認しました。"
      lines = summarizeVendorInvoices(results)
      break
    case "payouts":
      conclusion = "支払い状況を確認しました。"
      lines = summarizePayouts(results)
      break
    case "notifications":
      conclusion = "通知状況を確認しました。"
      lines = summarizeNotifications(results)
      break
    case "manuals":
      conclusion = "関連する手順を確認しました。"
      lines = summarizeManuals(results)
      break
  }

  return [
    conclusion,
    ...lines.slice(0, 5),
    `次に聞けること: ${followups.slice(0, 3).join(" / ")}`,
    `参照: ${references.join(" / ") || "-"}`,
  ].join("\n")
}

function buildLineResponse(category: IntentCategory, message: string, results: ToolExecutionResult[], actor: ExternalActorContext) {
  const plain = buildPlainResponse(category, message, results, actor).split("\n")
  const followups = followupPrompts(category)
  return [plain[0], ...plain.slice(1, 4), `次に送れる例: ${followups.slice(0, 3).join(" / ")}`].join("\n")
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
          "You are Nova loop's read-only operator AI.",
          "Always answer in Japanese.",
          "Use only provided tool results.",
          "Start with a short conclusion.",
          "Then provide 3 to 6 short lines with counts, amounts, months, and statuses when available.",
          "Do not expose internal table names.",
          "If there is no data, say so clearly.",
          "If access is denied, say so clearly.",
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

  const response =
    params.channelType === "line"
      ? buildLineResponse(plan.category, params.message, toolResults, params.actor)
      : (await renderWithOpenAI({
            actor: params.actor,
            message: params.message,
            category: plan.category,
            results: toolResults,
          }).catch(() => null)) ?? buildPlainResponse(plan.category, params.message, toolResults, params.actor)

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
    status: "completed",
  })

  return {
    response,
    selectedTools: plan.tools,
    toolResults,
    category: plan.category,
    followups,
  }
}
