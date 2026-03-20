export type HelpCategoryId =
  | "getting-started"
  | "organization"
  | "pages"
  | "contents"
  | "billing"
  | "vendors"
  | "payouts"
  | "notifications"
  | "ai"
  | "troubleshoot"

export type HelpArticleSection = {
  heading: string
  body: string[]
}

export type HelpArticle = {
  id: string
  slug: string
  href: `/help/${string}`
  title: string
  description: string
  category: HelpCategoryId
  icon: string
  order: number
  recommended_order?: number
  highlights?: string[]
  sections: HelpArticleSection[]
}

export type HelpCategory = {
  id: HelpCategoryId
  label: string
  description: string
  order: number
}

export const HELP_CATEGORIES: HelpCategory[] = [
  { id: "getting-started", label: "はじめに", description: "初回設定と最初の1週間の進め方です。", order: 1 },
  { id: "organization", label: "組織 / メンバー / ロール", description: "組織参加、権限、招待の考え方です。", order: 2 },
  { id: "pages", label: "Pages", description: "社内マニュアルと業務ナレッジの運用方法です。", order: 3 },
  { id: "contents", label: "Contents", description: "案件と日次の制作進行管理です。", order: 4 },
  { id: "billing", label: "Billing / Invoices", description: "月次請求、請求依頼、請求書運用です。", order: 5 },
  { id: "vendors", label: "Vendors / 外注請求", description: "外注招待、請求依頼、確認フローです。", order: 6 },
  { id: "payouts", label: "Payouts", description: "支払い予定、CSV、支払済み管理です。", order: 7 },
  { id: "notifications", label: "Notifications", description: "未読確認と対応優先度の見方です。", order: 8 },
  { id: "ai", label: "AI活用", description: "Pages 補助と外部チャットAIの使い方です。", order: 9 },
  { id: "troubleshoot", label: "困ったとき", description: "詰まりやすい場面の確認ポイントです。", order: 10 },
]

