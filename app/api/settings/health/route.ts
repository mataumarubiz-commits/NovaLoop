import { NextRequest, NextResponse } from "next/server"
import { requireAdminContext } from "@/lib/adminApi"
import { writeAuditLog } from "@/lib/auditLog"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type CheckStatus = "ok" | "warning" | "error"

type HealthCheck = {
  id: string
  label: string
  status: CheckStatus
  detail: string
}

async function countByOrg(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  table: string,
  orgId: string,
  orgColumn = "org_id"
) {
  const { count, error } = await admin
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq(orgColumn, orgId)
  if (error) {
    return { status: "error" as const, detail: error.message }
  }
  return { status: "ok" as const, detail: `${count ?? 0} 件` }
}

export async function GET(req: NextRequest) {
  const auth = await requireAdminContext(req)
  if ("error" in auth) return auth.error
  const { admin, userId, orgId, role } = auth

  const checks: HealthCheck[] = []

  checks.push({
    id: "auth",
    label: "Auth / Session",
    status: "ok",
    detail: `user_id=${userId}, role=${role}`,
  })

  const { data: orgRow, error: orgError } = await admin
    .from("organizations")
    .select("id, name")
    .eq("id", orgId)
    .maybeSingle()
  checks.push({
    id: "org",
    label: "Current org",
    status: orgError || !orgRow ? "error" : "ok",
    detail: orgError?.message ?? (orgRow ? `${(orgRow as { name?: string }).name ?? "名称未設定"}` : "組織が見つかりません"),
  })

  const tables: Array<{ id: string; label: string; table: string; orgColumn?: string }> = [
    { id: "app_users", label: "app_users", table: "app_users" },
    { id: "clients", label: "clients", table: "clients" },
    { id: "contents", label: "contents", table: "contents" },
    { id: "invoices", label: "invoices", table: "invoices" },
    { id: "vendor_invoices", label: "vendor_invoices", table: "vendor_invoices" },
    { id: "payouts", label: "payouts", table: "payouts" },
    { id: "pages", label: "pages", table: "pages" },
    { id: "notifications", label: "notifications", table: "notifications", orgColumn: "org_id" },
    { id: "export_jobs", label: "export_jobs", table: "export_jobs" },
    { id: "import_jobs", label: "import_jobs", table: "import_jobs" },
  ]

  for (const table of tables) {
    const result = await countByOrg(admin, table.table, orgId, table.orgColumn)
    checks.push({
      id: table.id,
      label: table.label,
      status: result.status,
      detail: result.detail,
    })
  }

  const { data: assetFolders, error: assetError } = await admin.storage.from("page-assets").list(`${orgId}/pages`, { limit: 100 })
  checks.push({
    id: "storage_assets",
    label: "Storage / page-assets",
    status: assetError ? "error" : "ok",
    detail: assetError?.message ?? `${(assetFolders ?? []).length} 件のフォルダを確認`,
  })

  const { data: invoicePdf, error: invoicePdfError } = await admin
    .from("invoices")
    .select("id, pdf_path")
    .eq("org_id", orgId)
    .not("pdf_path", "is", null)
    .limit(1)
    .maybeSingle()

  if (invoicePdfError) {
    checks.push({
      id: "storage_invoice_pdf",
      label: "Storage / invoice PDF",
      status: "error",
      detail: invoicePdfError.message,
    })
  } else if (!invoicePdf) {
    checks.push({
      id: "storage_invoice_pdf",
      label: "Storage / invoice PDF",
      status: "warning",
      detail: "pdf_path 付きの請求書がまだありません",
    })
  } else {
    const signed = await admin.storage.from("invoices").createSignedUrl((invoicePdf as { pdf_path: string }).pdf_path, 60)
    checks.push({
      id: "storage_invoice_pdf",
      label: "Storage / invoice PDF",
      status: signed.error ? "error" : "ok",
      detail: signed.error?.message ?? "署名 URL の発行に成功",
    })
  }

  const summary = {
    ok: checks.filter((item) => item.status === "ok").length,
    warning: checks.filter((item) => item.status === "warning").length,
    error: checks.filter((item) => item.status === "error").length,
  }

  await writeAuditLog(admin, {
    org_id: orgId,
    user_id: userId,
    action: "asset.verify",
    resource_type: "health",
    resource_id: null,
    meta: {
      summary,
    },
  })

  return NextResponse.json({ ok: true, summary, checks })
}
