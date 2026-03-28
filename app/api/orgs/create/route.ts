import { NextRequest, NextResponse } from "next/server"
import { requirePlatformUser } from "@/lib/platformAuth"
import { ensureNonEmpty } from "@/lib/platform"
import { writePlatformAudit } from "@/lib/platformServer"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const auth = await requirePlatformUser(req)
  if ("error" in auth) return auth.error

  try {
    const body = await req.json().catch(() => ({}))
    const orgName = ensureNonEmpty(body?.org_name, "org_name")
    const displayName = typeof body?.display_name === "string" ? body.display_name.trim() : ""

    const canCreate = await auth.userClient.rpc("can_create_orgs_me")
    if (canCreate.error || canCreate.data !== true) {
      return NextResponse.json({ ok: false, error: "Active creator entitlement required" }, { status: 403 })
    }

    const rpc = await auth.userClient.rpc("create_org_with_entitlement", {
      p_org_name: orgName,
      p_display_name: displayName,
    })

    if (rpc.error || !rpc.data) {
      return NextResponse.json(
        { ok: false, error: rpc.error?.message ?? "Failed to create organization" },
        { status: 400 }
      )
    }

    await writePlatformAudit({
      userId: auth.user.id,
      action: "org.create",
      resourceType: "organization",
      resourceId: String(rpc.data),
      meta: {
        org_name: orgName,
      },
    })

    return NextResponse.json({ ok: true, orgId: String(rpc.data) })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to create organization" },
      { status: 500 }
    )
  }
}
