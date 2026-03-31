import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { getOrgRole, getUserIdFromToken, isOrgAdmin } from "@/lib/apiAuth"
import { queueExportJob } from "@/lib/exportJobs"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserIdFromToken(req)
    if (!userId) {
      return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 })
    }

    const body = (await req.json().catch(() => ({}))) as { orgId?: string }
    const orgId = typeof body.orgId === "string" ? body.orgId.trim() : ""
    if (!orgId) {
      return NextResponse.json({ ok: false, message: "orgId is required" }, { status: 400 })
    }

    const admin = createSupabaseAdmin()
    const role = await getOrgRole(admin, userId, orgId)
    if (!isOrgAdmin(role)) {
      return NextResponse.json({ ok: false, message: "Forbidden" }, { status: 403 })
    }

    const queued = await queueExportJob({
      admin,
      orgId,
      userId,
      triggerSource: "manual",
    })

    return NextResponse.json({ ok: true, jobId: queued.id, queuedAt: queued.created_at }, { status: 202 })
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Failed to queue export job" },
      { status: 500 }
    )
  }
}
