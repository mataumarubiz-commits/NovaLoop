import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type DeleteTarget = {
  table: string
  column: string
}

const DELETE_TARGETS: DeleteTarget[] = [
  { table: "app_users", column: "user_id" },
  { table: "vendor_users", column: "user_id" },
  { table: "ai_logs", column: "user_id" },
  { table: "analytics_events", column: "user_id" },
  { table: "onboarding_progress", column: "user_id" },
  { table: "feedback_submissions", column: "user_id" },
  { table: "page_comments", column: "user_id" },
  { table: "page_revisions", column: "updated_by_user_id" },
  { table: "audit_logs", column: "user_id" },
]

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

async function deleteByUserId(
  admin: ReturnType<typeof createSupabaseAdmin>,
  table: string,
  column: string,
  userId: string
) {
  const { error } = await admin.from(table).delete().eq(column, userId)
  if (!error) return

  if (error.code === "42P01" || error.code === "PGRST205") {
    return
  }

  throw error
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

    const admin = createSupabaseAdmin()

    const { data: ownerRows, error: ownerRowsError } = await admin
      .from("app_users")
      .select("org_id")
      .eq("user_id", userId)
      .eq("role", "owner")

    if (ownerRowsError) {
      console.error("[account/delete] failed to check owner memberships", ownerRowsError)
      return NextResponse.json(
        {
          ok: false,
          message:
            "所属ワークスペースの確認に失敗しました。しばらくしてから再試行してください。",
        },
        { status: 500 }
      )
    }

    if ((ownerRows ?? []).length > 0) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "オーナーとして所属中のワークスペースがあります。先にワークスペース削除またはオーナー権限の移譲を行ってください。",
        },
        { status: 409 }
      )
    }

    for (const target of DELETE_TARGETS) {
      await deleteByUserId(admin, target.table, target.column, userId)
    }

    const { error: authDeleteError } = await admin.auth.admin.deleteUser(userId)
    if (authDeleteError) {
      console.error("[account/delete] failed to delete auth user", authDeleteError)
      return NextResponse.json(
        { ok: false, message: "アカウント削除に失敗しました。しばらくしてから再試行してください。" },
        { status: 500 }
      )
    }

    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (e) {
    console.error("[account/delete] unexpected error", e)
    return NextResponse.json(
      { ok: false, message: "アカウント削除に失敗しました。しばらくしてから再試行してください。" },
      { status: 500 }
    )
  }
}
