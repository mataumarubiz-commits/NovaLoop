import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
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

    const body = await req.json().catch(() => ({}))
    const orgId = typeof body?.orgId === "string" ? body.orgId.trim() : ""
    const notificationId = typeof body?.notificationId === "string" ? body.notificationId.trim() : ""
    if (!orgId || !notificationId) {
      return NextResponse.json({ error: "orgId and notificationId are required" }, { status: 400 })
    }

    const { data: membership } = await supabase
      .from("app_users")
      .select("org_id")
      .eq("user_id", userId)
      .eq("org_id", orgId)
      .maybeSingle()
    if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const { data: row, error: fetchErr } = await supabase
      .from("notifications")
      .select("id, payload, read_at")
      .eq("id", notificationId)
      .eq("org_id", orgId)
      .eq("recipient_user_id", userId)
      .maybeSingle()
    if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 })
    if (!row) return NextResponse.json({ error: "Notification not found" }, { status: 404 })

    const payload = { ...((row.payload as Record<string, unknown> | null) ?? {}), resolved: true }
    const readAt = row.read_at ?? new Date().toISOString()
    const { error } = await supabase
      .from("notifications")
      .update({ payload, read_at: readAt })
      .eq("id", notificationId)
      .eq("org_id", orgId)
      .eq("recipient_user_id", userId)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    )
  }
}
