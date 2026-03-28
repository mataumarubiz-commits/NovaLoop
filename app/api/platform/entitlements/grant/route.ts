import { NextRequest, NextResponse } from "next/server"
import { requirePlatformAdmin } from "@/lib/platformAuth"
import { writePlatformAudit } from "@/lib/platformServer"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const auth = await requirePlatformAdmin(req)
  if ("error" in auth) return auth.error

  try {
    const body = await req.json().catch(() => ({}))
    const targetUserId = typeof body?.target_user_id === "string" ? body.target_user_id.trim() : ""
    const grantType = typeof body?.grant_type === "string" ? body.grant_type.trim() : ""
    const note = typeof body?.note === "string" ? body.note.trim() : ""

    if (!targetUserId) {
      return NextResponse.json({ ok: false, error: "target_user_id is required" }, { status: 400 })
    }
    if (grantType !== "manual_test" && grantType !== "manual_grant") {
      return NextResponse.json({ ok: false, error: "grant_type must be manual_test or manual_grant" }, { status: 400 })
    }

    const rpc = await auth.admin.rpc("grant_creator_entitlement_admin", {
      p_target_user_id: targetUserId,
      p_grant_type: grantType,
      p_note: note || null,
    })

    if (rpc.error || !Array.isArray(rpc.data) || rpc.data.length === 0) {
      return NextResponse.json(
        { ok: false, error: rpc.error?.message ?? "failed to grant entitlement" },
        { status: 500 }
      )
    }

    const row = rpc.data[0] as {
      entitlement_id: string
      user_id: string
      status: string
      grant_type: string
      reused_existing: boolean
    }

    await writePlatformAudit({
      userId: auth.user.id,
      action: "platform.entitlement.grant",
      resourceType: "creator_entitlement",
      resourceId: row.entitlement_id,
      meta: {
        target_user_id: row.user_id,
        grant_type: row.grant_type,
        reused_existing: row.reused_existing,
        note,
      },
    })

    return NextResponse.json({ ok: true, entitlement: row })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "failed to grant entitlement" },
      { status: 500 }
    )
  }
}
