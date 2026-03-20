import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { getOrgRole, getUserIdFromToken, isOrgAdmin } from "@/lib/apiAuth"
import { ONBOARDING_ITEMS, type OnboardingItemKey, completionRate, filterOnboardingKeys } from "@/lib/onboarding"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type SyncBody = {
  completed_keys?: string[]
}

async function countExact(admin: ReturnType<typeof createSupabaseAdmin>, table: string, orgId: string) {
  const { count } = await admin.from(table).select("id", { head: true, count: "exact" }).eq("org_id", orgId)
  return count ?? 0
}

async function hasAnalyticsEvent(
  admin: ReturnType<typeof createSupabaseAdmin>,
  orgId: string,
  userId: string,
  matcher: { eventName?: string; prefix?: string }
) {
  let query = admin
    .from("analytics_events")
    .select("id, event_name")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .limit(20)

  if (matcher.eventName) query = query.eq("event_name", matcher.eventName)
  if (matcher.prefix) query = query.ilike("event_name", `${matcher.prefix}%`)

  const { data } = await query
  return (data?.length ?? 0) > 0
}

async function computeCompletedKeys(admin: ReturnType<typeof createSupabaseAdmin>, orgId: string, userId: string) {
  const [
    settingsRes,
    bankCount,
    clientsCount,
    pagesCount,
    contentsCount,
    invoicesCount,
    vendorsCount,
    notificationClick,
    notificationCenterView,
  ] = await Promise.all([
    admin
      .from("org_settings")
      .select("issuer_name, issuer_address, issuer_email")
      .eq("org_id", orgId)
      .maybeSingle(),
    countExact(admin, "org_bank_accounts", orgId),
    countExact(admin, "clients", orgId),
    countExact(admin, "pages", orgId),
    countExact(admin, "contents", orgId),
    countExact(admin, "invoices", orgId),
    countExact(admin, "vendors", orgId),
    hasAnalyticsEvent(admin, orgId, userId, { eventName: "notification.clicked" }),
    hasAnalyticsEvent(admin, orgId, userId, { eventName: "notification.center_viewed" }),
  ])

  const completed = new Set<OnboardingItemKey>()
  const settings = settingsRes.data as { issuer_name?: string | null; issuer_address?: string | null; issuer_email?: string | null } | null

  if (settings?.issuer_name || settings?.issuer_address || settings?.issuer_email) completed.add("company_profile")
  if (bankCount > 0) completed.add("bank_account")
  if (clientsCount > 0) completed.add("client_created")
  if (pagesCount > 0) completed.add("manual_page")
  if (contentsCount > 0) completed.add("first_content")
  if (invoicesCount > 0) completed.add("first_invoice")
  if (vendorsCount > 0) completed.add("vendor_flow")
  if (notificationClick || notificationCenterView) completed.add("notifications_checked")

  return Array.from(completed)
}

export async function GET(req: NextRequest) {
  try {
    const userId = await getUserIdFromToken(req)
    if (!userId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })

    const admin = createSupabaseAdmin()
    const { data: profile } = await admin
      .from("user_profiles")
      .select("active_org_id")
      .eq("user_id", userId)
      .maybeSingle()
    const orgId = (profile as { active_org_id?: string | null } | null)?.active_org_id ?? null
    if (!orgId) return NextResponse.json({ ok: false, error: "Active org not found" }, { status: 400 })

    const role = await getOrgRole(admin, userId, orgId)
    if (!isOrgAdmin(role)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 })

    const computedKeys = await computeCompletedKeys(admin, orgId, userId)
    const completedSet = new Set(computedKeys)
    const now = new Date().toISOString()

    if (computedKeys.length > 0) {
      const payload = computedKeys.map((key) => ({
        org_id: orgId,
        user_id: userId,
        item_key: key,
        completed_at: now,
        updated_at: now,
      }))
      await admin.from("onboarding_progress").upsert(payload, { onConflict: "org_id,user_id,item_key" })
    }

    const { data: progressRows } = await admin
      .from("onboarding_progress")
      .select("item_key, completed_at")
      .eq("org_id", orgId)
      .eq("user_id", userId)

    const progressMap = new Map(
      ((progressRows ?? []) as Array<{ item_key: string; completed_at: string }>).map((row) => [row.item_key, row.completed_at])
    )
    if (progressMap.has("notifications_checked")) {
      completedSet.add("notifications_checked")
    }

    const completedKeys = filterOnboardingKeys(Array.from(completedSet))

    const items = ONBOARDING_ITEMS.map((item) => ({
      ...item,
      completed: completedSet.has(item.key),
      completed_at: progressMap.get(item.key) ?? null,
    }))

    return NextResponse.json({
      ok: true,
      items,
      completed_keys: completedKeys,
      completion_rate: completionRate(completedKeys),
      done: completedKeys.length === ONBOARDING_ITEMS.length,
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to load onboarding progress" },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserIdFromToken(req)
    if (!userId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })

    const admin = createSupabaseAdmin()
    const { data: profile } = await admin
      .from("user_profiles")
      .select("active_org_id")
      .eq("user_id", userId)
      .maybeSingle()
    const orgId = (profile as { active_org_id?: string | null } | null)?.active_org_id ?? null
    if (!orgId) return NextResponse.json({ ok: false, error: "Active org not found" }, { status: 400 })

    const role = await getOrgRole(admin, userId, orgId)
    if (!isOrgAdmin(role)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 })

    const body = (await req.json().catch(() => null)) as SyncBody | null
    const completedKeys = filterOnboardingKeys(body?.completed_keys ?? [])
    const now = new Date().toISOString()

    if (completedKeys.length > 0) {
      await admin.from("onboarding_progress").upsert(
        completedKeys.map((key) => ({
          org_id: orgId,
          user_id: userId,
          item_key: key,
          completed_at: now,
          updated_at: now,
        })),
        { onConflict: "org_id,user_id,item_key" }
      )
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to sync onboarding progress" },
      { status: 500 }
    )
  }
}
