import { NextRequest, NextResponse } from "next/server"
import { requireFinanceContext } from "@/lib/financeApi"
import { connectFreee } from "@/lib/freeeIntegration"
import { writeAuditLog } from "@/lib/auditLog"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const auth = await requireFinanceContext(req, typeof body?.orgId === "string" ? body.orgId : null)
    if (!auth.ok) return auth.response
    const code = typeof body?.code === "string" ? body.code.trim() : ""
    if (!code) return NextResponse.json({ ok: false, error: "code is required" }, { status: 400 })

    const result = await connectFreee({
      admin: auth.admin,
      orgId: auth.orgId,
      userId: auth.userId,
      code,
      companyId: typeof body?.companyId === "string" ? body.companyId : null,
    })
    await writeAuditLog(auth.admin, {
      org_id: auth.orgId,
      user_id: auth.userId,
      action: "freee.connect",
      resource_type: "org_freee_connection",
      resource_id: auth.orgId,
      meta: { status: result.status },
    })
    return NextResponse.json(result, { status: result.ok ? 200 : 409 })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "failed to connect freee" },
      { status: 500 }
    )
  }
}
