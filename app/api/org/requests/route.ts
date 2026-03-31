import { NextRequest, NextResponse } from "next/server"
import { requireOrgPermission } from "@/lib/adminApi"
import { normalizeAppOrgRole } from "@/lib/orgRoles"

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
      .from("join_requests")
      .select("id, requester_user_id, requester_email, message, requested_role, requested_role_id, requested_display_name, created_at")
      .eq("org_id", orgId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })

    if (primary.error?.code === "42703") {
      const fallback = await admin
        .from("join_requests")
        .select("id, requester_user_id, requester_email, message, requested_role, requested_display_name, created_at")
        .eq("org_id", orgId)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
      data = fallback.data as unknown[] | null
      error = fallback.error as { code?: string; message?: string } | null
    } else {
      data = primary.data as unknown[] | null
      error = primary.error as { code?: string; message?: string } | null
    }

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const rows = (data ?? []) as {
      id: string
      requester_user_id: string
      requester_email: string | null
      message: string | null
      requested_role: string | null
      requested_role_id?: string | null
      requested_display_name: string | null
      created_at: string
    }[]
    const list = rows.map((r) => ({
      id: r.id,
      requesterUserId: r.requester_user_id,
      requesterEmail: r.requester_email ?? undefined,
      message: r.message ?? undefined,
      requestedRole: normalizeAppOrgRole(r.requested_role) ?? "member",
      requestedRoleId: r.requested_role_id ?? undefined,
      requestedDisplayName: r.requested_display_name ?? undefined,
      createdAt: r.created_at,
    }))
    return NextResponse.json({ ok: true, requests: list })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Server error" }, { status: 500 })
  }
}
