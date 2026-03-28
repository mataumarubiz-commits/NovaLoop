export const SERVICE_CATEGORY_OPTIONS = [
  { value: "video_editing", label: "動画編集" },
  { value: "sns_ops", label: "SNS運用" },
  { value: "casting", label: "キャスティング" },
  { value: "website", label: "サイト制作" },
  { value: "live2d", label: "Live2D" },
  { value: "other", label: "その他" },
] as const

export const BILLING_MODEL_OPTIONS = [
  { value: "monthly_fixed", label: "月額固定" },
  { value: "per_unit", label: "本数従量" },
  { value: "project_fixed", label: "案件一式" },
  { value: "add_on", label: "オプション" },
] as const

export const UNIT_TYPE_OPTIONS = [
  { value: "month", label: "月" },
  { value: "video", label: "本" },
  { value: "short", label: "本" },
  { value: "project", label: "件" },
  { value: "person", label: "人" },
  { value: "asset", label: "枚" },
  { value: "page", label: "枚" },
  { value: "deliverable", label: "件" },
  { value: "hour", label: "時間" },
] as const

export const WORK_ITEM_ADD_TYPE_OPTIONS = [
  {
    value: "monthly_fixed",
    label: "月額固定を追加",
    description: "毎月同じ内容を請求する運用・保守向けです。",
  },
  {
    value: "extra_production",
    label: "追加制作を登録",
    description: "本数や枚数で増える追加制作を登録します。",
  },
  {
    value: "one_time_project",
    label: "単発案件を登録",
    description: "LP制作やLive2Dなど一式請求の案件向けです。",
  },
  {
    value: "vendor_invoice",
    label: "外注請求を登録",
    description: "テンプレにない臨時費用や代理手配費をまとめます。",
  },
] as const

export const LYCOLLECTION_INITIAL_STATUS_OPTIONS = [
  { value: "billable", label: "請求対象", order: 1 },
  { value: "operating", label: "進行中", order: 2 },
  { value: "delivered", label: "納品完了", order: 3 },
  { value: "invoiced", label: "請求済み", order: 4 },
] as const

export type ServiceCategory = (typeof SERVICE_CATEGORY_OPTIONS)[number]["value"]
export type BillingModel = (typeof BILLING_MODEL_OPTIONS)[number]["value"]
export type UnitType = (typeof UNIT_TYPE_OPTIONS)[number]["value"]
export type WorkItemAddType = (typeof WORK_ITEM_ADD_TYPE_OPTIONS)[number]["value"]

export type WorkflowTemplateStatus = {
  key: string
  label: string
  order: number
}

export type WorkflowTemplateSeed = {
  key: string
  name: string
  serviceCategory: ServiceCategory
  isDefault?: boolean
  statuses: WorkflowTemplateStatus[]
}

export type ServiceCatalogSeed = {
  name: string
  serviceCategory: ServiceCategory
  billingModel: BillingModel
  unitType: UnitType
  defaultUnitPrice: number
  defaultQuantity?: number
  workflowTemplateKey: string
  metadataJson?: Record<string, unknown>
}

export type DemoWorkItemSeed = {
  clientName: string
  projectName: string
  serviceName: string
  serviceCategory: ServiceCategory
  billingModel: BillingModel
  unitType: UnitType
  quantity: number
  unitPrice: number
  status: string
  deliveryMonth: string
  title?: string
  workflowTemplateKey: string
  externalRef: string
  metadataJson?: Record<string, unknown>
}

type TitleBuildInput = {
  serviceName: string
  billingModel: BillingModel
  unitType: UnitType
  quantity: number
  targetMonth?: string | null
}

type AddTypeDefaults = {
  serviceCategory: ServiceCategory
  billingModel: BillingModel
  unitType: UnitType
  workflowTemplateKey: string
  defaultQuantity: number
  defaultStatus: string
}

function buildGuidedStatuses(): WorkflowTemplateStatus[] {
  return LYCOLLECTION_INITIAL_STATUS_OPTIONS.map((status) => ({
    key: status.value,
    label: status.label,
    order: status.order,
  }))
}

