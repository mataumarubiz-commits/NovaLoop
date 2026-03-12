import { NextRequest, NextResponse } from "next/server"
import { requireAdminContext } from "@/lib/adminApi"
import { ONBOARDING_ITEMS, completionRate } from "@/lib/onboarding"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

export async function GET(req: NextRequest) {
  const auth = await requireAdminContext(req)
  if ("error" in auth) return auth.error
  const { admin, orgId } = auth

  const weekStartIso = new Date(Date.now() - WEEK_MS).toISOString()

  const [
    analyticsRes,
    feedbackRes,
    onboardingRes,
    pageTemplateEvents,
    aiEvents,
    notificationClicks,
    helpViews,
    vendorSubmitted,
  ] = await Promise.all([
    admin.from("analytics_events").select("user_id, event_name, created_at").eq("org_id", orgId).gte("created_at", weekStartIso),
    admin.from("feedback_submissions").select("id, category, created_at, page_path").eq("org_id", orgId).order("created_at", { ascending: false }).limit(8),
    admin.from("onboarding_progress").select("user_id, item_key").eq("org_id", orgId),
    admin
      .from("analytics_events")
      .select("id", { head: true, count: "exact" })
      .eq("org_id", orgId)
      .eq("event_name", "page.template_used"),
    admin
      .from("analytics_events")
      .select("id", { head: true, count: "exact" })
      .eq("org_id", orgId)
      .ilike("event_name", "ai.%"),
    admin
      .from("analytics_events")
      .select("id", { head: true, count: "exact" })
      .eq("org_id", orgId)
      .eq("event_name", "notification.clicked"),
    admin
      .from("analytics_events")
      .select("id", { head: true, count: "exact" })
      .eq("org_id", orgId)
      .eq("event_name", "help.article_viewed"),
    admin
      .from("vendor_invoices")
      .select("id", { head: true, count: "exact" })
      .eq("org_id", orgId)
      .not("submitted_at", "is", null)
      .gte("submitted_at", weekStartIso),
  ])

  const activeUsers = new Set(
    ((analyticsRes.data ?? []) as Array<{ user_id: string }>).map((row) => row.user_id).filter(Boolean)
  ).size

  const onboardingByUser = new Map<string, Set<string>>()
  for (const row of (onboardingRes.data ?? []) as Array<{ user_id: string; item_key: string }>) {
    if (!onboardingByUser.has(row.user_id)) onboardingByUser.set(row.user_id, new Set())
    onboardingByUser.get(row.user_id)!.add(row.item_key)
  }

  const rates = Array.from(onboardingByUser.values()).map((items) => completionRate(Array.from(items)))
  const avgRate = rates.length > 0 ? Math.round(rates.reduce((sum, value) => sum + value, 0) / rates.length) : 0
  const incompleteCount = Array.from(onboardingByUser.values()).filter((items) => items.size < ONBOARDING_ITEMS.length).length

  return NextResponse.json({
    ok: true,
    summary: {
      weekly_active_users: activeUsers,
      incomplete_onboarding_count: incompleteCount,
      first_value_rate: avgRate,
      template_usage_count: pageTemplateEvents.count ?? 0,
      ai_usage_count: aiEvents.count ?? 0,
      notification_click_count: notificationClicks.count ?? 0,
      help_article_view_count: helpViews.count ?? 0,
      vendor_invoice_submitted_count: vendorSubmitted.count ?? 0,
    },
    feedback: (feedbackRes.data ?? []) as Array<{ id: string; category: string; created_at: string; page_path: string | null }>,
  })
}
