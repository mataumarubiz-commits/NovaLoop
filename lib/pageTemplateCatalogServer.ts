import type { SupabaseClient } from "@supabase/supabase-js"
import {
  OFFICIAL_TEMPLATE_CATALOG,
  applyTemplateReplacements,
  buildBlankTemplateContent,
  buildTemplatePreviewPayload,
  extractPlainTextFromTemplateDoc,
  type OfficialTemplateCatalogSeed,
  type TemplateDocNode,
  type TemplatePageType,
  type TemplatePreviewPayload,
} from "@/lib/pageTemplateCatalog"
import { resolveSlugDuplicate, titleToSlug } from "@/lib/slug"

type TemplateCatalogRow = {
  id: string
  key: string
  name: string
  description: string
  category: string
  badge_json: unknown
  is_official: boolean
  sort_order: number
  preview_image_path: string | null
  version: string
  status: string
  integration_targets_json: unknown
  source_type: string | null
  owner_org_id: string | null
  sharing_scope: string | null
  industry_tag: string | null
  base_template_catalog_id: string | null
  recommendation_json: unknown
  preview_payload_json: unknown
  release_notes: string | null
}

type TemplatePageDefinitionRow = {
  id: string
  template_catalog_id: string
  parent_page_key: string | null
  slug_seed: string
  title: string
  icon: string | null
  order_index: number
  content_json: unknown
  page_type: TemplatePageType
  is_active: boolean
}

type TemplateInstallRow = {
  id: string
  org_id: string
  template_catalog_id: string
  installed_by: string
  installed_at: string
  install_name: string
  version: string
  include_sample_content: boolean
  group_under_root: boolean
  root_page_id: string | null
  install_status: string
  failure_message: string | null
  completed_at: string | null
  last_synced_at: string | null
  last_applied_version: string | null
}

export type TemplateSourceType = "official" | "shared"
export type TemplateSharingScope = "official" | "org" | "industry"
export type TemplateInstallStatus = "pending" | "completed" | "failed"

export type TemplateSnapshotPage = {
  key: string
  parentPageKey: string | null
  slugSeed: string
  title: string
  icon: string | null
  orderIndex: number
  pageType: TemplatePageType
  content: TemplateDocNode
}

export type TemplateInstallSummary = {
  installId: string
  installName: string
  installedAt: string
  version: string
  status: TemplateInstallStatus
  rootPageId: string | null
  pageCount: number
  updateAvailable: boolean
  latestVersion: string
  failureMessage: string | null
  groupUnderRoot: boolean
}

export type TemplateCatalogListItem = {
  id: string
  key: string
  name: string
  description: string
  improvementText: string
  category: string
  badges: string[]
  isOfficial: boolean
  sourceType: TemplateSourceType
  sharingScope: TemplateSharingScope
  industryTag: string | null
  version: string
  status: string
  integrationTargets: string[]
  previewImagePath: string | null
  preview: TemplatePreviewPayload
  pageCount: number
  installedCount: number
  recommendationKeys: string[]
  installs: TemplateInstallSummary[]
  pages: Array<{
    key: string
    title: string
    pageType: TemplatePageType
    parentPageKey: string | null
    orderIndex: number
    icon: string | null
  }>
  canManage: boolean
}

export type TemplateVersionDiffSummary = {
  templateKey: string
  templateName: string
  installId: string
  fromVersion: string
  toVersion: string
  hasChanges: boolean
  addedCount: number
  changedCount: number
  removedCount: number
  pages: Array<{
    slugSeed: string
    title: string
    changeType: "added" | "changed" | "removed"
    beforeText: string
    afterText: string
  }>
}

export type PageTemplateBindingInfo = {
  installId: string
  installName: string
  templateKey: string
  templateName: string
  templateCategory: string
  templateBadges: string[]
  integrationTargets: string[]
  templatePageTitle: string
  pageType: TemplatePageType
  isCustomized: boolean
  templateVersion: string
  latestVersion: string
  updateAvailable: boolean
  installStatus: TemplateInstallStatus
  installedAt: string
  rootPageId: string | null
  groupUnderRoot: boolean
  templateSourceType: TemplateSourceType
  sharingScope: TemplateSharingScope
  industryTag: string | null
}

type SyncResult = {
  catalogByKey: Map<string, TemplateCatalogRow>
  pageDefinitionByTemplateKey: Map<string, Map<string, TemplatePageDefinitionRow>>
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string")
}

function parseTemplatePreview(value: unknown): TemplatePreviewPayload | null {
  if (!value || typeof value !== "object") return null
  const row = value as Partial<TemplatePreviewPayload>
  if (
    typeof row.headline !== "string" ||
    typeof row.summary !== "string" ||
    !Array.isArray(row.highlightedPages) ||
    !Array.isArray(row.textPreview)
  ) {
    return null
  }
  return {
    headline: row.headline,
    summary: row.summary,
    highlightedPages: row.highlightedPages.filter((item): item is string => typeof item === "string"),
    textPreview: row.textPreview.filter((item): item is string => typeof item === "string"),
  }
}

function parseTemplateDocNode(value: unknown): TemplateDocNode {
  if (!value || typeof value !== "object") {
    return { type: "doc", content: [{ type: "paragraph" }] }
  }
  return value as TemplateDocNode
}

function parseInstallStatus(value: string | null | undefined): TemplateInstallStatus {
  if (value === "pending" || value === "failed") return value
  return "completed"
}

function parseSourceType(value: string | null | undefined): TemplateSourceType {
  return value === "shared" ? "shared" : "official"
}

function parseSharingScope(value: string | null | undefined, isOfficial: boolean): TemplateSharingScope {
  if (value === "org" || value === "industry" || value === "official") return value
  return isOfficial ? "official" : "org"
}

function normalizeTemplatePreview(
  row: Pick<TemplateCatalogRow, "preview_payload_json" | "name" | "description">,
  pages: TemplateSnapshotPage[]
): TemplatePreviewPayload {
  return (
    parseTemplatePreview(row.preview_payload_json) ?? {
      headline: `${row.name} Preview`,
      summary:
        row.description.trim() ||
        extractPlainTextFromTemplateDoc(pages[0]?.content ?? null).replace(/\s+/g, " ").trim().slice(0, 180),
      highlightedPages: pages.slice(0, 4).map((page) => page.title),
      textPreview: pages
        .slice(0, 3)
        .map((page) => extractPlainTextFromTemplateDoc(page.content).replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .map((text) => (text.length > 140 ? `${text.slice(0, 140)}...` : text)),
    }
  )
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.split(".").map((part) => Number(part) || 0)
  const rightParts = right.split(".").map((part) => Number(part) || 0)
  const maxLength = Math.max(leftParts.length, rightParts.length)
  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = leftParts[index] ?? 0
    const rightValue = rightParts[index] ?? 0
    if (leftValue > rightValue) return 1
    if (leftValue < rightValue) return -1
  }
  return 0
}