export const WORKFLOW_TEMPLATE_SEEDS: WorkflowTemplateSeed[] = [
  {
    key: "video_editing",
    name: "追加制作",
    serviceCategory: "video_editing",
    isDefault: true,
    statuses: buildGuidedStatuses(),
  },
  {
    key: "sns_ops_monthly",
    name: "月額運用",
    serviceCategory: "sns_ops",
    isDefault: true,
    statuses: buildGuidedStatuses(),
  },
  {
    key: "casting",
    name: "キャスティング案件",
    serviceCategory: "casting",
    isDefault: true,
    statuses: buildGuidedStatuses(),
  },
  {
    key: "website",
    name: "制作案件",
    serviceCategory: "website",
    isDefault: true,
    statuses: buildGuidedStatuses(),
  },
  {
    key: "website_maintenance",
    name: "保守運用",
    serviceCategory: "website",
    statuses: buildGuidedStatuses(),
  },
  {
    key: "live2d",
    name: "Live2D案件",
    serviceCategory: "live2d",
    isDefault: true,
    statuses: buildGuidedStatuses(),
  },
  {
    key: "vendor_support",
    name: "外注・臨時費用",
    serviceCategory: "other",
    isDefault: true,
    statuses: buildGuidedStatuses(),
  },
]

export const SERVICE_CATALOG_SEEDS: ServiceCatalogSeed[] = [
  {
    name: "YouTubeチャンネル運用",
    serviceCategory: "sns_ops",
    billingModel: "monthly_fixed",
    unitType: "month",
    defaultUnitPrice: 600000,
    workflowTemplateKey: "sns_ops_monthly",
    metadataJson: { addType: "monthly_fixed", defaultStatus: "billable" },
  },
  {
    name: "TikTok運用",
    serviceCategory: "sns_ops",
    billingModel: "monthly_fixed",
    unitType: "month",
    defaultUnitPrice: 300000,
    workflowTemplateKey: "sns_ops_monthly",
    metadataJson: { addType: "monthly_fixed", defaultStatus: "billable" },
  },
  {
    name: "Instagram運用",
    serviceCategory: "sns_ops",
    billingModel: "monthly_fixed",
    unitType: "month",
    defaultUnitPrice: 300000,
    workflowTemplateKey: "sns_ops_monthly",
    metadataJson: { addType: "monthly_fixed", defaultStatus: "billable" },
  },
  {
    name: "Shorts追加制作",
    serviceCategory: "video_editing",
    billingModel: "per_unit",
    unitType: "short",
    defaultUnitPrice: 5000,
    workflowTemplateKey: "video_editing",
    metadataJson: { addType: "extra_production", defaultStatus: "billable" },
  },
  {
    name: "YouTube通常動画編集",
    serviceCategory: "video_editing",
    billingModel: "per_unit",
    unitType: "video",
    defaultUnitPrice: 30000,
    workflowTemplateKey: "video_editing",
    metadataJson: { addType: "extra_production", defaultStatus: "billable" },
  },
  {
    name: "サムネイル制作",
    serviceCategory: "video_editing",
    billingModel: "add_on",
    unitType: "asset",
    defaultUnitPrice: 5000,
    workflowTemplateKey: "video_editing",
    metadataJson: { addType: "extra_production", defaultStatus: "billable" },
  },
  {
    name: "LP制作",
    serviceCategory: "website",
    billingModel: "project_fixed",
    unitType: "project",
    defaultUnitPrice: 200000,
    workflowTemplateKey: "website",
    metadataJson: { addType: "one_time_project", defaultStatus: "billable" },
  },
  {
    name: "キャスティング案件",
    serviceCategory: "casting",
    billingModel: "project_fixed",
    unitType: "project",
    defaultUnitPrice: 250000,
    workflowTemplateKey: "casting",
    metadataJson: { addType: "one_time_project", defaultStatus: "billable" },
  },
  {
    name: "Live2Dモデル制作",
    serviceCategory: "live2d",
    billingModel: "project_fixed",
    unitType: "project",
    defaultUnitPrice: 400000,
    workflowTemplateKey: "live2d",
    metadataJson: { addType: "one_time_project", defaultStatus: "billable" },
  },
  {
    name: "保守運用",
    serviceCategory: "website",
    billingModel: "monthly_fixed",
    unitType: "month",
    defaultUnitPrice: 30000,
    workflowTemplateKey: "website_maintenance",
    metadataJson: { addType: "monthly_fixed", defaultStatus: "billable" },
  },
]

