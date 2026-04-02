import { NextRequest, NextResponse } from "next/server"
import { requirePlatformUser } from "@/lib/platformAuth"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type NotifyBody = {
  paid_at: string
  paid_amount: number
  transfer_name?: string | null
  note?: string | null
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformUser(req)
  if ("error" in auth) return auth.error

  const { id } = await params
  if (!id) {
    return NextResponse.json({ ok: false, error: "payment id is required" }, { status: 400 })
  }

  let body: NotifyBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 })
  }

  if (!body.paid_at || !/^\d{4}-\d{2}-\d{2}$/.test(body.paid_at)) {
    return NextResponse.json({ ok: false, error: "paid_at must be YYYY-MM-DD" }, { status: 400 })
  }
  if (typeof body.paid_amount !== "number" || body.paid_amount <= 0 || body.paid_amount > 100_000_000) {
    return NextResponse.json({ ok: false, error: "paid_amount is invalid" }, { status: 400 })
  }
  if (body.transfer_name && body.transfer_name.length > 100) {
    return NextResponse.json({ ok: false, error: "transfer_name must be 100 chars or fewer" }, { status: 400 })
  }
  if (body.note && body.note.length > 500) {
    return NextResponse.json({ ok: false, error: "note must be 500 chars or fewer" }, { status: 400 })
  }

  const admin = createSupabaseAdmin()
  const { data: payment, error } = await admin
    .from("platform_payment_requests")
    .select("id, user_id, request_number, status, client_notified_at")
    .eq("id", id)
    .eq("user_id", auth.user.id)
    .maybeSingle()

  if (error || !payment) {
    return NextResponse.json({ ok: false, error: "payment request not found" }, { status: 404 })
  }

  const { error: updateError } = await admin
    .from("platform_payment_requests")
    .update({
      client_notified_at: new Date().toISOString(),
      client_paid_at_claimed: body.paid_at,
      client_paid_amount_claimed: body.paid_amount,
      client_transfer_name: body.transfer_name?.trim() || null,
      client_notify_note: body.note?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)

  if (updateError) {
    return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    already_notified: Boolean((payment as { client_notified_at?: string | null }).client_notified_at),
    request_number: (payment as { request_number?: string }).request_number ?? null,
  })
}
