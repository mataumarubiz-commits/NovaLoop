import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get("Authorization")
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!token || !url || !anonKey) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const supabase = createClient(url, anonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    })

    const {
      data: { user },
    } = await supabase.auth.getUser(token)
    const userId = user?.id ?? null
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const orgId = req.nextUrl.searchParams.get("orgId")?.trim() ?? ""
    if (!orgId) return NextResponse.json({ error: "orgId is required" }, { status: 400 })

    const unreadOnly = req.nextUrl.searchParams.get("unreadOnly") === "1"
    const limitParam = Number(req.nextUrl.searchParams.get("limit") ?? "50")
    const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(200, Math.floor(limitParam))) : 50

    const { data: membership } = await supabase
      .from("app_users")
      .select("org_id")
      .eq("user_id", userId)
      .eq("org_id", orgId)
      .maybeSingle()
    if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    let query = supabase
      .from("notifications")
      .select("id, org_id, type, payload, read_at, created_at")
      .eq("org_id", orgId)
      .eq("recipient_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit)

    if (unreadOnly) query = query.is("read_at", null)

    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true, notifications: data ?? [] })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    )
  }
}
