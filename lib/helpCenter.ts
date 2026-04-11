export type HelpCategoryId =
  | "contents"
  | "clients"
  | "billing"
  | "vendors-payouts"
  | "organization"
  | "pages"
  | "notifications"
  | "ai"

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

function createArticle(article: Omit<HelpArticle, "href">): HelpArticle {
  return {
    ...article,
    href: `/help/${article.slug}` as `/help/${string}`,
  }
}

export const HELP_SLUG_ALIASES: Record<string, string> = {
  setup: "setup-workspace",
  "first-week": "setup-workspace",
  "org-roles": "organization-roles",
  billing: "billing-monthly",
  notifications: "notifications-delays",
  "pages-manual": "pages-first-three",
  "contents-daily": "projects-daily",
}

export function resolveHelpSlug(slug: string) {
  return HELP_SLUG_ALIASES[slug] ?? slug
}

export const HELP_CATEGORIES: HelpCategory[] = [
  { id: "contents", label: "Projects / 案件進行", description: "日々の案件進行・納期・ステータス管理", order: 1 },
  { id: "clients", label: "Clients / 案件・クライアント", description: "クライアント・案件・進行単位の管理", order: 2 },
  { id: "billing", label: "Billing / 請求", description: "請求対象・請求書・PDF 作成の流れ", order: 3 },
  { id: "vendors-payouts", label: "Vendors / Payouts", description: "外注請求の確認から支払いまで", order: 4 },
  { id: "organization", label: "組織 / ロール", description: "権限・メンバー・ワークスペース設定", order: 5 },
  { id: "pages", label: "Pages / ナレッジ", description: "手順書・判断基準・社内ナレッジの整備", order: 6 },
  { id: "notifications", label: "通知 / 遅延", description: "未対応・遅延・確認漏れへの対応", order: 7 },
  { id: "ai", label: "AI 活用", description: "AI の活用方法と反映の考え方", order: 8 },
]

