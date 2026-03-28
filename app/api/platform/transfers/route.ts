import { NextRequest, NextResponse } from "next/server"
import { requirePlatformAdmin } from "@/lib/platformAuth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const auth = await requirePlatformAdmin(req)
  if ("error" in auth) return auth.error

  const { data, error } = await auth.admin
    .from("entitlement_transfer_requests")
    .select("*")
    .order("created_at", { ascending: false })

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, transfers: data ?? [] })
}
