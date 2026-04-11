import { NextRequest, NextResponse } from "next/server"
import { requireFinanceContext } from "@/lib/financeApi"
import { writeAuditLog } from "@/lib/auditLog"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function str(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const auth = await requireFinanceContext(req, str(body?.orgId))
    if (!auth.ok) return auth.response
    const expenseId = str(body?.expenseId ?? body?.expense_id)
    if (!expenseId) return NextResponse.json({ ok: false, error: "expenseId is required" }, { status: 400 })

    const projectId = str(body?.projectId ?? body?.project_id)
    const contentId = str(body?.contentId ?? body?.content_id)
    let projectName: string | null = null
    let clientId: string | null = null
    if (projectId) {
      const { data: project } = await auth.admin
        .from("projects")
        .select("name, client_id")
        .eq("org_id", auth.orgId)
        .eq("id", projectId)
        .maybeSingle()
      projectName = (project as { name?: string } | null)?.name ?? null
      clientId = (project as { client_id?: string } | null)?.client_id ?? null
    }

    const { data, error } = await auth.admin
      .from("expenses")
      .update({
        project_id: projectId,
        content_id: contentId,
        project_name: projectName,
        client_id: clientId,
        status: "linked",
      })
      .eq("org_id", auth.orgId)
      .eq("id", expenseId)
      .select("*")
      .maybeSingle()
    if (error) throw new Error(error.message)

    await writeAuditLog(auth.admin, {
      org_id: auth.orgId,
      user_id: auth.userId,
      action: "expense.link",
      resource_type: "expense",
      resource_id: expenseId,
      meta: { project_id: projectId, content_id: contentId },
    })
    return NextResponse.json({ ok: true, expense: data })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "failed to link expense" },
      { status: 500 }
    )
  }
}
