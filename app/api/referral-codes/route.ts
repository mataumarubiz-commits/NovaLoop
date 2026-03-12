import { NextRequest, NextResponse } from "next/server"
import { createUserClient, getBearerToken } from "@/lib/userClient"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function getAuth(req: NextRequest) {
  const token = getBearerToken(req)
  if (!token) return { error: NextResponse.json({ ok: false, message: "認証が必要です" }, { status: 401 }) }
  const supabase = createUserClient(token)
  if (!supabase) {
    return { error: NextResponse.json({ ok: false, message: "Supabase 設定が不足しています" }, { status: 500 }) }
  }
  const { data } = await supabase.auth.getUser(token)
  const userId = data.user?.id ?? null
  if (!userId) return { error: NextResponse.json({ ok: false, message: "認証が必要です" }, { status: 401 }) }
  const [{ data: profile }, { data: appUser }] = await Promise.all([
    supabase.from("user_profiles").select("active_org_id").eq("user_id", userId).maybeSingle(),
    supabase.from("app_users").select("org_id, role").eq("user_id", userId),
  ])
  const orgId = (profile as { active_org_id?: string | null } | null)?.active_org_id ?? null
  const role = ((appUser ?? []) as { org_id: string; role: string }[]).find((row) => row.org_id === orgId)?.role ?? null
  if (!orgId || (role !== "owner" && role !== "executive_assistant")) {
    return { error: NextResponse.json({ ok: false, message: "権限がありません" }, { status: 403 }) }
  }
  return { supabase, orgId, userId }
}

export async function GET(req: NextRequest) {
  const auth = await getAuth(req)
  if ("error" in auth) return auth.error
  const { supabase, orgId } = auth
  const { data, error } = await supabase
    .from("referral_codes")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, referralCodes: data ?? [] }, { status: 200 })
}

export async function POST(req: NextRequest) {
  const auth = await getAuth(req)
  if ("error" in auth) return auth.error
  const { supabase, orgId, userId } = auth
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const rawCode = typeof body.code === "string" ? body.code.trim().toUpperCase() : ""
  const code = rawCode || Math.random().toString(36).slice(2, 10).toUpperCase()
  const note = typeof body.note === "string" ? body.note.trim() : null
  const issuedToEmail = typeof body.issued_to_email === "string" ? body.issued_to_email.trim().toLowerCase() : null
  const { error } = await supabase.from("referral_codes").insert({
    org_id: orgId,
    code,
    note,
    issued_to_email: issuedToEmail,
    created_by: userId,
  })
  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, code }, { status: 200 })
}

export async function PATCH(req: NextRequest) {
  const auth = await getAuth(req)
  if ("error" in auth) return auth.error
  const { supabase, orgId } = auth
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const id = typeof body.id === "string" ? body.id : ""
  if (!id) return NextResponse.json({ ok: false, message: "id が必要です" }, { status: 400 })
  const payload = {
    status: body.status === "used" || body.status === "disabled" ? body.status : "active",
    note: typeof body.note === "string" ? body.note.trim() : undefined,
  }
  const { error } = await supabase.from("referral_codes").update(payload).eq("id", id).eq("org_id", orgId)
  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 500 })
  return NextResponse.json({ ok: true }, { status: 200 })
}