function bumpPatchVersion(version: string): string {
  const parts = version.split(".").map((part) => Number(part) || 0)
  while (parts.length < 3) parts.push(0)
  parts[2] += 1
  return parts.slice(0, 3).join(".")
}

function isTemplateAccessible(row: TemplateCatalogRow, orgId: string): boolean {
  if (row.is_official) return true
  if (row.sharing_scope === "industry") return true
  return row.owner_org_id === orgId
}

function buildTemplateSnapshotFromSeed(seed: OfficialTemplateCatalogSeed): TemplateSnapshotPage[] {
  return seed.pages.map((page) => ({
    key: page.key,
    parentPageKey: page.parentPageKey,
    slugSeed: page.slugSeed,
    title: page.title,
    icon: page.icon,
    orderIndex: page.orderIndex,
    pageType: page.pageType,
    content: page.content,
  }))
}

function buildTemplateSnapshotFromDefinitions(rows: TemplatePageDefinitionRow[]): TemplateSnapshotPage[] {
  return rows
    .filter((row) => row.is_active)
    .sort((left, right) => left.order_index - right.order_index)
    .map((row) => ({
      key: row.slug_seed,
      parentPageKey: row.parent_page_key,
      slugSeed: row.slug_seed,
      title: row.title,
      icon: row.icon,
      orderIndex: row.order_index,
      pageType: row.page_type,
      content: parseTemplateDocNode(row.content_json),
    }))
}

function dedupeTemplateKey(base: string, takenKeys: string[]): string {
  const slug = titleToSlug(base) || "shared-template"
  return resolveSlugDuplicate(slug, takenKeys)
}

async function loadTemplateCatalogRows(admin: SupabaseClient): Promise<TemplateCatalogRow[]> {
  const { data, error } = await admin.from("template_catalog").select(
    "id, key, name, description, category, badge_json, is_official, sort_order, preview_image_path, version, status, integration_targets_json, source_type, owner_org_id, sharing_scope, industry_tag, base_template_catalog_id, recommendation_json, preview_payload_json, release_notes"
  )

  if (error) throw error
  return (data ?? []) as TemplateCatalogRow[]
}

async function loadTemplateDefinitions(
  admin: SupabaseClient,
  templateCatalogIds: string[],
  activeOnly = false
): Promise<TemplatePageDefinitionRow[]> {
  if (templateCatalogIds.length === 0) return []
  let query = admin
    .from("template_page_definitions")
    .select("id, template_catalog_id, parent_page_key, slug_seed, title, icon, order_index, content_json, page_type, is_active")
    .in("template_catalog_id", templateCatalogIds)

  if (activeOnly) {
    query = query.eq("is_active", true)
  }

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as TemplatePageDefinitionRow[]
}

async function upsertTemplateReleaseHistory(params: {
  admin: SupabaseClient
  templateCatalogId: string
  version: string
  releaseNotes: string
  pages: TemplateSnapshotPage[]
  preview: TemplatePreviewPayload
}): Promise<void> {
  const { admin, templateCatalogId, version, releaseNotes, pages, preview } = params
  await admin.from("template_release_history").upsert(
    {
      template_catalog_id: templateCatalogId,
      version,
      release_notes: releaseNotes,
      page_snapshot_json: pages,
      preview_payload_json: preview,
    },
    { onConflict: "template_catalog_id,version" }
  )
}

export async function syncOfficialTemplateCatalog(admin: SupabaseClient): Promise<SyncResult> {
  const now = new Date().toISOString()
  await admin.from("template_catalog").upsert(
    OFFICIAL_TEMPLATE_CATALOG.map((template) => ({
      key: template.key,
      name: template.name,
      description: template.description,
      category: template.category,
      badge_json: template.badges,
      is_official: template.isOfficial,
      sort_order: template.sortOrder,
      preview_image_path: template.previewImagePath,
      version: template.version,
      status: template.status,
      integration_targets_json: template.integrationTargets,
      source_type: "official",
      owner_org_id: null,
      sharing_scope: "official",
      industry_tag: null,
      base_template_catalog_id: null,
      recommendation_json: template.recommendedTemplateKeys ?? [],
      preview_payload_json: buildTemplatePreviewPayload(template),
      release_notes: template.improvementText,
      updated_at: now,
    })),
    { onConflict: "key" }
  )

  const catalogRows = await loadTemplateCatalogRows(admin)
  const catalogByKey = new Map<string, TemplateCatalogRow>()
  for (const row of catalogRows) {
    if (OFFICIAL_TEMPLATE_CATALOG.some((template) => template.key === row.key)) {
      catalogByKey.set(row.key, row)
    }
  }

  const catalogIds = Array.from(catalogByKey.values()).map((row) => row.id)
  if (catalogIds.length > 0) {
    await admin.from("template_page_definitions").update({ is_active: false }).in("template_catalog_id", catalogIds)
  }

  const definitionUpserts = OFFICIAL_TEMPLATE_CATALOG.flatMap((template) => {
    const catalogRow = catalogByKey.get(template.key)
    if (!catalogRow) return []
    return template.pages.map((page) => ({
      template_catalog_id: catalogRow.id,
      parent_page_key: page.parentPageKey,
      slug_seed: page.slugSeed,
      title: page.title,
      icon: page.icon,
      order_index: page.orderIndex,
      content_json: page.content,
      page_type: page.pageType,
      is_active: true,
      updated_at: now,
    }))
  })

  if (definitionUpserts.length > 0) {
    await admin.from("template_page_definitions").upsert(definitionUpserts, {
      onConflict: "template_catalog_id,slug_seed",
    })
  }

  const definitionRows = await loadTemplateDefinitions(admin, catalogIds)
  const pageDefinitionByTemplateKey = new Map<string, Map<string, TemplatePageDefinitionRow>>()
  for (const template of OFFICIAL_TEMPLATE_CATALOG) {
    const catalogRow = catalogByKey.get(template.key)
    if (!catalogRow) continue
    const definitionMap = new Map<string, TemplatePageDefinitionRow>()
    for (const row of definitionRows) {
      if (row.template_catalog_id === catalogRow.id && row.is_active) {
        definitionMap.set(row.slug_seed, row)
      }
    }
    pageDefinitionByTemplateKey.set(template.key, definitionMap)

    await upsertTemplateReleaseHistory({
      admin,
      templateCatalogId: catalogRow.id,
      version: template.version,
      releaseNotes: template.improvementText,
      pages: buildTemplateSnapshotFromSeed(template),
      preview: buildTemplatePreviewPayload(template),
    })
  }

  return { catalogByKey, pageDefinitionByTemplateKey }
}

