import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import type { ExternalActorContext, ExternalActorRole, InternalToolName, ToolExecutionResult } from "./externalTypes"

const HELP_FALLBACKS: Array<{ topic: string; title: string; steps: string[] }> = [
  {
    topic: "請求",
    title: "請求の進め方",
    steps: [
      "Billing で対象月を選び、請求対象の preview を確認します。",
      "Invoices で draft を確認し、必要なら複製やゲスト宛先を調整します。",
      "PDF を生成し、送付準備済みとして管理します。",
    ],
  },
  {
    topic: "外注請求",
    title: "外注請求の確認フロー",
    steps: [
      "Vendors で請求依頼を送ります。",
      "submitted を確認して approved または差し戻しへ進めます。",
      "Payouts で支払い予定と CSV を確認します。",
    ],
  },
  {
    topic: "Pages",
    title: "Pages の使い方",
    steps: [
      "Pages で運用マニュアルや手順書を作成します。",
      "必要なルールはテンプレートから起票し、更新履歴を残します。",
      "AI パレットで文章要約や手順化を補助できます。",
    ],
  },
]

function monthKey(date = new Date()) {
  return date.toISOString().slice(0, 7)
}

function todayYmd(date = new Date()) {
  return date.toISOString().slice(0, 10)
}

function canUseTool(role: ExternalActorRole, tool: InternalToolName) {
  if (role === "vendor") {
    return [
      "get_user_role_context",
      "get_org_context",
      "get_notifications_summary",
      "get_vendor_invoice_summary",
      "get_vendor_invoice_detail",
      "get_unsubmitted_vendor_invoices",
      "get_returned_vendor_invoices",
      "get_payout_summary",
      "get_upcoming_payouts",
    ].includes(tool)
  }

  if (role === "member") {
    return [
      "get_org_context",
      "get_user_role_context",
      "get_notifications_summary",
      "search_pages_manuals",
      "get_help_answer_candidates",
      "get_org_dashboard_summary",
      "get_overdue_items",
      "get_recent_activity_summary",
      "get_contents_summary",
      "get_contents_by_client",
      "get_delayed_contents",
      "get_content_detail",
      "search_pages",
      "get_page_summary",
      "get_manual_steps_for_topic",
    ].includes(tool)
  }

  return true
}

function denied(tool: InternalToolName): ToolExecutionResult {
  return {
    tool,
    summary: "この権限では参照できません。",
    references: [],
    data: { denied: true },
  }
}

function extractTopic(input: string) {
  return input.replace(/[?？]/g, "").trim()
}

