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
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("active_org_id")
    .eq("user_id", userId)
    .maybeSingle()
  const orgId = (profile as { active_org_id?: string | null } | null)?.active_org_id
  if (!orgId) {
    return { error: NextResponse.json({ ok: false, message: "ワークスペースを選択してください" }, { status: 400 }) }
  }
  return { supabase, userId, orgId }
}

export async function GET(req: NextRequest) {
  const auth = await getAuth(req)
  if ("error" in auth) return auth.error
  const { supabase, orgId } = auth
  const { data, error } = await supabase
    .from("org_bank_accounts")
    .select("*")
    .eq("org_id", orgId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: false })
  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, bankAccounts: data ?? [] }, { status: 200 })
}

export async function POST(req: NextRequest) {
  const auth = await getAuth(req)
  if ("error" in auth) return auth.error
  const { supabase, orgId } = auth
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const payload = {
    org_id: orgId,
    bank_name: typeof body.bank_name === "string" ? body.bank_name.trim() : "",
    branch_name: typeof body.branch_name === "string" ? body.branch_name.trim() : "",
    account_type:
      body.account_type === "checking" || body.account_type === "savings" ? body.account_type : "ordinary",
    account_number: typeof body.account_number === "string" ? body.account_number.trim() : "",
    account_holder: typeof body.account_holder === "string" ? body.account_holder.trim() : "",
    account_holder_kana: typeof body.account_holder_kana === "string" ? body.account_holder_kana.trim() : null,
    depositor_code: typeof body.depositor_code === "string" ? body.depositor_code.trim() : null,
    is_default: Boolean(body.is_default),
  }
  if (!payload.bank_name || !payload.branch_name || !payload.account_number || !payload.account_holder) {
    return NextResponse.json({ ok: false, message: "必須項目が不足しています" }, { status: 400 })
  }
  const { error } = await supabase.from("org_bank_accounts").insert(payload)
  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 500 })
  return NextResponse.json({ ok: true }, { status: 200 })
}

export async function PATCH(req: NextRequest) {
  const auth = await getAuth(req)
  if ("error" in auth) return auth.error
  const { supabase, orgId } = auth
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const id = typeof body.id === "string" ? body.id : ""
  if (!id) return NextResponse.json({ ok: false, message: "id が必要です" }, { status: 400 })

  const payload = {
    bank_name: typeof body.bank_name === "string" ? body.bank_name.trim() : undefined,
    branch_name: typeof body.branch_name === "string" ? body.branch_name.trim() : undefined,
    account_type:
      body.account_type === "checking" || body.account_type === "savings" || body.account_type === "ordinary"
        ? body.account_type
        : undefined,
    account_number: typeof body.account_number === "string" ? body.account_number.trim() : undefined,
    account_holder: typeof body.account_holder === "string" ? body.account_holder.trim() : undefined,
    account_holder_kana: typeof body.account_holder_kana === "string" ? body.account_holder_kana.trim() : undefined,
    depositor_code: typeof body.depositor_code === "string" ? body.depositor_code.trim() : undefined,
    is_default: typeof body.is_default === "boolean" ? body.is_default : undefined,
    updated_at: new Date().toISOString(),
  }
  const { error } = await supabase.from("org_bank_accounts").update(payload).eq("id", id).eq("org_id", orgId)
  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 500 })
  return NextResponse.json({ ok: true }, { status: 200 })
}

export async function DELETE(req: NextRequest) {
  const auth = await getAuth(req)
  if ("error" in auth) return auth.error
  const { supabase, orgId } = auth
  const id = req.nextUrl.searchParams.get("id") ?? ""
  if (!id) return NextResponse.json({ ok: false, message: "id が必要です" }, { status: 400 })
  const { error } = await supabase.from("org_bank_accounts").delete().eq("id", id).eq("org_id", orgId)
  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 500 })
  return NextResponse.json({ ok: true }, { status: 200 })
}