export async function getInstalledCountsByTemplateKey(
  admin: SupabaseClient,
  orgId: string,
  templateCatalogIds: string[]
): Promise<Map<string, number>> {
  if (templateCatalogIds.length === 0) return new Map()

  const { data, error } = await admin
    .from("org_template_installs")
    .select("template_catalog_id")
    .eq("org_id", orgId)
    .in("template_catalog_id", templateCatalogIds)

  if (error) throw error

  const countByCatalogId = new Map<string, number>()
  for (const row of (data ?? []) as Array<{ template_catalog_id: string }>) {
    countByCatalogId.set(row.template_catalog_id, (countByCatalogId.get(row.template_catalog_id) ?? 0) + 1)
  }
  return countByCatalogId
}

async function getTemplateCatalogWithDefinitions(params: {
  admin: SupabaseClient
  orgId: string
  templateKey: string
}): Promise<{
  catalog: TemplateCatalogRow
  definitions: TemplatePageDefinitionRow[]
  seed: OfficialTemplateCatalogSeed | null
}> {
  const { admin, orgId, templateKey } = params
  await syncOfficialTemplateCatalog(admin)

  const catalogRows = await loadTemplateCatalogRows(admin)
  const catalog = catalogRows.find((row) => row.key === templateKey) ?? null
  if (!catalog || !isTemplateAccessible(catalog, orgId)) {
    throw new Error(`Unknown template key: ${templateKey}`)
  }

  const definitions = (await loadTemplateDefinitions(admin, [catalog.id], true)).sort(
    (left, right) => left.order_index - right.order_index
  )
  const seed = OFFICIAL_TEMPLATE_CATALOG.find((row) => row.key === templateKey) ?? null
  return { catalog, definitions, seed }
}

async function getInstallWithTemplate(params: {
  admin: SupabaseClient
  orgId: string
  installId: string
}): Promise<{
  install: TemplateInstallRow
  catalog: TemplateCatalogRow
  definitions: TemplatePageDefinitionRow[]
}> {
  const { admin, orgId, installId } = params
  const { data: installData, error: installError } = await admin
    .from("org_template_installs")
    .select(
      "id, org_id, template_catalog_id, installed_by, installed_at, install_name, version, include_sample_content, group_under_root, root_page_id, install_status, failure_message, completed_at, last_synced_at, last_applied_version"
    )
    .eq("id", installId)
    .eq("org_id", orgId)
    .maybeSingle()

  if (installError || !installData) {
    throw installError ?? new Error(`Unknown install id: ${installId}`)
  }

  const install = installData as TemplateInstallRow
  const catalogRows = await loadTemplateCatalogRows(admin)
  const catalog = catalogRows.find((row) => row.id === install.template_catalog_id) ?? null
  if (!catalog) {
    throw new Error(`Unknown template catalog for install: ${installId}`)
  }

  const definitions = await loadTemplateDefinitions(admin, [catalog.id], true)
  return { install, catalog, definitions }
}

function buildInstallPageTitle(params: {
  installName: string
  definition: Pick<TemplatePageDefinitionRow, "title">
  rootSlugSeed: string
  definitionSlugSeed: string
  groupUnderRoot: boolean
}): string {
  const { installName, definition, rootSlugSeed, definitionSlugSeed, groupUnderRoot } = params
  if (definitionSlugSeed === rootSlugSeed) return installName
  return groupUnderRoot ? `${installName} / ${definition.title}` : definition.title
}

function resolveDisplayNameDuplicate(base: string, takenValues: Iterable<string>): string {
  const normalizedBase = base.trim() || "名称未設定"
  const taken = new Set(Array.from(takenValues, (value) => value.trim()).filter(Boolean))
  if (!taken.has(normalizedBase)) return normalizedBase
  let index = 2
  while (taken.has(`${normalizedBase} (${index})`)) {
    index += 1
  }
  return `${normalizedBase} (${index})`
}

