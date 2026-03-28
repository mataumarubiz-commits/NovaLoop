import { NextRequest, NextResponse } from "next/server"
import { requirePlatformUser } from "@/lib/platformAuth"
import { ensureNonEmpty } from "@/lib/platform"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const auth = await requirePlatformUser(req)
  if ("error" in auth) return auth.error

  try {
    const body = await req.json().catch(() => ({}))
    const type = typeof body?.type === "string" ? body.type : ""
    if (type === "personal") {
      return NextResponse.json(
        {
          ok: false,
          error: "個人用Orgの自動作成フローは廃止されました。新しい組織を作る場合はライセンス購入後に request-org から作成してください。",
        },
        { status: 410 }
      )
    }

    const orgName = ensureNonEmpty(body?.orgName, "orgName")
    const displayName = typeof body?.displayNameInOrg === "string" ? body.displayNameInOrg.trim() : ""

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

    return NextResponse.json({ ok: true, orgId: String(rpc.data) })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to create organization" },
      { status: 500 }
    )
  }
}
