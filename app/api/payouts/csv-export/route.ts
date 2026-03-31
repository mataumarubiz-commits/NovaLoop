import iconv from "iconv-lite"
import { NextRequest, NextResponse } from "next/server"
import { requireOrgAdmin } from "@/lib/adminApi"
import { writeAuditLog } from "@/lib/auditLog"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type ExportMode = "preview" | "export"
type PayoutCsvFormat = "zengin_simple" | "custom_basic" | "freee_vendor" | "zengin_standard"

type PreviewRow = {
  invoiceId: string
  vendorName: string
  payDate: string
  amount: number
  bankName: string
  branchName: string
  bankCode: string
  branchCode: string
  accountType: string
  accountNumber: string
  accountHolderKana: string
  status: string
  warning: string | null
}

function isExportMode(value: unknown): value is ExportMode {
  return value === "preview" || value === "export"
}

function csvEscape(value: string) {
  return `"${value.replace(/"/g, '""')}"`
}

function safeDigits(value: string, length: number) {
  const digits = value.replace(/\D/g, "")
  return digits.slice(0, length)
}

function extractCode(value: string, length: number) {
  const direct = safeDigits(value, length)
  if (direct.length === length) return direct
  const matched = value.match(new RegExp(`\\b(\\d{${length}})\\b`))
  return matched?.[1] ?? ""
}

function normalizeAccountType(value: string) {
  const normalized = value.trim().toLowerCase()
  if (normalized === "ordinary" || normalized === "普通") return { label: "普通", zengin: "1" }
  if (normalized === "checking" || normalized === "当座") return { label: "当座", zengin: "2" }
  if (normalized === "savings" || normalized === "貯蓄") return { label: "貯蓄", zengin: "4" }
  return { label: value.trim() || "普通", zengin: "1" }
}

function padShiftJis(value: string, bytes: number, align: "left" | "right" = "left", pad = " ") {
  const source = value || ""
  let encoded = iconv.encode(source, "Shift_JIS")
  while (encoded.length > bytes) {
    encoded = iconv.encode(source.slice(0, Math.max(0, source.length - 1)), "Shift_JIS")
  }
  const filler = iconv.encode(pad.repeat(Math.max(0, bytes - encoded.length)), "Shift_JIS")
  return align === "right" ? Buffer.concat([filler, encoded]) : Buffer.concat([encoded, filler])
}

function buildSimpleCsv(rows: PreviewRow[], depositorCode: string) {
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
  const dataRows = rows.map((row) =>
    [
      row.payDate,
      row.vendorName,
      String(row.amount),
      row.bankName,
      row.branchName,
      row.accountType,
      row.accountNumber,
      row.accountHolderKana,
      depositorCode,
    ]
      .map(csvEscape)
      .join(",")
  )

  return {
    buffer: Buffer.from(["\uFEFF" + header.join(","), ...dataRows].join("\r\n"), "utf-8"),
    fileName: "payouts.csv",
    encoding: "utf8_bom",
    notes: [
      "UTF-8 BOM / CRLF です。",
      "銀行への直接取込前に、委託者コードと口座名義カナを確認してください。",
    ],
  }
}

function buildFreeeVendorCsv(rows: PreviewRow[], notes: string) {
  const header = [
    "支払先",
    "対象月",
    "支払日",
    "支払金額",
    "ステータス",
    "銀行名",
    "支店名",
    "預金種別",
    "口座番号",
    "口座名義カナ",
    "メモ",
  ]

  const dataRows = rows.map((row) =>
    [
      row.vendorName,
      row.payDate.slice(0, 7),
      row.payDate,
      String(row.amount),
      row.status,
      row.bankName,
      row.branchName,
      row.accountType,
      row.accountNumber,
      row.accountHolderKana,
      notes,
    ]
      .map(csvEscape)
      .join(",")
  )

  return {
    buffer: Buffer.from(["\uFEFF" + header.join(","), ...dataRows].join("\r\n"), "utf-8"),
    fileName: "payouts_freee.csv",
    encoding: "utf8_bom",
    notes: [
      "freee 支払インポート向けの列順で出力します。",
      "文字コードは UTF-8 BOM / CRLF です。",
    ],
  }
}

function buildZenginStandard(rows: PreviewRow[], companyNameKana: string, depositorCode: string) {
  const transferDate = rows[0]?.payDate ? rows[0].payDate.slice(5).replace("-", "") : "0000"
  const header = Buffer.concat([
    Buffer.from("1"),
    Buffer.from("21"),
    padShiftJis(safeDigits(depositorCode, 10), 10, "right", "0"),
    padShiftJis(companyNameKana || "ﾅﾊﾞﾙｰﾌﾟ", 40),
    Buffer.from(transferDate.padStart(4, "0")),
    padShiftJis("", 63),
  ])

  const detailRows = rows.map((row) =>
    Buffer.concat([
      Buffer.from("2"),
      padShiftJis(row.bankCode || "0000", 4, "right", "0"),
      padShiftJis(row.bankName, 15),
      padShiftJis(row.branchCode || "000", 3, "right", "0"),
      padShiftJis(row.branchName, 15),
      padShiftJis("", 4),
      Buffer.from(normalizeAccountType(row.accountType).zengin),
      padShiftJis(safeDigits(row.accountNumber, 7), 7, "right", "0"),
      padShiftJis(row.accountHolderKana || row.vendorName, 30),
      padShiftJis(String(Math.round(row.amount)), 10, "right", "0"),
      Buffer.from("0"),
      padShiftJis("", 10),
      padShiftJis(companyNameKana || "ﾅﾊﾞﾙｰﾌﾟ", 30),
      padShiftJis("", 11),
    ])
  )

  const totalAmount = rows.reduce((sum, row) => sum + Math.round(row.amount), 0)
  const trailer = Buffer.concat([
    Buffer.from("8"),
    padShiftJis(String(rows.length), 6, "right", "0"),
    padShiftJis(String(totalAmount), 12, "right", "0"),
    padShiftJis("", 101),
  ])
  const end = Buffer.concat([Buffer.from("9"), padShiftJis("", 119)])

  return {
    buffer: Buffer.concat([header, ...detailRows, trailer, end].flatMap((row) => [row, Buffer.from("\r\n")])),
    fileName: "payouts_zengin.txt",
    encoding: "shift_jis_fixed",
    notes: [
      "Shift_JIS / CRLF の固定長ファイルです。",
      "銀行コード・支店コードは名称中の数字を優先して抽出し、見つからない場合は 0000 / 000 を補完します。",
    ],
  }
}

