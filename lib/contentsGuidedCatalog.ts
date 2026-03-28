export type GuidedAddType =
  | "monthly_fixed"
  | "extra_production"
  | "one_time_project"
  | "vendor_invoice"

export type GuidedBillingModel = "monthly_fixed" | "per_unit" | "project_fixed" | "add_on"
export type GuidedUnitType = "month" | "video" | "short" | "project" | "person" | "asset"
export type GuidedStatus = "billable" | "operating" | "delivered" | "invoiced"
export type GuidedServiceCategory = "sns_ops" | "video_editing" | "website" | "casting" | "live2d" | "other"

export type GuidedAddTypeOption = {
  value: GuidedAddType
  label: string
  description: string
}

export type GuidedStatusOption = {
  value: GuidedStatus
  label: string
}

export type GuidedTemplate = {
  id: string
  name: string
  addType: GuidedAddType
  billingModel: GuidedBillingModel
  unitType: GuidedUnitType
  serviceCategory: GuidedServiceCategory
  defaultUnitPrice: number
  defaultQuantity: number
  defaultStatus: GuidedStatus
}

export const GUIDED_ADD_TYPE_OPTIONS: GuidedAddTypeOption[] = [
  {
    value: "monthly_fixed",
    label: "月額固定を追加",
    description: "毎月の運用費をそのまま請求対象へ入れます。",
  },
  {
    value: "extra_production",
    label: "追加制作を登録",
    description: "本数や枚数で増えた追加分だけを登録します。",
  },
  {
    value: "one_time_project",
    label: "単発案件を登録",
    description: "LPやキャスティングなど一式請求の案件を登録します。",
  },
  {
    value: "vendor_invoice",
    label: "外注請求を登録",
    description: "MVPでは専用導線へ案内し、contents には混ぜません。",
  },
]

export const GUIDED_STATUS_OPTIONS: GuidedStatusOption[] = [
  { value: "billable", label: "請求対象" },
  { value: "operating", label: "進行中" },
  { value: "delivered", label: "納品完了" },
  { value: "invoiced", label: "請求済み" },
]

export const GUIDED_BILLING_MODEL_LABELS: Record<GuidedBillingModel, string> = {
  monthly_fixed: "月額固定",
  per_unit: "本数従量",
  project_fixed: "案件一式",
  add_on: "オプション",
}

export const GUIDED_UNIT_LABELS: Record<GuidedUnitType, string> = {
  month: "月",
  video: "本",
  short: "本",
  project: "件",
  person: "人",
  asset: "枚",
}

