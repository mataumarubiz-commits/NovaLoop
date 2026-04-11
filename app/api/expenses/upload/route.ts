import { NextRequest, NextResponse } from "next/server"
import { requireFinanceContext } from "@/lib/financeApi"
import { writeAuditLog } from "@/lib/auditLog"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function safeName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "receipt"
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData()
    const orgId = typeof form.get("orgId") === "string" ? String(form.get("orgId")) : null
    const auth = await requireFinanceContext(req, orgId)
    if (!auth.ok) return auth.response

    const expenseId = typeof form.get("expenseId") === "string" ? String(form.get("expenseId")).trim() : ""
    if (!expenseId) return NextResponse.json({ ok: false, error: "expenseId is required" }, { status: 400 })

    const directPath = typeof form.get("receiptPath") === "string" ? String(form.get("receiptPath")).trim() : ""
    const file = form.get("file")
    let receiptPath = directPath
    if (file instanceof File && file.size > 0) {
      const path = `${auth.orgId}/expenses/${expenseId}/${Date.now()}-${safeName(file.name)}`
      const { error: uploadError } = await auth.admin.storage
        .from("project-assets")
        .upload(path, Buffer.from(await file.arrayBuffer()), {
          contentType: file.type || "application/octet-stream",
          upsert: true,
        })
      if (uploadError) throw new Error(uploadError.message)
      receiptPath = path
    }

    if (!receiptPath) return NextResponse.json({ ok: false, error: "file or receiptPath is required" }, { status: 400 })

    const { data, error } = await auth.admin
      .from("expenses")
      .update({
        receipt_path: receiptPath,
        receipt_collection_status: "received",
      })
      .eq("org_id", auth.orgId)
      .eq("id", expenseId)
      .select("*")
      .maybeSingle()
    if (error) throw new Error(error.message)

    await writeAuditLog(auth.admin, {
      org_id: auth.orgId,
      user_id: auth.userId,
      action: "expense.receipt_upload",
      resource_type: "expense_receipt",
      resource_id: expenseId,
      meta: { receipt_path: receiptPath },
    })
    return NextResponse.json({ ok: true, receiptPath, expense: data })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "failed to upload receipt" },
      { status: 500 }
    )
  }
}