function buildExportFile(format: PayoutCsvFormat, rows: PreviewRow[], settings: Record<string, string | null>) {
  if (format === "freee_vendor") {
    return buildFreeeVendorCsv(rows, String(settings.payout_csv_notes ?? ""))
  }
  if (format === "zengin_standard") {
    return buildZenginStandard(
      rows,
      String(settings.payout_csv_company_name_kana ?? ""),
      String(settings.payout_csv_depositor_code ?? "")
    )
  }
  return buildSimpleCsv(rows, String(settings.payout_csv_depositor_code ?? ""))
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
      admin
        .from("org_settings")
        .select("payout_csv_format, payout_csv_encoding, payout_csv_delimiter, payout_csv_depositor_code, payout_csv_company_name_kana, payout_csv_notes")
        .eq("org_id", auth.orgId)
        .maybeSingle(),
    ])

    if (invoiceError) return NextResponse.json({ ok: false, error: invoiceError.message }, { status: 500 })
    if (settingsError) return NextResponse.json({ ok: false, error: settingsError.message }, { status: 500 })

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

    if (vendorError) return NextResponse.json({ ok: false, error: vendorError.message }, { status: 500 })

    const vendorMap = new Map(
      ((vendorRows ?? []) as Array<Record<string, string | null>>).map((vendor) => [String(vendor.id), vendor])
    )
    const settings = (settingsRow ?? {}) as Record<string, string | null>
    const format = (settings.payout_csv_format ?? "zengin_simple") as PayoutCsvFormat

    const previewRows: PreviewRow[] = invoices.map((invoice) => {
      const vendor = vendorMap.get(invoice.vendor_id)
      const bankName = String(vendor?.bank_name ?? "")
      const branchName = String(vendor?.bank_branch ?? "")
      const accountType = normalizeAccountType(String(vendor?.bank_account_type ?? "")).label
      const accountHolderKana = String(vendor?.bank_account_holder_kana ?? vendor?.bank_account_holder ?? "")
      const bankCode = extractCode(bankName, 4)
      const branchCode = extractCode(branchName, 3)

      const missingBankFields = [
        !bankName && "銀行名",
        !branchName && "支店名",
        !accountType && "口座種別",
        !vendor?.bank_account_number && "口座番号",
        !accountHolderKana && "口座名義カナ",
        format === "zengin_standard" && !bankCode && "銀行コード",
        format === "zengin_standard" && !branchCode && "支店コード",
      ].filter(Boolean) as string[]

      return {
        invoiceId: invoice.id,
        vendorName: String(vendor?.name ?? ""),
        payDate: invoice.pay_date,
        amount: Number(invoice.total ?? 0),
        bankName,
        branchName,
        bankCode,
        branchCode,
        accountType,
        accountNumber: String(vendor?.bank_account_number ?? ""),
        accountHolderKana,
        status: invoice.status,
        warning: missingBankFields.length > 0 ? `未設定: ${missingBankFields.join(" / ")}` : null,
      }
    })

    const exportFile = buildExportFile(format, previewRows, settings)
    const fileNameBase = exportMonth || new Date().toISOString().slice(0, 7)
    const fileName = exportFile.fileName.replace("payouts", `payouts_${fileNameBase}`)

    if (mode === "preview") {
      return NextResponse.json({
        ok: true,
        settings: {
          payout_csv_format: format,
          payout_csv_encoding: exportFile.encoding,
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
        notes: exportFile.notes,
      })
    }

    const totalAmount = previewRows.reduce((sum, row) => sum + row.amount, 0)
    const { data: exportRow, error: exportError } = await admin
      .from("payout_csv_exports")
      .insert({
        org_id: auth.orgId,
        export_month: fileNameBase,
        format,
        encoding: exportFile.encoding,
        file_name: fileName,
        line_count: previewRows.length,
        total_amount: totalAmount,
        preview_json: previewRows,
        created_by: userId,
      })
      .select("id")
      .maybeSingle()

    if (exportError) return NextResponse.json({ ok: false, error: exportError.message }, { status: 500 })

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
        format,
      },
    })

    return NextResponse.json({
      ok: true,
      exportId: (exportRow as { id?: string } | null)?.id ?? null,
      fileName,
      contentBase64: exportFile.buffer.toString("base64"),
      encoding: exportFile.encoding,
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

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, exports: data ?? [] })
}