export const LYCOLLECTION_DEMO_WORK_ITEMS: DemoWorkItemSeed[] = [
  {
    clientName: "A社",
    projectName: "YouTube運用",
    serviceName: "YouTubeチャンネル運用",
    serviceCategory: "sns_ops",
    billingModel: "monthly_fixed",
    unitType: "month",
    quantity: 1,
    unitPrice: 600000,
    status: "billable",
    deliveryMonth: "2026-03",
    title: "2026-03 YouTubeチャンネル運用",
    workflowTemplateKey: "sns_ops_monthly",
    externalRef: "lycollection-demo:a-youtube-ops-2026-03",
  },
  {
    clientName: "A社",
    projectName: "Shorts追加",
    serviceName: "Shorts追加制作",
    serviceCategory: "video_editing",
    billingModel: "per_unit",
    unitType: "short",
    quantity: 12,
    unitPrice: 5000,
    status: "billable",
    deliveryMonth: "2026-03",
    title: "Shorts追加制作 12本",
    workflowTemplateKey: "video_editing",
    externalRef: "lycollection-demo:a-shorts-addon-2026-03",
  },
  {
    clientName: "B社",
    projectName: "YouTube編集",
    serviceName: "YouTube通常動画編集",
    serviceCategory: "video_editing",
    billingModel: "per_unit",
    unitType: "video",
    quantity: 4,
    unitPrice: 30000,
    status: "billable",
    deliveryMonth: "2026-03",
    title: "YouTube通常動画編集 4本",
    workflowTemplateKey: "video_editing",
    externalRef: "lycollection-demo:b-video-editing-2026-03",
  },
  {
    clientName: "B社",
    projectName: "オプション制作",
    serviceName: "サムネイル制作",
    serviceCategory: "video_editing",
    billingModel: "add_on",
    unitType: "asset",
    quantity: 4,
    unitPrice: 5000,
    status: "billable",
    deliveryMonth: "2026-03",
    title: "サムネイル制作 4枚",
    workflowTemplateKey: "video_editing",
    externalRef: "lycollection-demo:b-thumbnail-2026-03",
  },
  {
    clientName: "C社",
    projectName: "キャスティング",
    serviceName: "キャスティング案件",
    serviceCategory: "casting",
    billingModel: "project_fixed",
    unitType: "project",
    quantity: 1,
    unitPrice: 250000,
    status: "billable",
    deliveryMonth: "2026-03",
    title: "キャスティング案件一式",
    workflowTemplateKey: "casting",
    externalRef: "lycollection-demo:c-casting-project-2026-03",
  },
  {
    clientName: "D社",
    projectName: "LPリニューアル",
    serviceName: "LP制作",
    serviceCategory: "website",
    billingModel: "project_fixed",
    unitType: "project",
    quantity: 1,
    unitPrice: 200000,
    status: "billable",
    deliveryMonth: "2026-03",
    title: "LP制作一式",
    workflowTemplateKey: "website",
    externalRef: "lycollection-demo:d-lp-2026-03",
  },
  {
    clientName: "E社",
    projectName: "VTuber立ち上げ",
    serviceName: "Live2Dモデル制作",
    serviceCategory: "live2d",
    billingModel: "project_fixed",
    unitType: "project",
    quantity: 1,
    unitPrice: 400000,
    status: "operating",
    deliveryMonth: "2026-03",
    title: "Live2Dモデル制作一式",
    workflowTemplateKey: "live2d",
    externalRef: "lycollection-demo:e-live2d-model-2026-03",
  },
  {
    clientName: "F社",
    projectName: "Web保守",
    serviceName: "保守運用",
    serviceCategory: "website",
    billingModel: "monthly_fixed",
    unitType: "month",
    quantity: 1,
    unitPrice: 30000,
    status: "billable",
    deliveryMonth: "2026-03",
    title: "2026-03 保守運用",
    workflowTemplateKey: "website_maintenance",
    externalRef: "lycollection-demo:f-maintenance-2026-03",
  },
]

const BILLABLE_STATUS_SET = new Set(["delivered", "approved", "completed", "billable", "published", "launched"])
const MONTHLY_FIXED_EXTRA_STATUS_SET = new Set(["operating"])

export function calculateWorkItemAmount(quantity: number, unitPrice: number) {
  return Number(quantity || 0) * Number(unitPrice || 0)
}

export function getServiceCategoryLabel(value?: string | null) {
  return SERVICE_CATEGORY_OPTIONS.find((option) => option.value === value)?.label ?? (value || "未設定")
}

export function getBillingModelLabel(value?: string | null) {
  return BILLING_MODEL_OPTIONS.find((option) => option.value === value)?.label ?? (value || "未設定")
}

export function getUnitTypeLabel(value?: string | null) {
  return UNIT_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? (value || "未設定")
}

export function getAddTypeLabel(value?: string | null) {
  return WORK_ITEM_ADD_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? (value || "未設定")
}

export function getStatusGroupForServiceCategory(serviceCategory?: string | null) {
  switch (serviceCategory) {
    case "video_editing":
      return "video"
    case "sns_ops":
      return "ops"
    case "casting":
      return "casting"
    case "website":
      return "website"
    case "live2d":
      return "live2d"
    default:
      return "other"
  }
}

export function getSuggestedDueEditorAt(serviceCategory: string | null | undefined, dueClientAt: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueClientAt)) return dueClientAt
  const base = new Date(`${dueClientAt}T00:00:00`)
  if (serviceCategory === "video_editing") {
    base.setDate(base.getDate() - 3)
  }
  return base.toISOString().slice(0, 10)
}

