import { NextRequest, NextResponse } from "next/server"
import { requirePlatformAdmin } from "@/lib/platformAuth"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { createPlatformNotification, writePlatformAudit } from "@/lib/platformServer"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePlatformAdmin(req)
  if ("error" in auth) return auth.error

  const { id } = await params
  const transferId = id?.trim()
  if (!transferId) {
    return NextResponse.json({ ok: false, error: "transfer id is required" }, { status: 400 })
  }

  try {
    const admin = createSupabaseAdmin()
    const { data: transfer } = await admin
      .from("entitlement_transfer_requests")
      .select("*")
      .eq("id", transferId)
      .maybeSingle()

    if (!transfer) {
      return NextResponse.json({ ok: false, error: "transfer request not found" }, { status: 404 })
    }

    if (!transfer.source_entitlement_id && transfer.previous_google_email) {
      const { data: profile } = await admin
        .from("creator_profiles")
        .select("user_id")
        .eq("google_email", transfer.previous_google_email)
        .maybeSingle()

      if (profile?.user_id) {
        const { data: entitlement } = await admin
          .from("creator_entitlements")
          .select("id")
          .eq("user_id", profile.user_id)
          .maybeSingle()

        if (entitlement?.id) {
          await admin
            .from("entitlement_transfer_requests")
            .update({
              source_user_id: profile.user_id,
              source_entitlement_id: entitlement.id,
              updated_at: new Date().toISOString(),
            })
            .eq("id", transferId)
          transfer.source_user_id = profile.user_id
          transfer.source_entitlement_id = entitlement.id
        }
      }
    }

    if (!transfer.source_entitlement_id) {
      return NextResponse.json({ ok: false, error: "source entitlement could not be resolved" }, { status: 400 })
    }

    const rpc = await admin.rpc("complete_entitlement_transfer", {
      p_transfer_request_id: transferId,
      p_platform_admin_user_id: auth.user.id,
    })

    if (rpc.error || !Array.isArray(rpc.data) || rpc.data.length === 0) {
      return NextResponse.json(
        { ok: false, error: rpc.error?.message ?? "failed to approve transfer" },
        { status: 500 }
      )
    }

    await createPlatformNotification({
      recipientUserId: transfer.target_user_id,
      type: "platform.transfer_completed",
      payload: {
        transfer_request_id: transferId,
      },
    })

    await writePlatformAudit({
      userId: auth.user.id,
      action: "platform.transfer.approve",
      resourceType: "entitlement_transfer_request",
      resourceId: transferId,
      meta: {
        target_user_id: transfer.target_user_id,
      },
    })

    return NextResponse.json({ ok: true, result: rpc.data[0] })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "failed to approve transfer" },
      { status: 500 }
    )
  }
}
