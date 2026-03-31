import { NextRequest, NextResponse } from "next/server"
import { requireAdminContext } from "@/lib/adminApi"
import {
  buildOrgIntegrationSettingsUpsert,
  loadOrgIntegrationSettings,
  toClientOrgIntegrationSettings,
} from "@/lib/orgIntegrationSettings"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const auth = await requireAdminContext(req)
  if ("error" in auth) return auth.error

  const settings = await loadOrgIntegrationSettings(auth.admin, auth.orgId)
  return NextResponse.json(
    {
      ok: true,
      orgId: auth.orgId,
      settings: toClientOrgIntegrationSettings(settings),
    },
    { status: 200 }
  )
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdminContext(req)
  if ("error" in auth) return auth.error

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const existing = await loadOrgIntegrationSettings(auth.admin, auth.orgId)
  const payload = buildOrgIntegrationSettingsUpsert({
    orgId: auth.orgId,
    existing,
    body,
  })

  const { error } = await auth.admin.from("org_integration_settings").upsert(payload, { onConflict: "org_id" })
  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 })
  }

  const next = await loadOrgIntegrationSettings(auth.admin, auth.orgId)
  return NextResponse.json(
    {
      ok: true,
      settings: toClientOrgIntegrationSettings(next),
    },
    { status: 200 }
  )
}