async function finalizeQueuedInstall(params: {
  admin: SupabaseClient
  orgId: string
  userId: string
  installId: string
  selectedPageKeys?: string[]
}): Promise<{
  installId: string
  rootPageId: string
  createdPages: Array<{ id: string; title: string }>
  templateName: string
  templateKey: string
}> {
  const { admin, orgId, userId, installId } = params
  const { install, catalog, definitions: allDefinitions } = await getInstallWithTemplate({ admin, orgId, installId })
  const definitions = params.selectedPageKeys && params.selectedPageKeys.length > 0
    ? allDefinitions.filter((d) => params.selectedPageKeys!.includes(d.slug_seed))
    : allDefinitions

  if (parseInstallStatus(install.install_status) === "completed" && install.root_page_id) {
    const { data: existingPages, error: existingPagesError } = await admin
      .from("page_template_bindings")
      .select("page_id")
      .eq("install_id", installId)
    if (existingPagesError) throw existingPagesError

    const pageIds = (existingPages ?? []).map((row) => (row as { page_id: string }).page_id)
    const { data: pageRows, error: pageRowsError } = await admin.from("pages").select("id, title").in("id", pageIds)
    if (pageRowsError) throw pageRowsError

    return {
      installId,
      rootPageId: install.root_page_id,
      createdPages: (pageRows ?? []) as Array<{ id: string; title: string }>,
      templateName: catalog.name,
      templateKey: catalog.key,
    }
  }

  if (definitions.length === 0) {
    await admin
      .from("org_template_installs")
      .update({ install_status: "failed", failure_message: "Template has no active page definitions." })
      .eq("id", installId)
    throw new Error(`Template has no active page definitions: ${catalog.key}`)
  }

  const { data: existingPages, error: existingPagesError } = await admin
    .from("pages")
    .select("sort_order, slug, title")
    .eq("org_id", orgId)
    .order("sort_order", { ascending: false })

  if (existingPagesError) throw existingPagesError

  const nextBaseOrder =
    typeof (existingPages?.[0] as { sort_order?: number } | undefined)?.sort_order === "number"
      ? (((existingPages?.[0] as { sort_order: number }).sort_order ?? 0) + 100)
      : 0
  const takenSlugs = new Set(
    (existingPages ?? [])
      .map((row) => ((row as { slug?: string | null }).slug ?? "").trim())
      .filter(Boolean)
  )
  const takenTitles = new Set(
    (existingPages ?? [])
      .map((row) => ((row as { title?: string | null }).title ?? "").trim())
      .filter(Boolean)
  )

  const orderedDefinitions = [...definitions].sort((left, right) => left.order_index - right.order_index)
  const rootDefinition = orderedDefinitions.find((row) => row.parent_page_key === null) ?? orderedDefinitions[0]
  const createdPageIds: string[] = []
  const createdPages: Array<{ id: string; title: string }> = []
  let rootPageId: string | null = null

  try {
    for (const [index, definition] of orderedDefinitions.entries()) {
      const title = resolveDisplayNameDuplicate(
        buildInstallPageTitle({
          installName: install.install_name,
          definition,
          rootSlugSeed: rootDefinition.slug_seed,
          definitionSlugSeed: definition.slug_seed,
          groupUnderRoot: install.group_under_root,
        }),
        takenTitles
      )
      takenTitles.add(title)
      const content = install.include_sample_content
        ? applyTemplateReplacements(parseTemplateDocNode(definition.content_json), { "{{install_name}}": install.install_name })
        : buildBlankTemplateContent(title, definition.page_type)
      const bodyText = extractPlainTextFromTemplateDoc(content).trim() || null
      const baseSlug = titleToSlug(title)
      const slug = baseSlug ? resolveSlugDuplicate(baseSlug, Array.from(takenSlugs)) : null
      if (slug) takenSlugs.add(slug)

      const { data: pageRow, error: pageError } = await admin
        .from("pages")
        .insert({
          org_id: orgId,
          title,
          content,
          body_text: bodyText,
          sort_order: nextBaseOrder + index * 100,
          created_by: userId,
          updated_by: userId,
          slug,
          icon: definition.icon,
        })
        .select("id")
        .single()

      if (pageError || !pageRow) throw pageError ?? new Error("Failed to create page")

      const pageId = (pageRow as { id: string }).id
      if (definition.slug_seed === rootDefinition.slug_seed) {
        rootPageId = pageId
      }
      createdPageIds.push(pageId)
      createdPages.push({ id: pageId, title })

      const { error: bindingError } = await admin.from("page_template_bindings").insert({
        install_id: installId,
        org_id: orgId,
        page_id: pageId,
        template_catalog_id: catalog.id,
        template_page_definition_id: definition.id,
        is_customized: false,
      })
      if (bindingError) throw bindingError
    }

    await admin
      .from("org_template_installs")
      .update({
        install_status: "completed",
        root_page_id: rootPageId,
        completed_at: new Date().toISOString(),
        last_synced_at: new Date().toISOString(),
        last_applied_version: catalog.version,
        version: catalog.version,
        failure_message: null,
      })
      .eq("id", installId)
  } catch (error) {
    if (createdPageIds.length > 0) {
      await admin.from("pages").delete().in("id", createdPageIds)
    }
    await admin
      .from("org_template_installs")
      .update({
        install_status: "failed",
        failure_message: error instanceof Error ? error.message : "Template install failed",
      })
      .eq("id", installId)
    throw error
  }

  if (!rootPageId) {
    throw new Error(`Root page was not created for install: ${installId}`)
  }

  return {
    installId,
    rootPageId,
    createdPages,
    templateName: catalog.name,
    templateKey: catalog.key,
  }
}

export async function queueTemplateInstall(params: {
  admin: SupabaseClient
  orgId: string
  userId: string
  templateKey: string
  installName?: string
  includeSampleContent: boolean
  groupUnderRoot: boolean
}): Promise<{
  installId: string
  templateName: string
  templateKey: string
  pageCount: number
  installName: string
}> {
  const { admin, orgId, userId, templateKey, includeSampleContent, groupUnderRoot } = params
  const { catalog, definitions } = await getTemplateCatalogWithDefinitions({ admin, orgId, templateKey })
  const requestedInstallName = params.installName?.trim() || catalog.name
  const { data: existingInstalls, error: existingInstallError } = await admin
    .from("org_template_installs")
    .select("install_name")
    .eq("org_id", orgId)
  if (existingInstallError) throw existingInstallError
  const installName = resolveDisplayNameDuplicate(
    requestedInstallName,
    ((existingInstalls ?? []) as Array<{ install_name?: string | null }>).map((row) => row.install_name ?? "")
  )

  const { data: installRow, error: installError } = await admin
    .from("org_template_installs")
    .insert({
      org_id: orgId,
      template_catalog_id: catalog.id,
      installed_by: userId,
      install_name: installName,
      version: catalog.version,
      include_sample_content: includeSampleContent,
      group_under_root: groupUnderRoot,
      install_status: "pending",
    })
    .select("id")
    .single()

  if (installError || !installRow) {
    throw installError ?? new Error("Failed to queue template install")
  }

  return {
    installId: (installRow as { id: string }).id,
    templateName: catalog.name,
    templateKey: catalog.key,
    pageCount: definitions.length,
    installName,
  }
}

export async function installOfficialTemplate(params: {
  admin: SupabaseClient
  orgId: string
  userId: string
  templateKey: string
  installName?: string
  includeSampleContent: boolean
  groupUnderRoot: boolean
}): Promise<{
  installId: string
  rootPageId: string
  createdPages: Array<{ id: string; title: string }>
  template: OfficialTemplateCatalogSeed | null
}> {
  const queued = await queueTemplateInstall(params)
  const completed = await finalizeQueuedInstall({
    admin: params.admin,
    orgId: params.orgId,
    userId: params.userId,
    installId: queued.installId,
  })
  return {
    installId: completed.installId,
    rootPageId: completed.rootPageId,
    createdPages: completed.createdPages,
    template: OFFICIAL_TEMPLATE_CATALOG.find((item) => item.key === params.templateKey) ?? null,
  }
}

export async function runQueuedTemplateInstall(params: {
  admin: SupabaseClient
  orgId: string
  userId: string
  installId: string
  selectedPageKeys?: string[]
}): Promise<{
  installId: string
  rootPageId: string
  createdPages: Array<{ id: string; title: string }>
  templateName: string
  templateKey: string
}> {
  return finalizeQueuedInstall(params)
}

export async function deleteTemplateInstall(params: {
  admin: SupabaseClient
  orgId: string
  installId: string
}): Promise<void> {
  const { admin, orgId, installId } = params
  const { data: bindings, error: bindingError } = await admin
    .from("page_template_bindings")
    .select("page_id")
    .eq("install_id", installId)
    .eq("org_id", orgId)

  if (bindingError) throw bindingError

  const pageIds = (bindings ?? []).map((row) => (row as { page_id: string }).page_id)
  if (pageIds.length > 0) {
    const { error: deletePagesError } = await admin.from("pages").delete().in("id", pageIds).eq("org_id", orgId)
    if (deletePagesError) throw deletePagesError
  }

  const { error: deleteInstallError } = await admin
    .from("org_template_installs")
    .delete()
    .eq("id", installId)
    .eq("org_id", orgId)
  if (deleteInstallError) throw deleteInstallError
}

type InstallSnapshotRow = {
  page_id: string
  is_customized: boolean
  template_page_definition_id: string
}

