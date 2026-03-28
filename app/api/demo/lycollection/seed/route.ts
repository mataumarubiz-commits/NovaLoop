import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { getOrgRole, getUserIdFromToken, isOrgAdmin } from "@/lib/apiAuth"
import {
  LYCOLLECTION_DEMO_WORK_ITEMS,
  SERVICE_CATALOG_SEEDS,
  WORKFLOW_TEMPLATE_SEEDS,
  calculateWorkItemAmount,
  getMonthEndDate,
  getStatusGroupForServiceCategory,
  getSuggestedDueEditorAt,
} from "@/lib/workItems"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const isApprovedLikeStatus = (status: string) => status === "approved"
const isDeliveredLikeStatus = (status: string) =>
  status === "delivered" || status === "completed" || status === "billable" || status === "approved"

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserIdFromToken(req)
    if (!userId) {
      return NextResponse.json({ ok: false, message: "ログインしてください。" }, { status: 401 })
    }

    const admin = createSupabaseAdmin()
    const { data: profile } = await admin
      .from("user_profiles")
      .select("active_org_id")
      .eq("user_id", userId)
      .maybeSingle()
    const orgId = (profile as { active_org_id?: string | null } | null)?.active_org_id ?? null
    if (!orgId) {
      return NextResponse.json({ ok: false, message: "アクティブなワークスペースが見つかりません。" }, { status: 400 })
    }

    const role = await getOrgRole(admin, userId, orgId)
    if (!isOrgAdmin(role)) {
      return NextResponse.json({ ok: false, message: "デモデータを投入できるのは owner / executive_assistant のみです。" }, { status: 403 })
    }

    const now = new Date().toISOString()

    const workflowRows = WORKFLOW_TEMPLATE_SEEDS.map((template) => ({
      org_id: orgId,
      key: template.key,
      name: template.name,
      service_category: template.serviceCategory,
      statuses_json: template.statuses,
      is_default: template.isDefault ?? false,
      updated_at: now,
    }))
    const { error: workflowError } = await admin
      .from("workflow_templates")
      .upsert(workflowRows, { onConflict: "org_id,key" })
    if (workflowError) {
      return NextResponse.json({ ok: false, message: workflowError.message }, { status: 500 })
    }

    const existingCatalogsRes = await admin
      .from("service_catalogs")
      .select("id, name")
      .eq("org_id", orgId)
    if (existingCatalogsRes.error) {
      return NextResponse.json({ ok: false, message: existingCatalogsRes.error.message }, { status: 500 })
    }
    const existingCatalogNameToId = new Map(
      ((existingCatalogsRes.data ?? []) as Array<{ id: string; name: string }>).map((row) => [row.name, row.id])
    )

    const catalogRows = SERVICE_CATALOG_SEEDS.map((catalog, index) => ({
      id: existingCatalogNameToId.get(catalog.name) ?? crypto.randomUUID(),
      org_id: orgId,
      name: catalog.name,
      service_category: catalog.serviceCategory,
      billing_model: catalog.billingModel,
      unit_type: catalog.unitType,
      default_unit_price: catalog.defaultUnitPrice,
      default_quantity: catalog.defaultQuantity ?? 1,
      workflow_template_key: catalog.workflowTemplateKey,
      is_active: true,
      sort_order: index + 1,
      metadata_json: catalog.metadataJson ?? {},
      updated_at: now,
    }))
    const { error: catalogError } = await admin
      .from("service_catalogs")
      .upsert(catalogRows, { onConflict: "org_id,name" })
    if (catalogError) {
      return NextResponse.json({ ok: false, message: catalogError.message }, { status: 500 })
    }

    const catalogsAfterSeedRes = await admin
      .from("service_catalogs")
      .select("id, name")
      .eq("org_id", orgId)
    if (catalogsAfterSeedRes.error) {
      return NextResponse.json({ ok: false, message: catalogsAfterSeedRes.error.message }, { status: 500 })
    }
    const catalogNameToId = new Map(
      ((catalogsAfterSeedRes.data ?? []) as Array<{ id: string; name: string }>).map((row) => [row.name, row.id])
    )

    const demoClientNames = Array.from(new Set(LYCOLLECTION_DEMO_WORK_ITEMS.map((row) => row.clientName)))
    const existingClientsRes = await admin
      .from("clients")
      .select("id, name")
      .eq("org_id", orgId)
      .in("name", demoClientNames)
    if (existingClientsRes.error) {
      return NextResponse.json({ ok: false, message: existingClientsRes.error.message }, { status: 500 })
    }
    const clientNameToId = new Map(
      ((existingClientsRes.data ?? []) as Array<{ id: string; name: string }>).map((row) => [row.name, row.id])
    )

    const clientsToInsert = demoClientNames
      .filter((name) => !clientNameToId.has(name))
      .map((name) => ({
        id: crypto.randomUUID(),
        org_id: orgId,
        name,
        client_type: "corporate",
      }))
    if (clientsToInsert.length > 0) {
      const { error: clientInsertError } = await admin.from("clients").insert(clientsToInsert)
      if (clientInsertError) {
        return NextResponse.json({ ok: false, message: clientInsertError.message }, { status: 500 })
      }
      for (const row of clientsToInsert) {
        clientNameToId.set(row.name, row.id)
      }
    }

    const existingContentRefsRes = await admin
      .from("contents")
      .select("external_ref")
      .eq("org_id", orgId)
      .in("external_ref", LYCOLLECTION_DEMO_WORK_ITEMS.map((row) => row.externalRef))
    if (existingContentRefsRes.error) {
      return NextResponse.json({ ok: false, message: existingContentRefsRes.error.message }, { status: 500 })
    }
    const existingRefs = new Set(
      ((existingContentRefsRes.data ?? []) as Array<{ external_ref: string | null }>).map((row) => row.external_ref).filter(Boolean)
    )

    const contentRows = LYCOLLECTION_DEMO_WORK_ITEMS.filter((row) => !existingRefs.has(row.externalRef)).map((row) => {
      const clientId = clientNameToId.get(row.clientName)
      const dueClientAt = getMonthEndDate(row.deliveryMonth)
      const dueEditorAt = getSuggestedDueEditorAt(row.serviceCategory, dueClientAt)
      if (!clientId) {
        throw new Error(`デモ用クライアントが見つかりません: ${row.clientName}`)
      }
      return {
        id: crypto.randomUUID(),
        org_id: orgId,
        client_id: clientId,
        project_name: row.projectName,
        title: row.title ?? row.serviceName,
        service_name: row.serviceName,
        service_category: row.serviceCategory,
        billing_model: row.billingModel,
        unit_type: row.unitType,
        quantity: row.quantity,
        service_catalog_id: catalogNameToId.get(row.serviceName) ?? null,
        workflow_template_key: row.workflowTemplateKey,
        status_group: getStatusGroupForServiceCategory(row.serviceCategory),
        unit_price: row.unitPrice,
        due_client_at: dueClientAt,
        due_editor_at: dueEditorAt,
        status: row.status,
        thumbnail_done: row.serviceCategory === "video_editing" ? false : false,
        billable_flag: true,
        delivery_month: row.deliveryMonth,
        started_at: dueEditorAt,
        delivered_at: isDeliveredLikeStatus(row.status) ? dueClientAt : null,
        approved_at: isApprovedLikeStatus(row.status) ? dueClientAt : null,
        external_ref: row.externalRef,
        metadata_json: row.metadataJson ?? {},
        influencer_count:
          typeof row.metadataJson?.influencer_count === "number" ? Number(row.metadataJson.influencer_count) : null,
        post_date: row.serviceCategory === "casting" ? dueClientAt : null,
        launch_date: row.serviceCategory === "website" ? dueClientAt : null,
        report_due_at: row.serviceCategory === "sns_ops" ? dueClientAt : null,
        deliverable_type:
          row.serviceCategory === "live2d" ? (row.unitType === "deliverable" ? "motion" : "model") : null,
        estimated_cost: 0,
        workload_points: Math.max(1, Number(row.quantity)),
        revision_count: 0,
        material_status: "not_ready",
        draft_status: "not_started",
        final_status: "not_started",
        next_action: null,
        blocked_reason: null,
        health_score: 100,
        publish_at: null,
        sequence_no: null,
        assignee_editor_user_id: null,
        assignee_checker_user_id: null,
        links_json: {},
      }
    })

    if (contentRows.length > 0) {
      const { error: contentInsertError } = await admin.from("contents").insert(contentRows)
      if (contentInsertError) {
        return NextResponse.json({ ok: false, message: contentInsertError.message }, { status: 500 })
      }
    }

    const totalSeedAmount = LYCOLLECTION_DEMO_WORK_ITEMS.reduce(
      (sum, row) => sum + calculateWorkItemAmount(row.quantity, row.unitPrice),
      0
    )

    return NextResponse.json({
      ok: true,
      seeded: {
        workflow_templates: workflowRows.length,
        service_catalogs: catalogRows.length,
        demo_clients: demoClientNames.length,
        demo_work_items: contentRows.length,
        total_demo_amount: totalSeedAmount,
      },
    })
  } catch (error) {
    console.error("[api/demo/lycollection/seed] POST", error)
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Lycollection デモデータの投入に失敗しました。" },
      { status: 500 }
    )
  }
}
