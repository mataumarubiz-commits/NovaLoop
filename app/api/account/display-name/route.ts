import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function getUserIdFromToken(req: NextRequest): Promise<string | null> {
  const authHeader = req.headers.get("Authorization")
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null
  if (!token) return null
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) return null
  const supabase = createClient(url, anonKey, { auth: { persistSession: false } })
  const { data } = await supabase.auth.getUser(token)
  return data.user?.id ?? null
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserIdFromToken(req)
    if (!userId) {
      return NextResponse.json(
        { ok: false, message: "認証に失敗しました。ログインし直してください。" },
        { status: 401 }
      )
    }

    const body = await req.json().catch(() => ({}))
    const raw = typeof body?.displayName === "string" ? body.displayName.trim() : ""
    const displayName = raw || ""
    const now = new Date().toISOString()
    const admin = createSupabaseAdmin()

    const { error: profileErr } = await admin
      .from("user_profiles")
      .upsert(
        {
          user_id: userId,
          display_name: displayName,
          updated_at: now,
        },
        { onConflict: "user_id" }
      )

    if (profileErr) {
      console.error("[account/display-name] user_profiles upsert failed", profileErr)
      return NextResponse.json(
        { ok: false, message: "表示名の保存に失敗しました。しばらくしてから再試行してください。" },
        { status: 500 }
      )
    }

    const { error: appUsersErr } = await admin
      .from("app_users")
      .update({ display_name: displayName, updated_at: now })
      .eq("user_id", userId)

    if (appUsersErr) {
      console.error("[account/display-name] app_users update failed", appUsersErr)
      return NextResponse.json(
        { ok: false, message: "表示名の保存に失敗しました。しばらくしてから再試行してください。" },
        { status: 500 }
      )
    }

    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (e) {
    console.error("[account/display-name] unexpected error", e)
    return NextResponse.json(
      { ok: false, message: "表示名の保存に失敗しました。しばらくしてから再試行してください。" },
      { status: 500 }
    )
  }
}

