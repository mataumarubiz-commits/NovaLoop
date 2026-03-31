import { NextRequest, NextResponse } from "next/server"
import { requireOrgPermission } from "@/lib/adminApi"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  try {
    const orgId = req.nextUrl.searchParams.get("orgId")?.trim() ?? null
    if (!orgId) return NextResponse.json({ error: "orgId is required" }, { status: 400 })

    const auth = await requireOrgPermission(req, "members_manage", orgId)
    if (!auth.ok) return auth.response
    const { admin } = auth

    let data: unknown[] | null = null
    let error: { code?: string; message?: string } | null = null
    const primary = await admin
      .from("org_invites")
      .select("id, email, role_key, role_id, token, status, expires_at, created_at, invited_by")
      .eq("org_id", orgId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })

    if (primary.error?.code === "42703") {
      const fallback = await admin
        .from("org_invites")
        .select("id, email, role_key, token, status, expires_at, created_at, invited_by")
        .eq("org_id", orgId)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
      data = fallback.data as unknown[] | null
      error = fallback.error as { code?: string; message?: string } | null
    } else {
      data = primary.data as unknown[] | null
      error = primary.error as { code?: string; message?: string } | null
    }

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, invites: data ?? [] })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    )
  }
}