export const HELP_ARTICLES: HelpArticle[] = [
  createArticle({
    id: "setup-workspace",
    slug: "setup-workspace",
    title: "初期設定の流れ",
    description: "ワークスペース・メンバー・通知の順に、運用開始前の土台を整えます。",
    category: "organization",
    icon: "01",
    order: 1,
    recommended_order: 1,
    highlights: [
      "最初にワークスペース名と請求関連の基本情報を設定します。",
      "会計系の画面は Owner / Executive Assistant のみ利用できます。",
      "通知と役割を先に整えておくと、運用開始後の迷いが減ります。",
    ],
    sections: [
      {
        heading: "最初に整えること",
        body: [
          "Settings では、まずワークスペース情報、次にメンバー、最後に通知の順に確認します。運用開始後に権限を修正するより、最初に役割を揃えておく方が手戻りが少なくなります。",
          "請求や支払いの画面を操作するメンバーがいる場合は、Owner か Executive Assistant に設定します。Member は日常の運用操作を中心に使う想定です。",
        ],
      },
      {
        heading: "迷いやすいポイント",
        body: [
          "会計系の画面はすべてのメンバーに公開されるわけではありません。Billing / Invoices / Vendors / Payouts / Vault は Owner / Executive Assistant のみアクセスできます。",
          "Pages は運用ルールや判断基準を残す場所です。案件の正式な進行データは案件画面で管理します。",
        ],
      },
    ],
  }),
  createArticle({
    id: "first-content",
    slug: "first-content",
    title: "最初の案件を登録する",
    description: "クライアント・案件名・納期・delivery_month の決め方を整理します。",
    category: "contents",
    icon: "02",
    order: 1,
    recommended_order: 2,
    highlights: [
      "案件明細は 1 行が 1 つの進行単位に対応します。",
      "請求対象月は delivery_month を基準に決まります。",
      "納期・担当・ステータスを毎日更新するのが基本の運用です。",
    ],
    sections: [
      {
        heading: "登録時に押さえておくこと",
        body: [
          "最初はクライアント、案件名、タイトル、due_client_at、unit_price、delivery_month を揃えておくと運用がスムーズになります。",
          "delivery_month は請求対象月を表します。請求を出したい月ではなく、納品が行われる月として設定してください。",
        ],
      },
      {
        heading: "先に決めておくと困りにくいこと",
        body: [
          "billable_flag を請求対象の行にだけ付けておくと、Billing 側で対象を正確に集計できます。",
          "thumbnail_done や due_editor_at を早めに設定しておくと、日々の抜け漏れ確認が格段に楽になります。",
        ],
      },
    ],
  }),
  createArticle({
    id: "pages-first-three",
    slug: "pages-first-three",
    title: "Pages で最初に作る 3 ページ",
    description: "請求手順・外注確認・通知対応など、最初に用意しておくと役立つページをまとめます。",
    category: "pages",
    icon: "03",
    order: 1,
    recommended_order: 3,
    highlights: [
      "Pages は手順書と判断基準を置くための場所です。",
      "案件画面や Billing の正式データとの二重管理を避けるのが前提です。",
      "毎日参照する導線というより、迷ったときに立ち戻る基準をつくる役割です。",
    ],
    sections: [
      {
        heading: "最初の 3 ページに向いている内容",
        body: [
          "まずは「請求手順」「外注請求の確認フロー」「通知対応ルール」の 3 ページを作成すると、日常の運用で迷う場面が減ります。",
          "運用ルールや例外時の判断は Pages に残し、案件の状態や納期は案件画面に残すという使い分けが基本です。",
        ],
      },
      {
        heading: "Pages の使い方で押さえておくこと",
        body: [
          "Pages はナレッジの置き場であり、正式な案件台帳ではありません。案件の実態は案件画面、請求の実態は Billing / Invoices で管理します。",
          "更新頻度が高いルールは短いページに分けておくと、あとから探しやすくなります。",
        ],
      },
    ],
  }),
  createArticle({
    id: "contents-daily",
    slug: "projects-daily",
    title: "案件の日常運用",
    description: "毎日どこを確認し、何を更新すれば進行が安定するかをまとめます。",
    category: "contents",
    icon: "C",
    order: 2,
    highlights: [
      "当日の納期、遅延、未提出を優先して確認します。",
      "ステータスを放置せず、こまめに更新します。",
      "納期変更があった場合は delivery_month への影響も確認します。",
    ],
    sections: [
      {
        heading: "毎日確認する順番",
        body: [
          "まず当日の納期、次に遅延、最後に未提出を確認します。Home や Notifications で気になる行を見つけたら、最終的な更新は案件画面で行います。",
          "status、due_client_at、due_editor_at、担当、nextAction など、進行に直結する項目を止めずに更新することが重要です。",
        ],
      },
      {
        heading: "停滞しやすい場面",
        body: [
          "納期だけ変更して delivery_month を見直していないと、請求側とのずれが生じます。請求対象かどうかは billable_flag とあわせて確認してください。",
          "Pages にだけ運用メモを書いて案件画面を更新しないままだと、現場の状況を把握できなくなります。",
        ],
      },
    ],
  }),
  createArticle({
    id: "clients-projects",
    slug: "clients-projects",
    title: "クライアントと案件の管理方法",
    description: "クライアント単位と案件単位をどう分けるか、迷いにくい運用基準をまとめます。",
    category: "clients",
    icon: "CL",
    order: 1,
    highlights: [
      "クライアントは請求先や取引先の単位です。",
      "案件は進行や担当を分けたい単位で管理します。",
      "同じ取引先でも運用ラインが異なる場合は案件を分けると見やすくなります。",
    ],
    sections: [
      {
        heading: "分け方の目安",
        body: [
          "請求先や契約先が同じでも、進行の担当や納期の管理が異なるなら案件を分けます。",
          "クライアントは取引先の単位、案件は自分たちが管理する仕事の単位と考えると整理しやすくなります。",
        ],
      },
      {
        heading: "迷ったときの判断基準",
        body: [
          "請求書を分けたい、担当を分けたい、納期の山を分けたい、のいずれかに該当するなら案件を分けるのが確実です。",
          "Pages は案件ごとの補足ルールを残すのに向いていますが、日々の進行状況は案件画面で管理します。",
        ],
      },
    ],
  }),
  createArticle({
    id: "billing-monthly",
    slug: "billing-monthly",
    title: "月次請求の流れ",
    description: "Billing での集計から請求書 PDF 作成までの前提と確認ポイントを整理します。",
    category: "billing",
    icon: "B",
    order: 1,
    highlights: [
      "請求対象月は delivery_month を基準に決まります。",
      "消費税の入力欄はなく、免税を前提とした設計です。",
      "PDF の生成まで対応し、自動でのメール送信は行いません。",
    ],
    sections: [
      {
        heading: "Billing で確認すること",
        body: [
          "Billing では、delivery_month が対象月でステータスや billable_flag が請求条件を満たしている行をまとめて確認します。",
          "請求対象月は納品月が基準です。別途締め月を持たず、delivery_month をそのまま請求月として扱います。",
        ],
      },
      {
        heading: "PDF と運用ルール",
        body: [
          "請求書 PDF のファイル名は「【御請求書】YYYY-MM_請求先名_請求名.pdf」の形式です。",
          "メール送信は自動では行いません。NovaLoop は PDF の生成までを担当し、送付や手渡しは運用側で対応します。",
        ],
      },
      {
        heading: "権限について",
        body: [
          "Billing / Invoices / Vault は Owner / Executive Assistant のみ操作できます。Member は請求関連の画面にはアクセスできません。",
          "免税を前提としているため、消費税の入力欄はありません。金額の調整は明細や請求名で整理します。",
        ],
      },
    ],
  }),
  createArticle({
    id: "vendors-payouts",
    slug: "vendors-payouts",
    title: "外注請求と支払いの流れ",
    description: "Vendors での確認から Payouts での支払い管理までを一連の流れで整理します。",
    category: "vendors-payouts",
    icon: "V",
    order: 1,
    highlights: [
      "外注請求は Vendors で確認し、支払いは Payouts で管理します。",
      "提出・確認・承認・支払い準備の段階を分けると、滞留箇所が把握しやすくなります。",
      "会計系の操作は Owner / Executive Assistant が対象です。",
    ],
    sections: [
      {
        heading: "外注請求の確認",
        body: [
          "Vendors では、提出された請求の内容を確認し、差し戻しまたは承認の判断を行います。",
          "請求内容に不明点がある場合は、支払い準備に進めず確認待ちの状態を明示しておきます。",
        ],
      },
      {
        heading: "支払いの準備と実行",
        body: [
          "承認後は Payouts で支払い予定日・金額・CSV 出力の準備をまとめます。",
          "支払い済みへの更新は Payouts 側で行い、完了状況を一か所で把握できるようにします。",
        ],
      },
    ],
  }),
  createArticle({
    id: "organization-roles",
    slug: "organization-roles",
    title: "Owner・Executive Assistant・Member の違い",
    description: "誰がどこまで操作できるかを、運用と会計の境界が分かる形で整理します。",
    category: "organization",
    icon: "R",
    order: 2,
    highlights: [
      "Owner はワークスペース全体と会計関連を管理します。",
      "Executive Assistant は Owner に近い運用補佐の役割です。",
      "Member は日常の運用が中心で、会計系の画面にはアクセスできません。",
    ],
    sections: [
      {
        heading: "役割の概要",
        body: [
          "Owner はワークスペース全体の責任者で、会計や権限設定も含めて管理します。",
          "Executive Assistant は運用補佐として Owner に近い範囲を扱えます。会計系の実務を担当するメンバーにはこの権限を付与します。",
          "Member は日々の進行確認と更新が中心です。請求・支払い・Vault などの会計系画面にはアクセスできません。",
        ],
      },
      {
        heading: "よくある疑問",
        body: [
          "「閲覧できるが更新してよいのか」と迷う場合は、会計情報か日常の進行情報かで切り分けると判断しやすくなります。",
          "PM、ディレクター、ワーカーなど社内の役割が分かれていても、NovaLoop 上の権限は Owner / Executive Assistant と Member の境界で考えると整理しやすいです。",
        ],
      },
    ],
  }),
  createArticle({
    id: "pages-knowledge",
    slug: "pages-knowledge",
    title: "Pages をナレッジとして活用する",
    description: "Pages に何を書くと運用が楽になり、何を書かない方がよいかを整理します。",
    category: "pages",
    icon: "P",
    order: 2,
    highlights: [
      "Pages はルール・手順・判断基準を残す場所です。",
      "案件の進行状況や請求の正式データは別画面が情報源です。",
      "短いページに分けておくと、あとから探しやすくなります。",
    ],
    sections: [
      {
        heading: "Pages に向いている内容",
        body: [
          "クライアント別の注意点、レビューの観点、月末の締め手順、通知対応ルールなどは Pages に残すのが適しています。",
          "「迷ったらここを見る」という判断基準を用意しておくと、担当が変わっても運用がぶれにくくなります。",
        ],
      },
      {
        heading: "Pages に書かない方がよい内容",
        body: [
          "日々変わる納期、担当、請求状態などの正式データを Pages に持つと二重管理になります。正式な更新は案件画面や Billing 側で行ってください。",
          "Pages には背景や判断理由を残し、数値や進行状態は各機能の画面に集約するのが安全です。",
        ],
      },
    ],
  }),
  createArticle({
    id: "notifications-delays",
    slug: "notifications-delays",
    title: "通知と遅延への対応",
    description: "未対応の通知・遅延・確認待ちをどの順番で処理するかを整理します。",
    category: "notifications",
    icon: "N",
    order: 1,
    highlights: [
      "通知は入り口であり、最終的な確認は対象画面で行います。",
      "遅延・未確認・支払い待ちなど、優先度の高い項目から処理します。",
      "通知を確認しただけで終えず、案件画面や Payouts で状態を更新します。",
    ],
    sections: [
      {
        heading: "通知の基本的な確認方法",
        body: [
          "Notifications では、何が滞留しているかを一覧で把握し、対応先の画面に移動します。",
          "通知はあくまで入り口です。実際の更新は案件画面、Vendors、Payouts など対象の画面で行います。",
        ],
      },
      {
        heading: "遅延に気づいたとき",
        body: [
          "納期の遅れなら案件画面、外注の確認待ちなら Vendors、支払い待ちなら Payouts というように、対応先の画面を分けて考えます。",
          "遅延の原因や再発防止のルールは Pages に残しておくと、次回以降の判断が早くなります。",
        ],
      },
    ],
  }),
  createArticle({
    id: "ai-usage",
    slug: "ai-usage",
    title: "AI を活用するときの考え方",
    description: "AI をどこで使い、どこまでを人が確定させるかの前提を整理します。",
    category: "ai",
    icon: "AI",
    order: 1,
    highlights: [
      "AI は下書きや整理の補助として使い、最終判断は人が行います。",
      "案件画面では下書き作成を中心とした使い方が基本です。",
      "Pages や外部連携の AI は、判断材料を整える用途に向いています。",
    ],
    sections: [
      {
        heading: "AI の活用場面",
        body: [
          "AI は文章のたたき台づくり、要約、情報整理に向いています。判断や承認そのものを自動化する前提ではありません。",
          "Pages では手順書や文面の整形に、案件画面では下書きの作成に使うと実務に馴染みやすくなります。",
        ],
      },
      {
        heading: "運用で押さえておくこと",
        body: [
          "AI の出力はそのまま確定せず、内容を確認してから適用します。請求・支払い・正式な納期変更などの確定は必ず人が行います。",
          "Discord や LINE との連携 AI は状況確認の補助として使い、権限に応じた閲覧中心の運用が基本です。",
        ],
      },
    ],
  }),
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
      getCategoryLabel(article.category),
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
      if (normalizeHelpQuery(getCategoryLabel(article.category)).includes(normalizedQuery)) score += 2
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
