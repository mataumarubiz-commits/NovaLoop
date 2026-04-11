export type OnboardingItemKey =
  | "company_profile"
  | "bank_account"
  | "client_created"
  | "manual_page"
  | "first_content"
  | "first_invoice"
  | "vendor_flow"
  | "notifications_checked"

export type OnboardingItemDefinition = {
  key: OnboardingItemKey
  title: string
  description: string
  todo?: string
  doneWhen?: string
  href: string
  helpHref?: string
}

const withChecklistSource = (href: string) => `${href}${href.includes("?") ? "&" : "?"}from=checklist`

export const ONBOARDING_ITEMS: OnboardingItemDefinition[] = [
  {
    key: "company_profile",
    title: "会社情報を登録する",
    description: "請求元の基本情報を登録します。",
    href: withChecklistSource("/settings/workspace"),
    helpHref: "/help/setup",
  },
  {
    key: "bank_account",
    title: "口座を登録する",
    description: "請求や支払いに使用する口座を登録します。",
    href: withChecklistSource("/settings/workspace"),
    helpHref: "/help/setup",
  },
  {
    key: "client_created",
    title: "クライアントを登録する",
    description: "最初の取引先を登録して運用の土台をつくります。",
    href: withChecklistSource("/projects?create=1&newClient=1"),
    helpHref: "/help/setup",
  },
  {
    key: "manual_page",
    title: "Pages でマニュアルを作成する",
    description: "社内手順を Pages に残して運用を標準化します。",
    href: withChecklistSource("/pages"),
    helpHref: "/help/pages-manual",
  },
  {
    key: "first_content",
    title: "最初の案件を登録する",
    description: "運用中の案件をまず 1 件だけ登録します。",
    href: withChecklistSource("/projects?create=1"),
    helpHref: "/help/projects-daily",
  },
  {
    key: "first_invoice",
    title: "最初の請求を作成する",
    description: "Billing から最初の請求書を生成します。",
    href: withChecklistSource("/billing"),
    helpHref: "/help/billing-monthly",
  },
  {
    key: "vendor_flow",
    title: "外注の導線を確認する",
    description: "外注フローを一度確認して月末のミスを防ぎます。",
    href: withChecklistSource("/vendors"),
    helpHref: "/help/vendors-payouts",
  },
  {
    key: "notifications_checked",
    title: "通知を確認する",
    description: "通知センターの動作と未読の処理を確認します。",
    href: withChecklistSource("/notifications"),
    helpHref: "/help/setup",
  },
]

export function filterOnboardingKeys(keys: readonly string[]): OnboardingItemKey[] {
  const allowed = new Set(ONBOARDING_ITEMS.map((item) => item.key))
  return Array.from(
    new Set(
      keys.filter((key): key is OnboardingItemKey => typeof key === "string" && allowed.has(key as OnboardingItemKey))
    )
  )
}

export function completionRate(completedKeys: string[]) {
  if (ONBOARDING_ITEMS.length === 0) return 100
  return Math.round((filterOnboardingKeys(completedKeys).length / ONBOARDING_ITEMS.length) * 100)
}
