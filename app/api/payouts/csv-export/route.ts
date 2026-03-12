import { NextRequest, NextResponse } from "next/server"
import { requireOrgAdmin } from "@/lib/adminApi"
import { writeAuditLog } from "@/lib/auditLog"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type ExportMode = "preview" | "export"

function isExportMode(value: unknown): value is ExportMode {
  return value === "preview" || value === "export"
}

function csvEscape(value: string) {
  return `"${value.replace(/"/g, '""')}"`
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const orgId = typeof body?.orgId === "string" ? body.orgId.trim() : null
    const auth = await requireOrgAdmin(req, orgId)
    if (!auth.ok) return auth.response

    const invoiceIds = Array.isArray(body?.invoiceIds)
      ? body.invoiceIds.filter((value: unknown): value is string => typeof value === "string" && value.trim().length > 0)
      : []
    const mode = isExportMode(body?.mode) ? body.mode : "preview"
    const exportMonth = typeof body?.exportMonth === "string" ? body.exportMonth.trim() : ""

    if (invoiceIds.length === 0) {
      return NextResponse.json({ ok: false, error: "invoiceIds is required" }, { status: 400 })
    }

    const { admin, userId } = auth
    const [{ data: invoiceRows, error: invoiceError }, { data: settingsRow, error: settingsError }] = await Promise.all([
      admin
        .from("vendor_invoices")
        .select("id, vendor_id, billing_month, pay_date, total, status")
        .eq("org_id", auth.orgId)
        .in("id", invoiceIds),
      admin.from("org_settings").select("payout_csv_format, payout_csv_encoding, payout_csv_delimiter, payout_csv_depositor_code, payout_csv_company_name_kana, payout_csv_notes").eq("org_id", auth.orgId).maybeSingle(),
    ])

    if (invoiceError) {
      return NextResponse.json({ ok: false, error: invoiceError.message }, { status: 500 })
    }
    if (settingsError) {
      return NextResponse.json({ ok: false, error: settingsError.message }, { status: 500 })
    }

    const invoices = (invoiceRows ?? []) as Array<{
      id: string
      vendor_id: string
      billing_month: string
      pay_date: string
      total: number
      status: string
    }>

    const vendorIds = Array.from(new Set(invoices.map((invoice) => invoice.vendor_id)))
    const { data: vendorRows, error: vendorError } = await admin
      .from("vendors")
      .select("id, name, bank_name, bank_branch, bank_account_type, bank_account_number, bank_account_holder, bank_account_holder_kana")
      .eq("org_id", auth.orgId)
      .in("id", vendorIds)

    if (vendorError) {
      return NextResponse.json({ ok: false, error: vendorError.message }, { status: 500 })
    }

    const vendorMap = new Map(
      ((vendorRows ?? []) as Array<Record<string, string | null>>).map((vendor) => [String(vendor.id), vendor])
    )
    const settings = (settingsRow ?? {}) as Record<string, string | null>

    const previewRows = invoices.map((invoice) => {
      const vendor = vendorMap.get(invoice.vendor_id)
      const missingBankFields = [
        !vendor?.bank_name && "銀行名",
        !vendor?.bank_branch && "支店名",
        !vendor?.bank_account_type && "口座種別",
        !vendor?.bank_account_number && "口座番号",
        !(vendor?.bank_account_holder_kana || vendor?.bank_account_holder) && "口座名義",
      ].filter(Boolean) as string[]

      return {
        invoiceId: invoice.id,
        vendorName: String(vendor?.name ?? ""),
        payDate: invoice.pay_date,
        amount: Number(invoice.total ?? 0),
        bankName: String(vendor?.bank_name ?? ""),
        branchName: String(vendor?.bank_branch ?? ""),
        accountType: String(vendor?.bank_account_type ?? ""),
        accountNumber: String(vendor?.bank_account_number ?? ""),
        accountHolderKana: String(vendor?.bank_account_holder_kana ?? vendor?.bank_account_holder ?? ""),
        status: invoice.status,
        warning: missingBankFields.length > 0 ? `未設定: ${missingBankFields.join(" / ")}` : null,
      }
    })

    const header = [
      "支払日",
      "外注名",
      "金額",
      "銀行名",
      "支店名",
      "口座種別",
      "口座番号",
      "口座名義カナ",
      "委託者コード",
    ]

    const csvRows = previewRows.map((row) =>
      [
        row.payDate,
        row.vendorName,
        String(row.amount),
        row.bankName,
        row.branchName,
        row.accountType,
        row.accountNumber,
        row.accountHolderKana,
        String(settings.payout_csv_depositor_code ?? ""),
      ]
        .map(csvEscape)
        .join(",")
    )

    const csv = ["\uFEFF" + header.join(","), ...csvRows].join("\r\n")
    const fileName = `payouts_${exportMonth || new Date().toISOString().slice(0, 7)}.csv`

    if (mode === "preview") {
      return NextResponse.json({
        ok: true,
        settings: {
          payout_csv_format: settings.payout_csv_format ?? "zengin_simple",
          payout_csv_encoding: settings.payout_csv_encoding ?? "utf8_bom",
          payout_csv_delimiter: settings.payout_csv_delimiter ?? "comma",
          payout_csv_depositor_code: settings.payout_csv_depositor_code ?? "",
          payout_csv_company_name_kana: settings.payout_csv_company_name_kana ?? "",
          payout_csv_notes: settings.payout_csv_notes ?? "",
        },
        rows: previewRows,
        fileName,
        summary: {
          count: previewRows.length,
          totalAmount: previewRows.reduce((sum, row) => sum + row.amount, 0),
          warningCount: previewRows.filter((row) => row.warning).length,
        },
        notes: [
          "このローカル版のCSV出力は UTF-8 BOM / CRLF です。",
          "総合振込の本番運用前に、金融機関の取込仕様に合わせて確認してください。",
          "委託者コードと口座名義カナは Workspace 設定で管理します。",
        ],
      })
    }

    const totalAmount = previewRows.reduce((sum, row) => sum + row.amount, 0)
    const { data: exportRow, error: exportError } = await admin
      .from("payout_csv_exports")
      .insert({
        org_id: auth.orgId,
        export_month: exportMonth || new Date().toISOString().slice(0, 7),
        format: settings.payout_csv_format ?? "zengin_simple",
        encoding: settings.payout_csv_encoding ?? "utf8_bom",
        file_name: fileName,
        line_count: previewRows.length,
        total_amount: totalAmount,
        preview_json: previewRows,
        created_by: userId,
      })
      .select("id")
      .maybeSingle()

    if (exportError) {
      return NextResponse.json({ ok: false, error: exportError.message }, { status: 500 })
    }

    await writeAuditLog(admin, {
      org_id: auth.orgId,
      user_id: userId,
      action: "payout.csv_export",
      resource_type: "payout_csv_export",
      resource_id: (exportRow as { id?: string } | null)?.id ?? null,
      meta: {
        invoice_ids: invoiceIds,
        export_month: exportMonth || null,
        file_name: fileName,
        line_count: previewRows.length,
        total_amount: totalAmount,
      },
    })

    return NextResponse.json({
      ok: true,
      exportId: (exportRow as { id?: string } | null)?.id ?? null,
      fileName,
      csv,
      lineCount: previewRows.length,
      totalAmount,
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Server error" },
      { status: 500 }
    )
  }
}

export async function GET(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get("orgId")
  const auth = await requireOrgAdmin(req, orgId)
  if (!auth.ok) return auth.response

  const { admin } = auth
  const { data, error } = await admin
    .from("payout_csv_exports")
    .select("id, export_month, format, encoding, file_name, line_count, total_amount, created_at")
    .eq("org_id", auth.orgId)
    .order("created_at", { ascending: false })
    .limit(20)

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, exports: data ?? [] })
}