export const HELP_ARTICLES: HelpArticle[] = [
  {
    id: "setup",
    slug: "setup",
    href: "/help/setup",
    title: "最初のセットアップ",
    description: "ワークスペース、口座、クライアント、通知を最初に整える手順です。",
    category: "getting-started",
    icon: "1",
    order: 1,
    recommended_order: 1,
    highlights: [
      "ワークスペースの会社情報と請求者情報を最初に登録する",
      "支払い運用がある場合は口座と委託者コードを入れる",
      "クライアントを1社登録し、Contents と Pages を使い始める",
    ],
    sections: [
      {
        heading: "最初にやること",
        body: [
          "まずは Settings > ワークスペース で会社情報、請求者情報、固定メモ、口座情報を登録します。請求や支払いの画面はこの情報を前提に動きます。",
          "次にクライアントを1社追加し、Contents に案件を1件登録します。Pages では社内向けの手順書や運用ルールを作成できます。",
        ],
      },
      {
        heading: "最初の確認項目",
        body: [
          "1. ワークスペースの会社情報と請求先情報",
          "2. 既定の振込口座と委託者コード",
          "3. クライアントの登録",
          "4. Contents の1件登録",
          "5. Pages の手順書テンプレ作成",
        ],
      },
    ],
  },
  {
    id: "first-week",
    slug: "first-week",
    href: "/help/first-week",
    title: "最初の1週間の進め方",
    description: "Home、Contents、Billing、Notifications を一巡して運用を安定させる流れです。",
    category: "getting-started",
    icon: "2",
    order: 2,
    recommended_order: 2,
    highlights: [
      "Home で危険案件と未対応通知を毎日確認する",
      "Contents を毎日更新し、delivery_month を確定させる",
      "Billing と Vendors は週次または月次で締める",
    ],
    sections: [
      {
        heading: "1週間の流れ",
        body: [
          "Home で今日納期、遅延案件、未読通知を確認し、その日の優先作業を決めます。",
          "Contents では status、due_client_at、unit_price、billable_flag を整え、請求対象月がずれないようにします。",
          "Pages には社内ルールとクライアント別の注意点を残し、属人化を減らします。",
        ],
      },
    ],
  },
  {
    id: "org-roles",
    slug: "org-roles",
    href: "/help/org-roles",
    title: "組織・メンバー・ロールの使い分け",
    description: "オーナー（owner） / 経営補佐（executive_assistant） / メンバー（member）の役割差分を整理します。",
    category: "organization",
    icon: "O",
    order: 1,
    sections: [
      {
        heading: "基本ルール",
        body: [
          "オーナー（owner）と経営補佐（executive_assistant）は Billing、Invoices、Vendors、Payouts、Settings の主要操作ができます。",
          "メンバー（member）は原則として閲覧主体で、会計や支払いの更新操作は行いません。",
          "権限は UI 表示だけでなく server-side route 側でも制御されます。",
        ],
      },
    ],
  },
  {
    id: "pages-manual",
    slug: "pages-manual",
    href: "/help/pages-manual",
    title: "Pages を社内マニュアルとして使う",
    description: "自由編集の Pages を、運用手順と判断基準の置き場として定着させる方法です。",
    category: "pages",
    icon: "P",
    order: 1,
    recommended_order: 3,
    highlights: [
      "1ページ1テーマで管理する",
      "見出しとチェックリストを使って手順を明文化する",
      "Billing や Vendors への関連導線を本文に入れる",
    ],
    sections: [
      {
        heading: "Pages の役割",
        body: [
          "Pages は社内向けの自由編集ドキュメントです。クライアント別の注意点、請求手順、外注支払い手順などを業務の近くに置けます。",
          "本文には見出し、箇条書き、チェックリスト、画像、リンクを使えます。作成したページは一覧で並び替えできます。",
        ],
      },
      {
        heading: "おすすめの運用",
        body: [
          "請求手順、外注請求確認フロー、月末締め手順、通知対応ルールの4本を最初に作ると、運用が安定しやすくなります。",
          "長いページは見出しを細かく分け、関連ページリンクを入れて横断しやすくします。",
        ],
      },
    ],
  },
  {
    id: "page-templates",
    slug: "page-templates",
    href: "/help/page-templates",
    title: "マニュアルテンプレの使い分け",
    description: "Pages のテンプレをどの場面で使うかを整理します。",
    category: "pages",
    icon: "T",
    order: 2,
    sections: [
      {
        heading: "主なテンプレ",
        body: [
          "業務手順書は、毎回同じ流れで行う作業を残すときに使います。",
          "請求手順は Billing / Invoices の締め処理をまとめるときに使います。",
          "外注支払い手順は Vendors / Payouts の確認から CSV 出力までを整理するときに使います。",
        ],
      },
    ],
  },
  {
    id: "contents-daily",
    slug: "contents-daily",
    href: "/help/contents-daily",
    title: "Contents の日次運用",
    description: "1行1案件で status と納期を管理する基本フローです。",
    category: "contents",
    icon: "C",
    order: 1,
    sections: [
      {
        heading: "基本ルール",
        body: [
          "Contents は1行1案件です。due_client_at、due_editor_at、status、unit_price、billable_flag を毎日更新します。",
          "delivery_month は Billing の基準になるため、納品完了時にずれがないか確認します。",
        ],
      },
    ],
  },
  {
    id: "billing-monthly",
    slug: "billing-monthly",
    href: "/help/billing-monthly",
    title: "月次請求の流れ",
    description: "Billing でのプレビューから Invoices での確認までをまとめます。",
    category: "billing",
    icon: "B",
    order: 1,
    sections: [
      {
        heading: "Billing の使い方",
        body: [
          "Billing では対象月を選び、請求対象の Contents をクライアント単位で確認します。",
          "一括生成後は Invoices に draft が作られ、PDF 生成と一括操作は Invoices 側で行います。",
        ],
      },
      {
        heading: "注意点",
        body: [
          "請求対象月は delivery_month 基準です。",
          "送付は PDF 生成までで、メール自動送信は行いません。",
        ],
      },
    ],
  },
  {
    id: "vendors-payouts",
    slug: "vendors-payouts",
    href: "/help/vendors-payouts",
    title: "外注請求と支払いの流れ",
    description: "外注請求依頼、確認、差し戻し、Payouts 連携までをまとめます。",
    category: "vendors",
    icon: "V",
    order: 1,
    sections: [
      {
        heading: "外注請求の流れ",
        body: [
          "Vendors で招待と請求依頼を行い、外注側は /vendor から今月請求を確認して submitted します。",
          "submitted 時に PDF が固定され、差し戻し時は同じ請求IDのまま修正再提出します。",
        ],
      },
      {
        heading: "支払いまでの流れ",
        body: [
          "会社側で approved にした後、Payouts で支払い予定と CSV 出力を確認します。",
          "支払済み処理は Payouts 側で一括更新できます。",
        ],
      },
    ],
  },
  {
    id: "notifications",
    slug: "notifications",
    href: "/help/notifications",
    title: "通知センターの見方",
    description: "未読通知、優先度、対応導線の読み方です。",
    category: "notifications",
    icon: "N",
    order: 1,
    sections: [
      {
        heading: "通知の優先順位",
        body: [
          "遅延、承認待ち、外注請求依頼、支払い関連の通知を優先して確認します。",
          "通知一覧から既読、対応済み、関連画面への移動ができます。",
        ],
      },
    ],
  },
  {
    id: "ai-assist",
    slug: "ai-assist",
    href: "/help/ai-assist",
    title: "AI機能の使い方",
    description: "Pages 補助と外部チャットAIの使い分けをまとめます。",
    category: "ai",
    icon: "AI",
    order: 1,
    sections: [
      {
        heading: "Pages 補助",
        body: [
          "AI パレットでは要約、見出し整理、手順化、SQL案のたたき台などを生成できます。",
          "AI の結果は提案のみで、自動保存や自動更新は行いません。内容を確認して反映してください。",
        ],
      },
      {
        heading: "外部チャットAI",
        body: [
          "Discord / LINE 連携を設定すると、案件、請求、外注請求、支払い、通知、Pages マニュアルを横断して質問できます。",
          "回答は linked user の権限に限定され、read-only で動作します。",
        ],
      },
    ],
  },
  {
    id: "troubleshoot",
    slug: "troubleshoot",
    href: "/help/troubleshoot",
    title: "困ったときの確認ポイント",
    description: "よくある詰まりどころと、最初に見る場所をまとめます。",
    category: "troubleshoot",
    icon: "?",
    order: 1,
    sections: [
      {
        heading: "最初に見る場所",
        body: [
          "Settings > Health で主要データと設定の診断を確認します。",
          "Notifications を見て、未対応の承認待ちや差し戻しがないか確認します。",
          "Billing / Vendors / Payouts の一覧に対象が出ているかを確認し、route だけでなく実データ反映を確認してください。",
        ],
      },
    ],
  },
]