export const GUIDED_TEMPLATES: GuidedTemplate[] = [
  {
    id: "youtube-ops",
    name: "YouTubeチャンネル運用",
    addType: "monthly_fixed",
    billingModel: "monthly_fixed",
    unitType: "month",
    serviceCategory: "sns_ops",
    defaultUnitPrice: 600000,
    defaultQuantity: 1,
    defaultStatus: "billable",
  },
  {
    id: "tiktok-ops",
    name: "TikTok運用",
    addType: "monthly_fixed",
    billingModel: "monthly_fixed",
    unitType: "month",
    serviceCategory: "sns_ops",
    defaultUnitPrice: 300000,
    defaultQuantity: 1,
    defaultStatus: "billable",
  },
  {
    id: "instagram-ops",
    name: "Instagram運用",
    addType: "monthly_fixed",
    billingModel: "monthly_fixed",
    unitType: "month",
    serviceCategory: "sns_ops",
    defaultUnitPrice: 300000,
    defaultQuantity: 1,
    defaultStatus: "billable",
  },
  {
    id: "shorts-extra",
    name: "Shorts追加制作",
    addType: "extra_production",
    billingModel: "per_unit",
    unitType: "short",
    serviceCategory: "video_editing",
    defaultUnitPrice: 5000,
    defaultQuantity: 1,
    defaultStatus: "billable",
  },
  {
    id: "youtube-edit",
    name: "YouTube通常動画編集",
    addType: "extra_production",
    billingModel: "per_unit",
    unitType: "video",
    serviceCategory: "video_editing",
    defaultUnitPrice: 30000,
    defaultQuantity: 1,
    defaultStatus: "billable",
  },
  {
    id: "thumbnail",
    name: "サムネイル制作",
    addType: "extra_production",
    billingModel: "add_on",
    unitType: "asset",
    serviceCategory: "video_editing",
    defaultUnitPrice: 5000,
    defaultQuantity: 1,
    defaultStatus: "billable",
  },
  {
    id: "lp",
    name: "LP制作",
    addType: "one_time_project",
    billingModel: "project_fixed",
    unitType: "project",
    serviceCategory: "website",
    defaultUnitPrice: 200000,
    defaultQuantity: 1,
    defaultStatus: "billable",
  },
  {
    id: "casting",
    name: "キャスティング案件",
    addType: "one_time_project",
    billingModel: "project_fixed",
    unitType: "project",
    serviceCategory: "casting",
    defaultUnitPrice: 250000,
    defaultQuantity: 1,
    defaultStatus: "billable",
  },
  {
    id: "live2d",
    name: "Live2Dモデル制作",
    addType: "one_time_project",
    billingModel: "project_fixed",
    unitType: "project",
    serviceCategory: "live2d",
    defaultUnitPrice: 400000,
    defaultQuantity: 1,
    defaultStatus: "operating",
  },
  {
    id: "maintenance",
    name: "保守運用",
    addType: "monthly_fixed",
    billingModel: "monthly_fixed",
    unitType: "month",
    serviceCategory: "website",
    defaultUnitPrice: 30000,
    defaultQuantity: 1,
    defaultStatus: "billable",
  },
]

export function getGuidedTemplates(addType: GuidedAddType) {
  return GUIDED_TEMPLATES.filter((template) => template.addType === addType)
}

export function getGuidedTemplateById(templateId: string) {
  return GUIDED_TEMPLATES.find((template) => template.id === templateId) ?? null
}

export function getGuidedStatusLabel(value: string) {
  return GUIDED_STATUS_OPTIONS.find((option) => option.value === value)?.label ?? value
}

export function getGuidedBillingModelLabel(value: string | null | undefined) {
  return value && value in GUIDED_BILLING_MODEL_LABELS
    ? GUIDED_BILLING_MODEL_LABELS[value as GuidedBillingModel]
    : value || "未設定"
}

export function getGuidedUnitLabel(value: string | null | undefined) {
  return value && value in GUIDED_UNIT_LABELS ? GUIDED_UNIT_LABELS[value as GuidedUnitType] : value || "-"
}

export function calculateGuidedAmount(quantity: number, unitPrice: number) {
  return Math.max(0, Number(quantity || 0) * Number(unitPrice || 0))
}

export function getMonthEndDate(ym: string) {
  if (!/^\d{4}-\d{2}$/.test(ym)) return ""
  const [year, month] = ym.split("-").map(Number)
  return new Date(year, month, 0).toISOString().slice(0, 10)
}

export function buildGuidedTitle(params: {
  serviceName: string
  billingModel: GuidedBillingModel
  unitType: GuidedUnitType
  quantity: number
  targetMonth: string
}) {
  const serviceName = params.serviceName.trim()
  if (!serviceName) return ""

  if (params.billingModel === "monthly_fixed") {
    return params.targetMonth ? `${params.targetMonth} ${serviceName}` : serviceName
  }

  if (params.billingModel === "project_fixed") {
    return `${serviceName} 一式`
  }

  const quantity = Number(params.quantity || 0)
  const unit = GUIDED_UNIT_LABELS[params.unitType]
  if (quantity > 0) return `${serviceName} ${quantity}${unit}`
  return serviceName
}
