import { NextRequest, NextResponse } from "next/server"
import { requirePlatformUser } from "@/lib/platformAuth"
import { ensureNonEmpty } from "@/lib/platform"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const auth = await requirePlatformUser(req)
  if ("error" in auth) return auth.error

  try {
    const body = await req.json().catch(() => ({}))
    const fullName = ensureNonEmpty(body?.full_name, "full_name")
    const address = ensureNonEmpty(body?.address, "address")
    const phone = ensureNonEmpty(body?.phone, "phone")
    const contactEmail = ensureNonEmpty(body?.contact_email, "contact_email")
    const reason = ensureNonEmpty(body?.reason, "reason")
    const companyName = typeof body?.company_name === "string" ? body.company_name.trim() : ""
    const previousGoogleEmail = typeof body?.previous_google_email === "string" ? body.previous_google_email.trim() : ""
    const referenceNote = typeof body?.reference_note === "string" ? body.reference_note.trim() : ""

    const admin = createSupabaseAdmin()
    const { data: pending } = await admin
      .from("entitlement_transfer_requests")
      .select("id")
      .eq("target_user_id", auth.user.id)
      .eq("status", "pending")
      .maybeSingle()

    if (pending) {
      return NextResponse.json({ ok: false, error: "pending transfer request already exists" }, { status: 409 })
    }

    let sourceUserId: string | null = null
    let sourceEntitlementId: string | null = null

    if (previousGoogleEmail) {
      const { data: profile } = await admin
        .from("creator_profiles")
        .select("user_id")
        .eq("google_email", previousGoogleEmail)
        .maybeSingle()

      if (profile?.user_id) {
        sourceUserId = profile.user_id
        const { data: entitlement } = await admin
          .from("creator_entitlements")
          .select("id")
          .eq("user_id", profile.user_id)
          .maybeSingle()
        sourceEntitlementId = entitlement?.id ?? null
      }
    }

    const { data, error } = await admin
      .from("entitlement_transfer_requests")
      .insert({
        target_user_id: auth.user.id,
        source_user_id: sourceUserId,
        source_entitlement_id: sourceEntitlementId,
        current_google_email: auth.user.email ?? null,
        previous_google_email: previousGoogleEmail || null,
        full_name: fullName,
        company_name: companyName || null,
        address,
        phone,
        contact_email: contactEmail,
        reason,
        reference_note: referenceNote || null,
      })
      .select("*")
      .single()

    if (error || !data) {
      return NextResponse.json({ ok: false, error: error?.message ?? "failed to create transfer request" }, { status: 500 })
    }

    return NextResponse.json({ ok: true, transfer_request: data })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "failed to create transfer request" },
      { status: 500 }
    )
  }
}