export function getMonthEndDate(ym: string) {
  if (!/^\d{4}-\d{2}$/.test(ym)) return ""
  const [year, month] = ym.split("-").map(Number)
  return new Date(year, month, 0).toISOString().slice(0, 10)
}

export function normalizeWorkItemMonth(targetMonth?: string | null, dueClientAt?: string | null) {
  if (typeof targetMonth === "string" && /^\d{4}-\d{2}$/.test(targetMonth)) return targetMonth
  if (typeof dueClientAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dueClientAt)) return dueClientAt.slice(0, 7)
  return ""
}

export function isBillableWorkItemStatus(status?: string | null, billingModel?: string | null) {
  const normalized = typeof status === "string" ? status.trim() : ""
  if (!normalized) return false
  if (BILLABLE_STATUS_SET.has(normalized)) return true
  if (billingModel === "monthly_fixed" && MONTHLY_FIXED_EXTRA_STATUS_SET.has(normalized)) return true
  return false
}

export function buildWorkItemDescription(serviceName?: string | null, title?: string | null, projectName?: string | null) {
  const cleanServiceName = serviceName?.trim() ?? ""
  const cleanTitle = title?.trim() ?? ""
  const cleanProjectName = projectName?.trim() ?? ""

  if (cleanServiceName && cleanTitle && cleanServiceName !== cleanTitle) {
    return `${cleanServiceName} / ${cleanTitle}`
  }
  if (cleanServiceName) return cleanServiceName
  if (cleanTitle) return cleanTitle
  if (cleanProjectName) return cleanProjectName
  return "作業費"
}

export function getAddTypeDefaults(addType: WorkItemAddType): AddTypeDefaults {
  switch (addType) {
    case "monthly_fixed":
      return {
        serviceCategory: "sns_ops",
        billingModel: "monthly_fixed",
        unitType: "month",
        workflowTemplateKey: "sns_ops_monthly",
        defaultQuantity: 1,
        defaultStatus: "billable",
      }
    case "extra_production":
      return {
        serviceCategory: "video_editing",
        billingModel: "per_unit",
        unitType: "video",
        workflowTemplateKey: "video_editing",
        defaultQuantity: 1,
        defaultStatus: "billable",
      }
    case "one_time_project":
      return {
        serviceCategory: "website",
        billingModel: "project_fixed",
        unitType: "project",
        workflowTemplateKey: "website",
        defaultQuantity: 1,
        defaultStatus: "billable",
      }
    case "vendor_invoice":
      return {
        serviceCategory: "other",
        billingModel: "add_on",
        unitType: "project",
        workflowTemplateKey: "vendor_support",
        defaultQuantity: 1,
        defaultStatus: "billable",
      }
  }
}

export function getCatalogMetadata(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  return raw as Record<string, unknown>
}

export function getCatalogAddType(
  metadata: unknown,
  billingModel?: BillingModel | string | null,
  serviceCategory?: ServiceCategory | string | null
): WorkItemAddType {
  const explicit = getCatalogMetadata(metadata).addType
  if (
    explicit === "monthly_fixed" ||
    explicit === "extra_production" ||
    explicit === "one_time_project" ||
    explicit === "vendor_invoice"
  ) {
    return explicit
  }
  if (billingModel === "monthly_fixed") return "monthly_fixed"
  if (billingModel === "project_fixed") return "one_time_project"
  if (serviceCategory === "other") return "vendor_invoice"
  return "extra_production"
}

export function getCatalogDefaultStatus(metadata: unknown) {
  const explicit = getCatalogMetadata(metadata).defaultStatus
  return typeof explicit === "string" && explicit.trim() ? explicit.trim() : "billable"
}

export function getStatusLabel(value?: string | null) {
  return LYCOLLECTION_INITIAL_STATUS_OPTIONS.find((option) => option.value === value)?.label ?? (value || "未設定")
}

function formatTitleQuantity(quantity: number) {
  if (Number.isInteger(quantity)) return String(quantity)
  return new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 }).format(quantity)
}

export function buildSuggestedWorkItemTitle(input: TitleBuildInput) {
  const serviceName = input.serviceName.trim()
  if (!serviceName) return ""

  if (input.billingModel === "monthly_fixed") {
    return input.targetMonth ? `${input.targetMonth} ${serviceName}` : serviceName
  }

  if (input.billingModel === "project_fixed") {
    return `${serviceName}一式`
  }

  const quantity = Number(input.quantity || 0)
  const unitLabel = getUnitTypeLabel(input.unitType)
  if (quantity > 0) {
    return `${serviceName} ${formatTitleQuantity(quantity)}${unitLabel}`
  }

  return serviceName
}
