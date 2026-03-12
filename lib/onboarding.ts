export type OnboardingItemKey =
  | "company_profile"
  | "bank_account"
  | "client_created"
  | "manual_page"
  | "first_content"
  | "first_invoice"
  | "vendor_flow"
  | "notifications_checked"
  | "ai_first_use"

export type OnboardingItemDefinition = {
  key: OnboardingItemKey
  title: string
  description: string
  href: string
  helpHref?: string
}

export const ONBOARDING_ITEMS: OnboardingItemDefinition[] = [
  {
    key: "company_profile",
    title: "会社情報登録",
    description: "請求者情報と基本情報を登録します。",
    href: "/settings/workspace",
    helpHref: "/help/setup",
  },
  {
    key: "bank_account",
    title: "口座登録",
    description: "請求や支払いに使う口座を登録します。",
    href: "/settings/workspace",
    helpHref: "/help/setup",
  },
  {
    key: "client_created",
    title: "クライアント登録",
    description: "最初の取引先を登録して運用の土台を作ります。",
    href: "/contents?newClient=1",
    helpHref: "/help/setup",
  },
  {
    key: "manual_page",
    title: "Pagesでマニュアル作成",
    description: "社内手順書を Pages に残して運用を標準化します。",
    href: "/pages",
    helpHref: "/help/pages-manual",
  },
  {
    key: "first_content",
    title: "初回コンテンツ追加",
    description: "運用中の案件を最初の1本だけ登録します。",
    href: "/contents",
    helpHref: "/help/contents-daily",
  },
  {
    key: "first_invoice",
    title: "初回請求生成",
    description: "Billing から最初の請求を生成します。",
    href: "/billing",
    helpHref: "/help/billing-monthly",
  },
  {
    key: "vendor_flow",
    title: "外注招待 / 外注請求導線確認",
    description: "外注導線を一度確認して月末の事故を防ぎます。",
    href: "/vendors",
    helpHref: "/help/vendors-payouts",
  },
  {
    key: "notifications_checked",
    title: "通知確認",
    description: "通知センターの動作と未読処理を確認します。",
    href: "/notifications",
    helpHref: "/help/setup",
  },
  {
    key: "ai_first_use",
    title: "AI補助の初回利用",
    description: "Pages や請求文面でAI補助を一度使ってみます。",
    href: "/pages",
    helpHref: "/help/ai-assist",
  },
]

export function completionRate(completedKeys: string[]) {
  if (ONBOARDING_ITEMS.length === 0) return 100
  return Math.round((completedKeys.length / ONBOARDING_ITEMS.length) * 100)
}