export async function runInternalTool(params: {
  actor: ExternalActorContext
  tool: InternalToolName
  query?: string
  entityId?: string | null
}): Promise<ToolExecutionResult> {
  if (!canUseTool(params.actor.role, params.tool)) return denied(params.tool)

  const admin = createSupabaseAdmin()
  const { actor, tool, query = "", entityId = null } = params
  const currentMonth = monthKey()
  const today = todayYmd()

  switch (tool) {
    case "get_org_context": {
      const [{ data: org }, { count: memberCount }] = await Promise.all([
        admin.from("organizations").select("id, name").eq("id", actor.orgId).maybeSingle(),
        admin.from("app_users").select("*", { count: "exact", head: true }).eq("org_id", actor.orgId),
      ])
      return {
        tool,
        summary: `${(org as { name?: string | null } | null)?.name ?? "組織"} / 権限 ${actor.role}`,
        references: ["organizations", "app_users"],
        data: {
          org_id: actor.orgId,
          org_name: (org as { name?: string | null } | null)?.name ?? null,
          role: actor.role,
          member_count: memberCount ?? 0,
        },
      }
    }
    case "get_user_role_context":
      return {
        tool,
        summary: `現在の権限は ${actor.role} です。`,
        references: ["external_channel_links"],
        data: {
          linked_user_id: actor.linkedUserId,
          role: actor.role,
          vendor_id: actor.vendorId,
        },
      }
    case "get_notifications_summary": {
      const { data } = await admin
        .from("notifications")
        .select("id, type, payload, read_at, created_at")
        .eq("org_id", actor.orgId)
        .eq("recipient_user_id", actor.linkedUserId)
        .order("created_at", { ascending: false })
        .limit(8)
      const rows = (data ?? []) as Array<{ id: string; type: string; read_at: string | null; created_at: string }>
      const unread = rows.filter((row) => !row.read_at)
      return {
        tool,
        summary: unread.length > 0 ? `未読通知は ${unread.length} 件です。` : "未読通知はありません。",
        references: ["notifications"],
        data: { total: rows.length, unread_count: unread.length, items: rows },
      }
    }
    case "get_org_dashboard_summary": {
      const { data } = await admin
        .from("contents")
        .select("id, due_client_at, due_editor_at, status")
        .eq("org_id", actor.orgId)
        .neq("status", "published")
        .neq("status", "canceled")
      const rows = (data ?? []) as Array<{ due_client_at: string | null; due_editor_at: string | null; status: string }>
      const todayCount = rows.filter((row) => row.due_client_at === today).length
      const delayed = rows.filter((row) => row.due_client_at && row.due_client_at < today && row.status !== "delivered").length
      const editorDelayed = rows.filter((row) => row.due_editor_at && row.due_editor_at < today && row.status !== "delivered").length
      return {
        tool,
        summary: `本日納期 ${todayCount} 件 / 遅延 ${delayed} 件 / 外注遅延 ${editorDelayed} 件`,
        references: ["contents"],
        data: { today_due_count: todayCount, overdue_count: delayed, editor_overdue_count: editorDelayed },
      }
    }
    case "get_overdue_items":
    case "get_delayed_contents": {
      let contentQuery = admin
        .from("contents")
        .select("id, project_name, title, client_id, due_client_at, status")
        .eq("org_id", actor.orgId)
        .lt("due_client_at", today)
        .neq("status", "delivered")
        .neq("status", "published")
        .order("due_client_at", { ascending: true })
        .limit(10)

      if (actor.role === "vendor" && actor.vendorId) {
        const { data: assignments } = await admin
          .from("content_vendor_assignments")
          .select("content_id")
          .eq("org_id", actor.orgId)
          .eq("vendor_id", actor.vendorId)
        const contentIds = ((assignments ?? []) as Array<{ content_id: string }>).map((row) => row.content_id)
        if (contentIds.length === 0) {
          return { tool, summary: "遅延中の案件はありません。", references: ["content_vendor_assignments"], data: { items: [] } }
        }
        contentQuery = contentQuery.in("id", contentIds)
      }

      const { data } = await contentQuery
      const rows = (data ?? []) as Array<Record<string, unknown>>
      return {
        tool,
        summary: rows.length > 0 ? `遅延案件は ${rows.length} 件あります。` : "遅延案件はありません。",
        references: ["contents"],
        data: { items: rows },
      }
    }
    case "get_recent_activity_summary": {
      const { data } = await admin
        .from("audit_logs")
        .select("action, resource_type, created_at")
        .eq("org_id", actor.orgId)
        .order("created_at", { ascending: false })
        .limit(8)
      return {
        tool,
        summary: (data ?? []).length > 0 ? `直近の更新は ${(data ?? []).length} 件あります。` : "直近の監査ログはありません。",
        references: ["audit_logs"],
        data: { items: data ?? [] },
      }
    }
    case "get_contents_summary": {
      const { data } = await admin
        .from("contents")
        .select("id, project_name, title, client_id, delivery_month, due_client_at, status")
        .eq("org_id", actor.orgId)
        .order("updated_at", { ascending: false })
        .limit(20)
      return {
        tool,
        summary: `直近の案件 ${(data ?? []).length} 件を確認しました。`,
        references: ["contents"],
        data: { items: data ?? [] },
      }
    }
    case "get_contents_by_client": {
      const clientKeyword = extractTopic(query)
      const [{ data: clients }, { data: rows }] = await Promise.all([
        admin.from("clients").select("id, name").eq("org_id", actor.orgId).ilike("name", `%${clientKeyword}%`).limit(5),
        admin
          .from("contents")
          .select("id, project_name, title, client_id, due_client_at, status")
          .eq("org_id", actor.orgId)
          .order("due_client_at", { ascending: true })
          .limit(30),
      ])
      const clientIds = new Set(((clients ?? []) as Array<{ id: string }>).map((row) => row.id))
      const matched = ((rows ?? []) as Array<Record<string, unknown>>).filter((row) => clientIds.has(String(row.client_id ?? "")))
      return {
        tool,
        summary: matched.length > 0 ? `${clientKeyword} に紐づく案件は ${matched.length} 件です。` : `${clientKeyword} に一致する案件は見つかりませんでした。`,
        references: ["clients", "contents"],
        data: { client_keyword: clientKeyword, items: matched.slice(0, 10) },
      }
    }
    case "get_content_detail": {
      const keyword = entityId ?? extractTopic(query)
      let detailQuery = admin.from("contents").select("id, project_name, title, due_client_at, due_editor_at, status, delivery_month, unit_price").eq("org_id", actor.orgId)
      if (entityId) detailQuery = detailQuery.eq("id", entityId)
      else detailQuery = detailQuery.or(`project_name.ilike.%${keyword}%,title.ilike.%${keyword}%`)
      const { data } = await detailQuery.limit(1).maybeSingle()
      const row = (data as Record<string, unknown> | null) ?? null
      return {
        tool,
        summary: row ? `${String(row.project_name ?? row.title ?? "案件")} の詳細を確認しました。` : "該当案件は見つかりませんでした。",
        references: ["contents"],
        data: { item: row },
      }
    }
    case "get_billing_summary": {
      const { data } = await admin
        .from("invoices")
        .select("id, status, total, invoice_month, due_date")
        .eq("org_id", actor.orgId)
        .eq("invoice_month", currentMonth)
      const rows = (data ?? []) as Array<{ total?: number | null; status: string }>
      const total = rows.reduce((sum, row) => sum + Number(row.total ?? 0), 0)
      const issued = rows.filter((row) => row.status === "issued").length
      const draft = rows.filter((row) => row.status === "draft").length
      return {
        tool,
        summary: `${currentMonth} の請求は ${rows.length} 件、発行済み ${issued} 件、draft ${draft} 件です。`,
        references: ["invoices"],
        data: { month: currentMonth, total_count: rows.length, issued_count: issued, draft_count: draft, total_amount: total },
      }
    }
    case "get_invoices_summary": {
      const { data } = await admin
        .from("invoices")
        .select("id, invoice_no, invoice_title, status, total, due_date, client_id, invoice_month")
        .eq("org_id", actor.orgId)
        .order("created_at", { ascending: false })
        .limit(12)
      return {
        tool,
        summary: `請求一覧から ${(data ?? []).length} 件を参照しました。`,
        references: ["invoices"],
        data: { items: data ?? [] },
      }
    }
    case "get_invoice_detail": {
      const keyword = entityId ?? extractTopic(query)
      let detailQuery = admin
        .from("invoices")
        .select("id, invoice_no, invoice_title, status, total, subtotal, due_date, issue_date, invoice_month, client_id")
        .eq("org_id", actor.orgId)
      if (entityId) detailQuery = detailQuery.eq("id", entityId)
      else detailQuery = detailQuery.or(`invoice_no.ilike.%${keyword}%,invoice_title.ilike.%${keyword}%`)
      const { data: invoice } = await detailQuery.limit(1).maybeSingle()
      const row = (invoice as Record<string, unknown> | null) ?? null
      if (!row?.id) {
        return { tool, summary: "該当する請求書は見つかりませんでした。", references: ["invoices"], data: { item: null } }
      }
      const { data: lines } = await admin
        .from("invoice_lines")
        .select("description, quantity, unit_price, amount")
        .eq("invoice_id", String(row.id))
        .order("sort_order", { ascending: true })
      return {
        tool,
        summary: `${String(row.invoice_no ?? row.invoice_title ?? "請求書")} の詳細です。`,
        references: ["invoices", "invoice_lines"],
        data: { item: row, lines: lines ?? [] },
      }
    }
    case "get_unpaid_invoices": {
      const { data } = await admin
        .from("invoices")
        .select("id, invoice_no, invoice_title, due_date, total, status")
        .eq("org_id", actor.orgId)
        .eq("status", "issued")
        .order("due_date", { ascending: true })
        .limit(20)
      return {
        tool,
        summary: (data ?? []).length > 0 ? `未入金候補の発行済み請求は ${(data ?? []).length} 件です。` : "未入金候補の発行済み請求はありません。",
        references: ["invoices"],
        data: { items: data ?? [] },
      }
    }
    case "get_pending_invoice_requests": {
      const { data } = await admin
        .from("invoice_requests")
        .select("id, requested_title, recipient_email, request_deadline, due_date, status, request_type, reminder_count")
        .eq("org_id", actor.orgId)
        .in("status", ["requested", "submitted", "returned"])
        .order("created_at", { ascending: false })
        .limit(20)
      return {
        tool,
        summary: (data ?? []).length > 0 ? `対応中の請求依頼は ${(data ?? []).length} 件あります。` : "対応中の請求依頼はありません。",
        references: ["invoice_requests"],
        data: { items: data ?? [] },
      }
    }
    case "get_vendor_summary": {
      const [{ count: vendorCount }, { count: activeRequestCount }] = await Promise.all([
        admin.from("vendors").select("*", { count: "exact", head: true }).eq("org_id", actor.orgId),
        admin
          .from("vendor_invoices")
          .select("*", { count: "exact", head: true })
          .eq("org_id", actor.orgId)
          .in("status", ["draft", "submitted", "approved"]),
      ])
      return {
        tool,
        summary: `取引先外注は ${vendorCount ?? 0} 件、進行中の外注請求は ${activeRequestCount ?? 0} 件です。`,
        references: ["vendors", "vendor_invoices"],
        data: { vendor_count: vendorCount ?? 0, active_invoice_count: activeRequestCount ?? 0 },
      }
    }
    case "get_vendor_invoice_summary": {
      let queryBuilder = admin
        .from("vendor_invoices")
        .select("id, vendor_id, billing_month, status, submit_deadline, pay_date, total")
        .eq("org_id", actor.orgId)
        .order("created_at", { ascending: false })
        .limit(20)
      if (actor.role === "vendor" && actor.vendorId) queryBuilder = queryBuilder.eq("vendor_id", actor.vendorId)
      const { data } = await queryBuilder
      return {
        tool,
        summary: `外注請求は ${(data ?? []).length} 件参照しました。`,
        references: ["vendor_invoices"],
        data: { items: data ?? [] },
      }
    }
    case "get_vendor_invoice_detail": {
      const keyword = entityId ?? extractTopic(query)
      let queryBuilder = admin
        .from("vendor_invoices")
        .select("id, vendor_id, billing_month, status, submit_deadline, pay_date, total, memo, invoice_number")
        .eq("org_id", actor.orgId)
      if (actor.role === "vendor" && actor.vendorId) queryBuilder = queryBuilder.eq("vendor_id", actor.vendorId)
      if (entityId) queryBuilder = queryBuilder.eq("id", entityId)
      else queryBuilder = queryBuilder.or(`invoice_number.ilike.%${keyword}%,billing_month.ilike.%${keyword}%`)
      const { data: invoice } = await queryBuilder.limit(1).maybeSingle()
      const row = (invoice as Record<string, unknown> | null) ?? null
      if (!row?.id) {
        return { tool, summary: "該当する外注請求は見つかりませんでした。", references: ["vendor_invoices"], data: { item: null } }
      }
      const { data: lines } = await admin
        .from("vendor_invoice_lines")
        .select("description, qty, unit_price, amount, work_type")
        .eq("vendor_invoice_id", String(row.id))
      return {
        tool,
        summary: `${String(row.invoice_number ?? row.billing_month ?? "外注請求")} の詳細です。`,
        references: ["vendor_invoices", "vendor_invoice_lines"],
        data: { item: row, lines: lines ?? [] },
      }
    }
    case "get_unsubmitted_vendor_invoices": {
      let queryBuilder = admin
        .from("vendor_invoices")
        .select("id, vendor_id, billing_month, submit_deadline, total, status")
        .eq("org_id", actor.orgId)
        .eq("status", "draft")
        .order("submit_deadline", { ascending: true })
        .limit(20)
      if (actor.role === "vendor" && actor.vendorId) queryBuilder = queryBuilder.eq("vendor_id", actor.vendorId)
      const { data } = await queryBuilder
      return {
        tool,
        summary: (data ?? []).length > 0 ? `未提出の外注請求は ${(data ?? []).length} 件です。` : "未提出の外注請求はありません。",
        references: ["vendor_invoices"],
        data: { items: data ?? [] },
      }
    }
    case "get_returned_vendor_invoices": {
      let queryBuilder = admin
        .from("vendor_invoices")
        .select("id, vendor_id, billing_month, total, returned_at, rejected_reason, status")
        .eq("org_id", actor.orgId)
        .eq("status", "rejected")
        .order("updated_at", { ascending: false })
        .limit(20)
      if (actor.role === "vendor" && actor.vendorId) queryBuilder = queryBuilder.eq("vendor_id", actor.vendorId)
      const { data } = await queryBuilder
      return {
        tool,
        summary: (data ?? []).length > 0 ? `差し戻し中の外注請求は ${(data ?? []).length} 件です。` : "差し戻し中の外注請求はありません。",
        references: ["vendor_invoices"],
        data: { items: data ?? [] },
      }
    }
    case "get_payout_summary": {
      let queryBuilder = admin
        .from("payouts")
        .select("id, vendor_id, amount, status, pay_date")
        .eq("org_id", actor.orgId)
        .order("pay_date", { ascending: true })
        .limit(20)
      if (actor.role === "vendor" && actor.vendorId) queryBuilder = queryBuilder.eq("vendor_id", actor.vendorId)
      const { data } = await queryBuilder
      const rows = (data ?? []) as Array<{ amount?: number | null }>
      const total = rows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0)
      return {
        tool,
        summary: `支払い予定は ${rows.length} 件、合計 ${total.toLocaleString("ja-JP")} 円です。`,
        references: ["payouts"],
        data: { total_count: rows.length, total_amount: total, items: data ?? [] },
      }
    }
    case "get_upcoming_payouts": {
      const limitDate = new Date()
      limitDate.setDate(limitDate.getDate() + 7)
      const end = limitDate.toISOString().slice(0, 10)
      let queryBuilder = admin
        .from("payouts")
        .select("id, vendor_id, amount, status, pay_date")
        .eq("org_id", actor.orgId)
        .lte("pay_date", end)
        .order("pay_date", { ascending: true })
        .limit(20)
      if (actor.role === "vendor" && actor.vendorId) queryBuilder = queryBuilder.eq("vendor_id", actor.vendorId)
      const { data } = await queryBuilder
      return {
        tool,
        summary: (data ?? []).length > 0 ? `今週の支払い予定は ${(data ?? []).length} 件です。` : "今週の支払い予定はありません。",
        references: ["payouts"],
        data: { items: data ?? [] },
      }
    }
    case "search_pages_manuals":
    case "search_pages": {
      const keyword = extractTopic(query)
      const { data } = await admin
        .from("pages")
        .select("id, title, body_text, updated_at")
        .eq("org_id", actor.orgId)
        .eq("is_archived", false)
        .or(`title.ilike.%${keyword}%,body_text.ilike.%${keyword}%`)
        .order("updated_at", { ascending: false })
        .limit(8)
      const rows = ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
        id: row.id,
        title: row.title,
        excerpt: String(row.body_text ?? "").slice(0, 180),
        updated_at: row.updated_at,
      }))
      return {
        tool,
        summary: rows.length > 0 ? `Pages から ${rows.length} 件見つかりました。` : "Pages では該当ページが見つかりませんでした。",
        references: ["pages"],
        data: { items: rows },
      }
    }
    case "get_page_summary": {
      const keyword = entityId ?? extractTopic(query)
      let pageQuery = admin.from("pages").select("id, title, body_text, updated_at").eq("org_id", actor.orgId).eq("is_archived", false)
      if (entityId) pageQuery = pageQuery.eq("id", entityId)
      else pageQuery = pageQuery.or(`title.ilike.%${keyword}%,body_text.ilike.%${keyword}%`)
      const { data } = await pageQuery.limit(1).maybeSingle()
      const row = (data as Record<string, unknown> | null) ?? null
      return {
        tool,
        summary: row ? `${String(row.title ?? "ページ")} の概要です。` : "該当ページは見つかりませんでした。",
        references: ["pages"],
        data: {
          item: row
            ? {
                id: row.id,
                title: row.title,
                summary: String(row.body_text ?? "").slice(0, 400),
                updated_at: row.updated_at,
              }
            : null,
        },
      }
    }
    case "get_help_answer_candidates":
    case "get_manual_steps_for_topic": {
      const topic = extractTopic(query)
      const helpMatches = HELP_FALLBACKS.filter((item) => topic.includes(item.topic) || item.topic.includes(topic))
      return {
        tool,
        summary: helpMatches.length > 0 ? `${helpMatches.length} 件の手順候補があります。` : "固定ヘルプ候補は見つかりませんでした。",
        references: ["help_fallbacks"],
        data: { topic, items: helpMatches },
      }
    }
  }
}
