import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { getUserIdFromToken, getOrgRole, isOrgAdmin } from "@/lib/apiAuth"
import { writeAuditLog } from "@/lib/auditLog"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function safeSelect<T>(
  admin: ReturnType<typeof createSupabaseAdmin>,
  table: string,
  columns: string,
  orgId: string,
  opts?: { whereOrgIdColumn?: string }
): Promise<T[] | null> {
  const orgColumn = opts?.whereOrgIdColumn ?? "org_id"
  try {
    const { data, error } = await admin.from(table).select(columns).eq(orgColumn, orgId)
    if (error) {
      if (error.code === "42P01" || error.message?.includes("does not exist")) return null
      throw error
    }
    return (data ?? []) as T[]
  } catch {
    // テーブルが存在しない場合などはスキップ
    return null
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserIdFromToken(req)
    if (!userId) {
      return NextResponse.json({ ok: false, message: "認証が必要です" }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const orgId = typeof body?.orgId === "string" ? body.orgId.trim() : null
    if (!orgId) {
      return NextResponse.json({ ok: false, message: "orgId は必須です" }, { status: 400 })
    }

    let admin
    try {
      admin = createSupabaseAdmin()
    } catch (e) {
      return NextResponse.json(
        { ok: false, message: e instanceof Error ? e.message : "エクスポート用のサーバー設定が不足しています" },
        { status: 500 }
      )
    }
    const callerRole = await getOrgRole(admin, userId, orgId)
    if (!isOrgAdmin(callerRole)) {
      return NextResponse.json({ ok: false, message: "権限がありません" }, { status: 403 })
    }

    // export_jobs を pending で作成
    const { data: jobRow, error: jobErr } = await admin
      .from("export_jobs")
      .insert({
        org_id: orgId,
        created_by: userId,
        status: "pending",
      })
      .select("id, created_at")
      .single()

    if (jobErr || !jobRow) {
      return NextResponse.json(
        { ok: false, message: jobErr?.message ?? "エクスポートジョブの作成に失敗しました" },
        { status: 500 }
      )
    }

    const jobId = (jobRow as { id: string }).id

    try {
      // organizations（1件）
      const orgs = await safeSelect<{ id: string }>(admin, "organizations", "id, name, created_at, updated_at", orgId, {
        whereOrgIdColumn: "id",
      })

      const appUsers = await safeSelect(admin, "app_users", "user_id, org_id, role, status, display_name, created_at", orgId)
      const orgRoles = await safeSelect(admin, "org_roles", "id, org_id, key, name, is_system, permissions, sort_order, created_at", orgId)
      const clients = await safeSelect(admin, "clients", "id, org_id, name, client_type, created_at", orgId)
      const contents = await safeSelect(
        admin,
        "contents",
        "id, org_id, client_id, project_name, title, unit_price, due_client_at, due_editor_at, status, thumbnail_done, billable_flag, delivery_month, editor_submitted_at, client_submitted_at, created_at",
        orgId
      )
      const contentTemplates = await safeSelect(
        admin,
        "content_templates",
        "id, org_id, client_id, name, default_project_name, default_title, default_unit_price, default_billable_flag, default_status, default_due_offset_days, sort_order, created_at",
        orgId
      )
      const contentAssignments = await safeSelect(
        admin,
        "content_assignments",
        "id, org_id, content_id, vendor_id, role, unit_price_override, created_at",
        orgId
      )
      const statusEvents = await safeSelect(
        admin,
        "status_events",
        "id, org_id, content_id, old_status, new_status, changed_by, created_at",
        orgId
      )
      const pages = await safeSelect(
        admin,
        "pages",
        "id, org_id, title, content, body_text, sort_order, is_archived, created_at, updated_at",
        orgId
      )
      const invoices = await safeSelect(
        admin,
        "invoices",
        "id, org_id, client_id, invoice_month, issue_date, due_date, status, subtotal, total, invoice_title, created_at, updated_at",
        orgId
      )
      const invoiceLines = await safeSelect(
        admin,
        "invoice_lines",
        "id, invoice_id, content_id, quantity, unit_price, amount, description, project_name, title, created_at",
        orgId,
        { whereOrgIdColumn: "org_id" }
      )
      const vendors = await safeSelect(
        admin,
        "vendors",
        "id, org_id, name, email, notes, is_active, created_at",
        orgId
      )
      const vendorUsers = await safeSelect(
        admin,
        "vendor_users",
        "id, org_id, vendor_id, user_id, created_at",
        orgId
      )
      const vendorInvoices = await safeSelect(
        admin,
        "vendor_invoices",
        "id, org_id, vendor_id, billing_month, status, submit_deadline, pay_date, total, pdf_path, submitted_at, created_at, updated_at",
        orgId
      )
      const vendorInvoiceLines = await safeSelect(
        admin,
        "vendor_invoice_lines",
        "id, vendor_invoice_id, content_id, work_type, description, qty, unit_price, amount, created_at",
        orgId,
        { whereOrgIdColumn: "org_id" }
      )

      let payouts = await safeSelect(
        admin,
        "payouts",
        "id, org_id, vendor_id, vendor_invoice_id, pay_date, amount, status, paid_at, created_at",
        orgId
      )
      const vendorList = (vendors ?? []) as Array<{ id: string; name: string }>
      const vendorById = new Map(vendorList.map((v) => [v.id, v]))
      if (!payouts && Array.isArray(vendorInvoices)) {
        payouts = (vendorInvoices as Array<{ id: string; vendor_id: string; pay_date: string; total: number; status: string }>).map(
          (vi) => ({
            vendor_id: vi.vendor_id,
            vendor_invoice_id: vi.id,
            pay_date: vi.pay_date,
            amount: vi.total,
            status: vi.status,
            vendor_name: vendorById.get(vi.vendor_id)?.name,
          })
        ) as unknown as typeof payouts
      } else if (Array.isArray(payouts)) {
        const payoutRows = payouts as Array<{ vendor_id: string; [k: string]: unknown }>
        payouts = payoutRows.map((p) => ({
          ...p,
          vendor_name: vendorById.get(p.vendor_id)?.name,
        })) as typeof payouts
      }

      // notifications: この org に所属するユーザー宛てのもの
      const { data: orgMembers } = await admin
        .from("app_users")
        .select("user_id")
        .eq("org_id", orgId)
      const memberIds = (orgMembers ?? []).map((r) => (r as { user_id: string }).user_id)
      let notifications: Record<string, unknown>[] | null = null
      if (memberIds.length > 0) {
        const { data, error } = await admin
          .from("notifications")
          .select("id, recipient_user_id, type, payload, read_at, created_at")
          .in("recipient_user_id", memberIds)
        if (!error) {
          notifications = data ?? []
        }
      }

      const auditLogs = await safeSelect(
        admin,
        "audit_logs",
        "id, org_id, user_id, action, resource_type, resource_id, meta, created_at",
        orgId
      )

      const clientList = (clients ?? []) as Array<{ id: string; name?: string }>
      const clientById = new Map(clientList.map((c) => [c.id, c]))
      const invoiceList = (invoices ?? []) as Array<{ client_id: string; [k: string]: unknown }>
      const invoicesWithClient = invoiceList.map((inv) => ({
        ...inv,
        client_name: clientById.get(inv.client_id)?.name,
      }))

      const exportData = {
        meta: {
          org_id: orgId,
          job_id: jobId,
          exported_at: new Date().toISOString(),
        },
        organizations: orgs,
        app_users: appUsers,
        org_roles: orgRoles,
        clients,
        contents,
        content_templates: contentTemplates,
        content_assignments: contentAssignments,
        status_events: statusEvents,
        pages,
        invoices: invoicesWithClient,
        invoice_lines: invoiceLines,
        vendors,
        vendor_users: vendorUsers,
        vendor_invoices: vendorInvoices,
        vendor_invoice_lines: vendorInvoiceLines,
        payouts: payouts ?? [],
        notifications,
        audit_logs: auditLogs,
      }

      const json = JSON.stringify(exportData, null, 2)
      const path = `org/${orgId}/exports/${jobId}.json`
      const { error: uploadErr } = await admin.storage
        .from("exports")
        .upload(path, Buffer.from(json, "utf-8"), {
          contentType: "application/json",
          upsert: true,
        })

      if (uploadErr) {
        throw uploadErr
      }

      await admin
        .from("export_jobs")
        .update({ status: "done", file_path: path })
        .eq("id", jobId)

      await writeAuditLog(admin, {
        org_id: orgId,
        user_id: userId,
        action: "export.run",
        resource_type: "export",
        resource_id: jobId,
        meta: {
          file_path: path,
          exported_tables: Object.keys(exportData),
        },
      })

      return NextResponse.json({ ok: true, jobId })
    } catch (e) {
      const message = e instanceof Error ? e.message : "エクスポートに失敗しました"
      await admin
        .from("export_jobs")
        .update({ status: "failed", error_message: message })
        .eq("id", jobId)
      return NextResponse.json({ ok: false, message, jobId }, { status: 500 })
    }
  } catch (e) {
    return NextResponse.json(
      { ok: false, message: e instanceof Error ? e.message : "エクスポートに失敗しました" },
      { status: 500 }
    )
  }
}