async function loadInstallSnapshot(params: {
  admin: SupabaseClient
  orgId: string
  installId: string
}): Promise<{
  install: TemplateInstallRow
  catalog: TemplateCatalogRow
  definitions: TemplatePageDefinitionRow[]
  bindings: InstallSnapshotRow[]
  pages: Array<{ id: string; title: string; content: unknown }>
}> {
  const { admin, orgId, installId } = params
  const { install, catalog, definitions } = await getInstallWithTemplate({ admin, orgId, installId })

  const { data: bindingData, error: bindingError } = await admin
    .from("page_template_bindings")
    .select("page_id, is_customized, template_page_definition_id")
    .eq("install_id", installId)
    .eq("org_id", orgId)

  if (bindingError) throw bindingError

  const bindings = (bindingData ?? []) as InstallSnapshotRow[]
  const pageIds = bindings.map((binding) => binding.page_id)
  const { data: pageData, error: pageError } = await admin
    .from("pages")
    .select("id, title, content")
    .in("id", pageIds)
  if (pageError) throw pageError

  return {
    install,
    catalog,
    definitions,
    bindings,
    pages: (pageData ?? []) as Array<{ id: string; title: string; content: unknown }>,
  }
}

async function loadReleaseSnapshot(
  admin: SupabaseClient,
  templateCatalogId: string,
  version: string
): Promise<TemplateSnapshotPage[] | null> {
  const { data, error } = await admin
    .from("template_release_history")
    .select("page_snapshot_json")
    .eq("template_catalog_id", templateCatalogId)
    .eq("version", version)
    .maybeSingle()

  if (error) throw error
  const snapshot = (data as { page_snapshot_json?: unknown } | null)?.page_snapshot_json
  if (!Array.isArray(snapshot)) return null
  return (snapshot as TemplateSnapshotPage[]).map((page) => ({
    ...page,
    content: parseTemplateDocNode(page.content),
  }))
}

function buildDiffSummary(params: {
  templateKey: string
  templateName: string
  installId: string
  fromVersion: string
  toVersion: string
  beforePages: TemplateSnapshotPage[]
  afterPages: TemplateSnapshotPage[]
}): TemplateVersionDiffSummary {
  const beforeBySlug = new Map(params.beforePages.map((page) => [page.slugSeed, page]))
  const afterBySlug = new Map(params.afterPages.map((page) => [page.slugSeed, page]))
  const allSlugs = Array.from(new Set([...beforeBySlug.keys(), ...afterBySlug.keys()]))

  const pages: TemplateVersionDiffSummary["pages"] = []
  for (const slugSeed of allSlugs) {
    const before = beforeBySlug.get(slugSeed)
    const after = afterBySlug.get(slugSeed)
    if (!before && after) {
      pages.push({
        slugSeed,
        title: after.title,
        changeType: "added",
        beforeText: "",
        afterText: extractPlainTextFromTemplateDoc(after.content).replace(/\s+/g, " ").trim(),
      })
      continue
    }
    if (before && !after) {
      pages.push({
        slugSeed,
        title: before.title,
        changeType: "removed",
        beforeText: extractPlainTextFromTemplateDoc(before.content).replace(/\s+/g, " ").trim(),
        afterText: "",
      })
      continue
    }
    if (!before || !after) continue

    const beforeText = extractPlainTextFromTemplateDoc(before.content).replace(/\s+/g, " ").trim()
    const afterText = extractPlainTextFromTemplateDoc(after.content).replace(/\s+/g, " ").trim()
    if (before.title !== after.title || beforeText !== afterText) {
      pages.push({
        slugSeed,
        title: after.title,
        changeType: "changed",
        beforeText,
        afterText,
      })
    }
  }

  return {
    templateKey: params.templateKey,
    templateName: params.templateName,
    installId: params.installId,
    fromVersion: params.fromVersion,
    toVersion: params.toVersion,
    hasChanges: pages.length > 0,
    addedCount: pages.filter((page) => page.changeType === "added").length,
    changedCount: pages.filter((page) => page.changeType === "changed").length,
    removedCount: pages.filter((page) => page.changeType === "removed").length,
    pages: pages.slice(0, 24),
  }
}

export async function getTemplateVersionDiffForInstall(params: {
  admin: SupabaseClient
  orgId: string
  installId: string
}): Promise<TemplateVersionDiffSummary> {
  const { admin, orgId, installId } = params
  const { install, catalog, definitions } = await getInstallWithTemplate({ admin, orgId, installId })
  const fromVersion = install.last_applied_version ?? install.version
  const toVersion = catalog.version

  const beforePages =
    (await loadReleaseSnapshot(admin, catalog.id, fromVersion)) ?? buildTemplateSnapshotFromDefinitions(definitions)
  const afterPages = buildTemplateSnapshotFromDefinitions(definitions)

  return buildDiffSummary({
    templateKey: catalog.key,
    templateName: catalog.name,
    installId,
    fromVersion,
    toVersion,
    beforePages,
    afterPages,
  })
}