export function getCategoryLabel(categoryId: HelpCategoryId): string {
  return HELP_CATEGORIES.find((category) => category.id === categoryId)?.label ?? categoryId
}

export type HelpSearchResult = {
  article: HelpArticle
  score: number
  excerpt: string
  steps: string[]
}

function normalizeHelpQuery(value: string) {
  return value.toLowerCase().replace(/\s+/g, "")
}

function articleSearchText(article: HelpArticle) {
  return normalizeHelpQuery(
    [
      article.title,
      article.description,
      article.category,
      ...(article.highlights ?? []),
      ...article.sections.flatMap((section) => [section.heading, ...section.body]),
    ].join(" ")
  )
}

function articleSteps(article: HelpArticle) {
  return article.sections.flatMap((section) => section.body).filter(Boolean).slice(0, 6)
}

function articleExcerpt(article: HelpArticle) {
  return article.sections.flatMap((section) => section.body).find(Boolean) ?? article.description
}

export function searchHelpArticles(query: string, limit = 5): HelpSearchResult[] {
  const normalizedQuery = normalizeHelpQuery(query)
  const results = HELP_ARTICLES.map((article) => {
    const searchText = articleSearchText(article)
    let score = 0

    if (!normalizedQuery) {
      score = article.recommended_order ? 100 - article.recommended_order : 10
    } else {
      if (normalizeHelpQuery(article.title).includes(normalizedQuery)) score += 8
      if (normalizeHelpQuery(article.description).includes(normalizedQuery)) score += 4
      if (normalizeHelpQuery(article.category).includes(normalizedQuery)) score += 2
      if (searchText.includes(normalizedQuery)) score += 1
      for (const token of normalizedQuery.split(/[\/,]/).filter(Boolean)) {
        if (searchText.includes(token)) score += 1
      }
    }

    return {
      article,
      score,
      excerpt: articleExcerpt(article),
      steps: articleSteps(article),
    }
  })
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      if ((a.article.recommended_order ?? 999) !== (b.article.recommended_order ?? 999)) {
        return (a.article.recommended_order ?? 999) - (b.article.recommended_order ?? 999)
      }
      if (a.article.order !== b.article.order) return a.article.order - b.article.order
      return a.article.title.localeCompare(b.article.title, "ja")
    })

  return results.slice(0, limit)
}

export function getHelpAnswerCandidates(query: string, limit = 5) {
  return searchHelpArticles(query, limit).map(({ article, excerpt, steps }) => ({
    id: article.id,
    slug: article.slug,
    href: article.href,
    title: article.title,
    description: article.description,
    category: article.category,
    category_label: getCategoryLabel(article.category),
    excerpt,
    steps,
  }))
}
