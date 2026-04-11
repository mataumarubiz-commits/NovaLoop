import { NextRequest, NextResponse } from "next/server"
import { requireFinanceContext } from "@/lib/financeApi"
import { writeAuditLog } from "@/lib/auditLog"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function dateToMonth(value: string | null) {
  return value?.slice(0, 7) ?? null
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const auth = await requireFinanceContext(req, typeof body?.orgId === "string" ? body.orgId : null)
    if (!auth.ok) return auth.response

    const amount = Number(body?.amount ?? 0)
    const occurredOn = asString(body?.occurredOn ?? body?.occurred_on)
    const targetMonth = asString(body?.targetMonth ?? body?.target_month) ?? dateToMonth(occurredOn)
    const description = asString(body?.description)
    if (!description || !occurredOn || !targetMonth || !Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json(
        { ok: false, error: "description, occurredOn, targetMonth, and positive amount are required" },
        { status: 400 }
      )
    }

    const projectId = asString(body?.projectId ?? body?.project_id)
    let projectName = asString(body?.projectName ?? body?.project_name)
    let clientId = asString(body?.clientId ?? body?.client_id)
    if (projectId && (!projectName || !clientId)) {
      const { data: project } = await auth.admin
        .from("projects")
        .select("name, client_id")
        .eq("org_id", auth.orgId)
        .eq("id", projectId)
        .maybeSingle()
      projectName = projectName ?? (project as { name?: string } | null)?.name ?? null
      clientId = clientId ?? (project as { client_id?: string } | null)?.client_id ?? null
    }

    const id = crypto.randomUUID()
    const { data, error } = await auth.admin
      .from("expenses")
      .insert({
        id,
        org_id: auth.orgId,
        project_id: projectId,
        content_id: asString(body?.contentId ?? body?.content_id),
        client_id: clientId,
        project_name: projectName,
        category: asString(body?.category) ?? "other",
        description,
        amount,
        occurred_on: occurredOn,
        expense_date: occurredOn,
        target_month: targetMonth,
        receipt_path: asString(body?.receiptPath ?? body?.receipt_path),
        payee_name: asString(body?.payeeName ?? body?.payee_name),
        memo: asString(body?.memo),
        is_reimbursable: Boolean(body?.isReimbursable ?? body?.is_reimbursable),
        currency: asString(body?.currency) ?? "JPY",
        status: asString(body?.status) ?? "draft",
        source_type: asString(body?.sourceType ?? body?.source_type) ?? "manual",
        receipt_collection_status: asString(body?.receiptCollectionStatus ?? body?.receipt_collection_status) ?? "not_needed",
        created_by_user_id: auth.userId,
      })
      .select("*")
      .maybeSingle()

    if (error) throw new Error(error.message)
    await writeAuditLog(auth.admin, {
      org_id: auth.orgId,
      user_id: auth.userId,
      action: "expense.create",
      resource_type: "expense",
      resource_id: id,
      meta: { target_month: targetMonth, amount },
    })
    return NextResponse.json({ ok: true, expense: data })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "failed to create expense" },
      { status: 500 }
    )
  }
}