export async function applyTemplateUpdateToInstall(params: {
  admin: SupabaseClient
  orgId: string
  userId: string
  installId: string
}): Promise<{
  updatedCount: number
  addedCount: number
  skippedCustomizedCount: number
  retainedRemovedCount: number
  rootPageId: string | null
}> {
  const { admin, orgId, userId, installId } = params
  const { install, catalog, definitions, bindings, pages } = await loadInstallSnapshot({ admin, orgId, installId })

  const activeDefinitionBySlug = new Map(definitions.map((definition) => [definition.slug_seed, definition]))
  const oldDefinitions = await loadTemplateDefinitions(admin, [catalog.id], false)
  const oldDefinitionById = new Map(oldDefinitions.map((definition) => [definition.id, definition]))
  const pageById = new Map(pages.map((page) => [page.id, page]))
  const existingSlugSet = new Set<string>()

  let updatedCount = 0
  let addedCount = 0
  let skippedCustomizedCount = 0
  let retainedRemovedCount = 0

  for (const binding of bindings) {
    const oldDefinition = oldDefinitionById.get(binding.template_page_definition_id)
    const currentDefinition = oldDefinition ? activeDefinitionBySlug.get(oldDefinition.slug_seed) ?? null : null
    if (!currentDefinition) {
      retainedRemovedCount += 1
      continue
    }

    existingSlugSet.add(currentDefinition.slug_seed)
    if (binding.is_customized) {
      skippedCustomizedCount += 1
      continue
    }

    const page = pageById.get(binding.page_id)
    if (!page) continue

    const nextTitle = buildInstallPageTitle({
      installName: install.install_name,
      definition: currentDefinition,
      rootSlugSeed: (definitions.find((row) => row.parent_page_key === null) ?? definitions[0]).slug_seed,
      definitionSlugSeed: currentDefinition.slug_seed,
      groupUnderRoot: install.group_under_root,
    })
    const nextContent = install.include_sample_content
      ? applyTemplateReplacements(parseTemplateDocNode(currentDefinition.content_json), { "{{install_name}}": install.install_name })
      : buildBlankTemplateContent(nextTitle, currentDefinition.page_type)
    const nextBodyText = extractPlainTextFromTemplateDoc(nextContent).trim() || null

    const { error: pageError } = await admin
      .from("pages")
      .update({
        title: nextTitle,
        content: nextContent,
        body_text: nextBodyText,
        updated_by: userId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", page.id)
      .eq("org_id", orgId)
    if (pageError) throw pageError

    const { error: bindingError } = await admin
      .from("page_template_bindings")
      .update({
        template_page_definition_id: currentDefinition.id,
      })
      .eq("install_id", installId)
      .eq("page_id", page.id)
      .eq("org_id", orgId)
    if (bindingError) throw bindingError

    updatedCount += 1
  }

  const rootDefinition = definitions.find((row) => row.parent_page_key === null) ?? definitions[0]
  const { data: existingPages, error: existingPagesError } = await admin
    .from("pages")
    .select("sort_order, slug, title")
    .eq("org_id", orgId)
    .order("sort_order", { ascending: false })
  if (existingPagesError) throw existingPagesError

  const nextBaseOrder =
    typeof (existingPages?.[0] as { sort_order?: number } | undefined)?.sort_order === "number"
      ? (((existingPages?.[0] as { sort_order: number }).sort_order ?? 0) + 100)
      : 0
  const takenSlugs = new Set(
    (existingPages ?? [])
      .map((row) => ((row as { slug?: string | null }).slug ?? "").trim())
      .filter(Boolean)
  )
  const takenTitles = new Set(
    (existingPages ?? [])
      .map((row) => ((row as { title?: string | null }).title ?? "").trim())
      .filter(Boolean)
  )

  for (const definition of definitions.sort((left, right) => left.order_index - right.order_index)) {
    if (existingSlugSet.has(definition.slug_seed)) continue
    const title = resolveDisplayNameDuplicate(
      buildInstallPageTitle({
        installName: install.install_name,
        definition,
        rootSlugSeed: rootDefinition.slug_seed,
        definitionSlugSeed: definition.slug_seed,
        groupUnderRoot: install.group_under_root,
      }),
      takenTitles
    )
    takenTitles.add(title)
    const content = install.include_sample_content
      ? applyTemplateReplacements(parseTemplateDocNode(definition.content_json), { "{{install_name}}": install.install_name })
      : buildBlankTemplateContent(title, definition.page_type)
    const bodyText = extractPlainTextFromTemplateDoc(content).trim() || null
    const baseSlug = titleToSlug(title)
    const slug = baseSlug ? resolveSlugDuplicate(baseSlug, Array.from(takenSlugs)) : null
    if (slug) takenSlugs.add(slug)

    const { data: pageRow, error: pageError } = await admin
      .from("pages")
      .insert({
        org_id: orgId,
        title,
        content,
        body_text: bodyText,
        sort_order: nextBaseOrder + addedCount * 100,
        created_by: userId,
        updated_by: userId,
        slug,
        icon: definition.icon,
      })
      .select("id")
      .single()
    if (pageError || !pageRow) throw pageError ?? new Error("Failed to add page during template update")

    const pageId = (pageRow as { id: string }).id
    const { error: bindingError } = await admin.from("page_template_bindings").insert({
      install_id: installId,
      org_id: orgId,
      page_id: pageId,
      template_catalog_id: catalog.id,
      template_page_definition_id: definition.id,
      is_customized: false,
    })
    if (bindingError) throw bindingError
    addedCount += 1
  }

  await admin
    .from("org_template_installs")
    .update({
      version: catalog.version,
      last_applied_version: catalog.version,
      last_synced_at: new Date().toISOString(),
      install_status: "completed",
      failure_message: null,
    })
    .eq("id", installId)
    .eq("org_id", orgId)

  return {
    updatedCount,
    addedCount,
    skippedCustomizedCount,
    retainedRemovedCount,
    rootPageId: install.root_page_id,
  }
}

async function buildSharedTemplatePagesFromInstallSnapshot(params: {
  install: TemplateInstallRow
  bindings: InstallSnapshotRow[]
  pages: Array<{ id: string; title: string; content: unknown }>
  definitionById: Map<string, TemplatePageDefinitionRow>
}): Promise<TemplateSnapshotPage[]> {
  const { install, bindings, pages, definitionById } = params
  const pageById = new Map(pages.map((page) => [page.id, page]))
  const rows: TemplateSnapshotPage[] = []

  for (const binding of bindings) {
    const definition = definitionById.get(binding.template_page_definition_id)
    const page = pageById.get(binding.page_id)
    if (!definition || !page) continue

    const normalizedTitle =
      install.group_under_root && page.id !== install.root_page_id && page.title.startsWith(`${install.install_name} / `)
        ? page.title.slice(`${install.install_name} / `.length)
        : page.id === install.root_page_id
          ? install.install_name
          : page.title

    rows.push({
      key: definition.slug_seed,
      parentPageKey: definition.parent_page_key,
      slugSeed: definition.slug_seed,
      title: normalizedTitle,
      icon: definition.icon,
      orderIndex: definition.order_index,
      pageType: definition.page_type,
      content: parseTemplateDocNode(page.content),
    })
  }

  return rows.sort((left, right) => left.orderIndex - right.orderIndex)
}

async function persistSharedTemplateSnapshot(params: {
  admin: SupabaseClient
  orgId: string
  userId: string
  installId: string
  name: string
  description?: string
  sharingScope: Exclude<TemplateSharingScope, "official">
  industryTag?: string | null
  targetTemplateKey?: string | null
}): Promise<{
  templateKey: string
  templateName: string
  version: string
  created: boolean
}> {
  const { admin, orgId, installId, name, description, sharingScope, industryTag, targetTemplateKey } = params
  const snapshot = await loadInstallSnapshot({ admin, orgId, installId })
  const definitionById = new Map(
    (await loadTemplateDefinitions(admin, [snapshot.catalog.id], false)).map((definition) => [definition.id, definition])
  )
  const pages = await buildSharedTemplatePagesFromInstallSnapshot({
    install: snapshot.install,
    bindings: snapshot.bindings,
    pages: snapshot.pages,
    definitionById,
  })
  if (pages.length === 0) {
    throw new Error("Install has no pages to share")
  }

  const preview = normalizeTemplatePreview(
    {
      preview_payload_json: null,
      name,
      description: description?.trim() || snapshot.catalog.description,
    },
    pages
  )
  const takenKeys = (await loadTemplateCatalogRows(admin)).map((row) => row.key)
  const templateKey = targetTemplateKey?.trim() || dedupeTemplateKey(name, takenKeys)

  if (targetTemplateKey) {
    const target = (await loadTemplateCatalogRows(admin)).find((row) => row.key === targetTemplateKey) ?? null
    if (!target || target.owner_org_id !== orgId || parseSourceType(target.source_type) !== "shared") {
      throw new Error("Shared template update target is not available")
    }

    const nextVersion = bumpPatchVersion(target.version)
    await admin
      .from("template_catalog")
      .update({
        name,
        description: description?.trim() || target.description,
        category: snapshot.catalog.category,
        badge_json: parseStringArray(target.badge_json).length > 0 ? target.badge_json : ["共有テンプレ"],
        version: nextVersion,
        status: "active",
        integration_targets_json: parseStringArray(snapshot.catalog.integration_targets_json),
        sharing_scope: sharingScope,
        industry_tag: industryTag ?? null,
        preview_payload_json: preview,
        recommendation_json: parseStringArray(snapshot.catalog.recommendation_json),
        release_notes: `Updated from install ${snapshot.install.install_name}`,
        base_template_catalog_id: snapshot.catalog.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", target.id)

    await admin.from("template_page_definitions").update({ is_active: false }).eq("template_catalog_id", target.id)
    await admin.from("template_page_definitions").upsert(
      pages.map((page) => ({
        template_catalog_id: target.id,
        parent_page_key: page.parentPageKey,
        slug_seed: page.slugSeed,
        title: page.title,
        icon: page.icon,
        order_index: page.orderIndex,
        content_json: page.content,
        page_type: page.pageType,
        is_active: true,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "template_catalog_id,slug_seed" }
    )

    await upsertTemplateReleaseHistory({
      admin,
      templateCatalogId: target.id,
      version: nextVersion,
      releaseNotes: `Updated from install ${snapshot.install.install_name}`,
      pages,
      preview,
    })

    return { templateKey: target.key, templateName: name, version: nextVersion, created: false }
  }

  const { data: inserted, error: insertError } = await admin
    .from("template_catalog")
    .insert({
      key: templateKey,
      name,
      description: description?.trim() || snapshot.catalog.description,
      category: snapshot.catalog.category,
      badge_json: ["共有テンプレ"],
      is_official: false,
      sort_order: 900 + Math.floor(Date.now() / 1000),
      preview_image_path: null,
      version: "1.0.0",
      status: "active",
      integration_targets_json: parseStringArray(snapshot.catalog.integration_targets_json),
      source_type: "shared",
      owner_org_id: orgId,
      sharing_scope: sharingScope,
      industry_tag: industryTag ?? null,
      base_template_catalog_id: snapshot.catalog.id,
      recommendation_json: parseStringArray(snapshot.catalog.recommendation_json),
      preview_payload_json: preview,
      release_notes: `Created from install ${snapshot.install.install_name}`,
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single()

  if (insertError || !inserted) {
    throw insertError ?? new Error("Failed to create shared template")
  }

  const templateCatalogId = (inserted as { id: string }).id
  await admin.from("template_page_definitions").insert(
    pages.map((page) => ({
      template_catalog_id: templateCatalogId,
      parent_page_key: page.parentPageKey,
      slug_seed: page.slugSeed,
      title: page.title,
      icon: page.icon,
      order_index: page.orderIndex,
      content_json: page.content,
      page_type: page.pageType,
      is_active: true,
      updated_at: new Date().toISOString(),
    }))
  )

  await upsertTemplateReleaseHistory({
    admin,
    templateCatalogId,
    version: "1.0.0",
    releaseNotes: `Created from install ${snapshot.install.install_name}`,
    pages,
    preview,
  })

  return { templateKey, templateName: name, version: "1.0.0", created: true }
}

export async function shareTemplateInstall(params: {
  admin: SupabaseClient
  orgId: string
  userId: string
  installId: string
  name: string
  description?: string
  sharingScope: Exclude<TemplateSharingScope, "official">
  industryTag?: string | null
  targetTemplateKey?: string | null
}): Promise<{
  templateKey: string
  templateName: string
  version: string
  created: boolean
}> {
  return persistSharedTemplateSnapshot(params)
}

export async function setTemplateCatalogStatus(params: {
  admin: SupabaseClient
  orgId: string
  templateKey: string
  status: "active" | "archived"
}): Promise<void> {
  const { admin, orgId, templateKey, status } = params
  const catalogRows = await loadTemplateCatalogRows(admin)
  const target = catalogRows.find((row) => row.key === templateKey) ?? null
  if (!target || target.owner_org_id !== orgId || parseSourceType(target.source_type) !== "shared") {
    throw new Error("Shared template is not available")
  }

  const { error } = await admin
    .from("template_catalog")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", target.id)
  if (error) throw error
}

export async function listAccessibleTemplateCatalog(params: {
  admin: SupabaseClient
  orgId: string
}): Promise<TemplateCatalogListItem[]> {
  const { admin, orgId } = params
  await syncOfficialTemplateCatalog(admin)

  const catalogRows = (await loadTemplateCatalogRows(admin))
    .filter((row) => isTemplateAccessible(row, orgId))
    .sort((left, right) => {
      const leftSource = parseSourceType(left.source_type)
      const rightSource = parseSourceType(right.source_type)
      if (leftSource !== rightSource) return leftSource === "official" ? -1 : 1
      if (left.status !== right.status) return left.status === "active" ? -1 : 1
      return left.sort_order - right.sort_order
    })

  const catalogIds = catalogRows.map((row) => row.id)
  const definitionRows = await loadTemplateDefinitions(admin, catalogIds, true)
  const definitionsByCatalogId = new Map<string, TemplatePageDefinitionRow[]>()
  for (const row of definitionRows) {
    const current = definitionsByCatalogId.get(row.template_catalog_id) ?? []
    current.push(row)
    definitionsByCatalogId.set(row.template_catalog_id, current)
  }

  const { data: installData, error: installError } = await admin
    .from("org_template_installs")
    .select(
      "id, org_id, template_catalog_id, installed_by, installed_at, install_name, version, include_sample_content, group_under_root, root_page_id, install_status, failure_message, completed_at, last_synced_at, last_applied_version"
    )
    .eq("org_id", orgId)
    .in("template_catalog_id", catalogIds)

  if (installError) throw installError
  const installs = (installData ?? []) as TemplateInstallRow[]
  const installIds = installs.map((install) => install.id)

  const { data: bindingData, error: bindingError } = await admin
    .from("page_template_bindings")
    .select("install_id")
    .in("install_id", installIds.length > 0 ? installIds : ["00000000-0000-0000-0000-000000000000"])

  if (bindingError && installIds.length > 0) throw bindingError

  const bindingCountByInstallId = new Map<string, number>()
  for (const row of (bindingData ?? []) as Array<{ install_id: string }>) {
    bindingCountByInstallId.set(row.install_id, (bindingCountByInstallId.get(row.install_id) ?? 0) + 1)
  }

  const installsByCatalogId = new Map<string, TemplateInstallSummary[]>()
  for (const install of installs) {
    const catalog = catalogRows.find((row) => row.id === install.template_catalog_id)
    if (!catalog) continue
    const summary: TemplateInstallSummary = {
      installId: install.id,
      installName: install.install_name,
      installedAt: install.installed_at,
      version: install.last_applied_version ?? install.version,
      status: parseInstallStatus(install.install_status),
      rootPageId: install.root_page_id,
      pageCount: bindingCountByInstallId.get(install.id) ?? 0,
      updateAvailable: compareVersions(catalog.version, install.last_applied_version ?? install.version) > 0,
      latestVersion: catalog.version,
      failureMessage: install.failure_message,
      groupUnderRoot: install.group_under_root,
    }
    const current = installsByCatalogId.get(install.template_catalog_id) ?? []
    current.push(summary)
    installsByCatalogId.set(install.template_catalog_id, current)
  }

  return catalogRows.map((catalog) => {
    const definitions = [...(definitionsByCatalogId.get(catalog.id) ?? [])].sort(
      (left, right) => left.order_index - right.order_index
    )
    const pages = buildTemplateSnapshotFromDefinitions(definitions)
    const installsForTemplate = (installsByCatalogId.get(catalog.id) ?? []).sort((left, right) =>
      right.installedAt.localeCompare(left.installedAt)
    )
    return {
      id: catalog.id,
      key: catalog.key,
      name: catalog.name,
      description: catalog.description,
      improvementText: catalog.release_notes?.trim() || catalog.description,
      category: catalog.category,
      badges: parseStringArray(catalog.badge_json),
      isOfficial: catalog.is_official,
      sourceType: parseSourceType(catalog.source_type),
      sharingScope: parseSharingScope(catalog.sharing_scope, catalog.is_official),
      industryTag: catalog.industry_tag,
      version: catalog.version,
      status: catalog.status,
      integrationTargets: parseStringArray(catalog.integration_targets_json),
      previewImagePath: catalog.preview_image_path,
      preview: normalizeTemplatePreview(catalog, pages),
      pageCount: pages.length,
      installedCount: installsForTemplate.length,
      recommendationKeys: parseStringArray(catalog.recommendation_json),
      installs: installsForTemplate,
      pages: pages.map((page) => ({
        key: page.key,
        title: page.title,
        pageType: page.pageType,
        parentPageKey: page.parentPageKey,
        orderIndex: page.orderIndex,
        icon: page.icon,
      })),
      canManage: !catalog.is_official && catalog.owner_org_id === orgId,
    }
  })
}

export async function loadPageTemplateBindings(
  admin: SupabaseClient,
  orgId: string,
  pageIds: string[]
): Promise<Map<string, PageTemplateBindingInfo>> {
  if (pageIds.length === 0) return new Map()

  const { data: bindingRows, error: bindingError } = await admin
    .from("page_template_bindings")
    .select("page_id, install_id, template_catalog_id, template_page_definition_id, is_customized")
    .eq("org_id", orgId)
    .in("page_id", pageIds)

  if (bindingError || !bindingRows || bindingRows.length === 0) return new Map()

  const templateCatalogIds = Array.from(
    new Set(bindingRows.map((row) => (row as { template_catalog_id: string }).template_catalog_id))
  )
  const definitionIds = Array.from(
    new Set(bindingRows.map((row) => (row as { template_page_definition_id: string }).template_page_definition_id))
  )
  const installIds = Array.from(new Set(bindingRows.map((row) => (row as { install_id: string }).install_id)))

  const [{ data: catalogs }, { data: definitions }, { data: installs }] = await Promise.all([
    admin
      .from("template_catalog")
      .select(
        "id, key, name, category, badge_json, integration_targets_json, version, source_type, sharing_scope, industry_tag"
      )
      .in("id", templateCatalogIds),
    admin.from("template_page_definitions").select("id, title, page_type").in("id", definitionIds),
    admin
      .from("org_template_installs")
      .select(
        "id, install_name, version, last_applied_version, root_page_id, group_under_root, install_status, installed_at"
      )
      .in("id", installIds),
  ])

  const catalogById = new Map(
    ((catalogs ?? []) as Array<{
      id: string
      key: string
      name: string
      category: string
      badge_json: unknown
      integration_targets_json: unknown
      version: string
      source_type: string | null
      sharing_scope: string | null
      industry_tag: string | null
    }>).map((row) => [row.id, row])
  )
  const definitionById = new Map(
    ((definitions ?? []) as Array<{ id: string; title: string; page_type: TemplatePageType }>).map((row) => [row.id, row])
  )
  const installById = new Map(
    ((installs ?? []) as Array<{
      id: string
      install_name: string
      version: string
      last_applied_version: string | null
      root_page_id: string | null
      group_under_root: boolean
      install_status: string
      installed_at: string
    }>).map((row) => [row.id, row])
  )

  const map = new Map<string, PageTemplateBindingInfo>()
  for (const rawRow of bindingRows as Array<{
    page_id: string
    install_id: string
    template_catalog_id: string
    template_page_definition_id: string
    is_customized: boolean
  }>) {
    const catalog = catalogById.get(rawRow.template_catalog_id)
    const definition = definitionById.get(rawRow.template_page_definition_id)
    const install = installById.get(rawRow.install_id)
    if (!catalog || !definition || !install) continue

    const currentVersion = install.last_applied_version ?? install.version
    map.set(rawRow.page_id, {
      installId: rawRow.install_id,
      installName: install.install_name,
      templateKey: catalog.key,
      templateName: catalog.name,
      templateCategory: catalog.category,
      templateBadges: parseStringArray(catalog.badge_json),
      integrationTargets: parseStringArray(catalog.integration_targets_json),
      templatePageTitle: definition.title,
      pageType: definition.page_type,
      isCustomized: Boolean(rawRow.is_customized),
      templateVersion: currentVersion,
      latestVersion: catalog.version,
      updateAvailable: compareVersions(catalog.version, currentVersion) > 0,
      installStatus: parseInstallStatus(install.install_status),
      installedAt: install.installed_at,
      rootPageId: install.root_page_id,
      groupUnderRoot: install.group_under_root,
      templateSourceType: parseSourceType(catalog.source_type),
      sharingScope: parseSharingScope(catalog.sharing_scope, false),
      industryTag: catalog.industry_tag,
    })
  }

  return map
}
