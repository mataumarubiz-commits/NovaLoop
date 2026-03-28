"use client";

import React from "react";
import {
  BookOpen,
  Command,
  LayoutGrid,
  CreditCard,
  Receipt,
  Users,
  Bell,
  FileText,
  ChevronRight,
  ShieldCheck,
  Bot,
  FolderOpen,
  Search,
  type LucideIcon,
} from "lucide-react";

type StarterArticle = {
  title: string;
  meta: string;
};

type CategoryCard = {
  title: string;
  desc: string;
  icon: LucideIcon;
  accent: string;
  iconAccent: string;
  items: string[];
};

type FaqItem = {
  title: string;
  meta: string;
};

type FaqGroup = {
  title: string;
  items: FaqItem[];
};

type RoleCard = {
  role: string;
  desc: string;
  icon: LucideIcon;
};

const starterArticles: StarterArticle[] = [
  {
    title: "最初のセットアップ",
    meta: "ログイン、組織作成、表示名の設定までを最短で進める",
  },
  {
    title: "最初のクライアントと案件を登録",
    meta: "運用を始める前に、請求先と案件の土台を整える",
  },
  {
    title: "Contents で進行を回し始める",
    meta: "納期・担当・ステータスを一つの画面で追えるようにする",
  },
];

const categoryCards: CategoryCard[] = [
  {
    title: "Contents / 制作進行のこと",
    desc: "納期・ステータス・テンプレなど、進行管理まわりの答えを探す",
    icon: LayoutGrid,
    accent: "rgba(124, 58, 237, 0.08)",
    iconAccent: "#7c3aed",
    items: ["納期はどこで見る？", "ステータスの意味は？", "テンプレはどう使う？"],
  },
  {
    title: "Clients / 案件・クライアントのこと",
    desc: "案件名・請求先・単価など、案件登録まわりの答えを探す",
    icon: FolderOpen,
    accent: "rgba(99, 102, 241, 0.08)",
    iconAccent: "#6366f1",
    items: ["クライアントを追加するには？", "案件名はどこで管理する？", "単価はどこに入れる？"],
  },
  {
    title: "Billing / 請求のこと",
    desc: "請求生成・対象条件・PDF・締め処理の答えを探す",
    icon: CreditCard,
    accent: "rgba(59, 130, 246, 0.08)",
    iconAccent: "#3b82f6",
    items: ["請求書が生成されないのはなぜ？", "請求対象になる条件は？", "PDFはどこに保存される？"],
  },
  {
    title: "Vendors / Payouts のこと",
    desc: "外注請求・証憑・支払い・CSV出力の答えを探す",
    icon: Receipt,
    accent: "rgba(234, 88, 12, 0.07)",
    iconAccent: "#ea580c",
    items: ["外注の証憑はどこ？", "支払い記録はどこで見る？", "CSVは出せる？"],
  },
  {
    title: "組織 / ロールのこと",
    desc: "owner・assistant・member の違いと権限の答えを探す",
    icon: ShieldCheck,
    accent: "rgba(107, 114, 128, 0.08)",
    iconAccent: "#6b7280",
    items: ["member が編集できない理由は？", "誰が請求を見れる？", "メンバー追加はどうする？"],
  },
  {
    title: "Pages / ナレッジのこと",
    desc: "社内マニュアル・ページ作成・AI活用の答えを探す",
    icon: BookOpen,
    accent: "rgba(22, 163, 74, 0.07)",
    iconAccent: "#16a34a",
    items: ["ページはどこで作る？", "並び替えはできる？", "AIで要約できる？"],
  },
  {
    title: "通知 / 遅延のこと",
    desc: "通知センター・未読・遅延検知の答えを探す",
    icon: Bell,
    accent: "rgba(139, 92, 246, 0.08)",
    iconAccent: "#8b5cf6",
    items: ["通知はどこで見る？", "遅延はどう判定される？", "未読管理はできる？"],
  },
  {
    title: "AI活用のこと",
    desc: "マニュアル化・テンプレ化・要約の使い方を探す",
    icon: Bot,
    accent: "rgba(168, 85, 247, 0.08)",
    iconAccent: "#a855f7",
    items: ["AIでマニュアル化するには？", "テンプレ化できる？", "請求文の下書きは作れる？"],
  },
];

const groupedFaq: FaqGroup[] = [
  {
    title: "Contents / 制作進行",
    items: [
      { title: "納期はどこで確認できる？", meta: "先方提出日 / 編集者提出日の見方" },
      { title: "ステータスの意味がわからない", meta: "未着手 / 先方修正中 / 納品完了 など" },
      { title: "テンプレを追加するには？", meta: "月次生成・クライアント別テンプレ" },
    ],
  },
  {
    title: "Billing / 請求",
    items: [
      { title: "請求書が生成されないのはなぜ？", meta: "対象月 / billable / ステータス条件を確認" },
      { title: "請求対象になる条件は？", meta: "delivery_month と billable_flag の考え方" },
      { title: "PDFはどこに保存される？", meta: "請求書生成後の保管場所を確認" },
    ],
  },
  {
    title: "Vendors / Payouts",
    items: [
      { title: "外注の証憑はどこで確認できる？", meta: "vendor invoice と証憑の見方" },
      { title: "支払い記録はどこで見る？", meta: "Payouts 一覧と支払済みの確認" },
      { title: "外注CSVは出力できる？", meta: "回収・支払い記録・CSVの流れ" },
    ],
  },
  {
    title: "組織 / ロール / Pages",
    items: [
      { title: "member が Pages を編集できないのはなぜ？", meta: "ロールと権限の仕様を確認" },
      { title: "owner と assistant の違いは？", meta: "請求・支払い・設定の権限差" },
      { title: "ページはどこから作る？", meta: "Pages 作成と並び替えの方法" },
    ],
  },
];

const roleCards: RoleCard[] = [
  {
    role: "Owner",
    desc: "請求・支払い・メンバー管理・設定まで全体を管理",
    icon: ShieldCheck,
  },
  {
    role: "Executive Assistant",
    desc: "締め処理や運用補助を担当。経理まわりにもアクセス",
    icon: FileText,
  },
  {
    role: "Member",
    desc: "制作進行の閲覧中心。Pagesは基本閲覧のみ",
    icon: Users,
  },
];

const __componentSanityChecks = {
  starterArticles: starterArticles.length === 3,
  categoryCards: categoryCards.every((card) => card.items.length >= 3),
  groupedFaq: groupedFaq.every((group) => group.items.length > 0),
  roleCards: roleCards.length === 3,
};

void __componentSanityChecks;

type SectionHeaderProps = {
  eyebrow: string;
  title: string;
  description?: string;
};

function SectionHeader({ eyebrow, title, description }: SectionHeaderProps) {
  return (
    <div style={{ borderBottom: "1px solid var(--help-accent-border)", paddingBottom: 14 }}>
      <p className="help-section-kicker" style={{ margin: 0 }}>{eyebrow}</p>
      <h2 style={{ margin: "8px 0 0", fontSize: 20, fontWeight: 600, letterSpacing: "-0.01em", color: "var(--help-heading)" }}>{title}</h2>
      {description ? <p style={{ margin: "8px 0 0", fontSize: 13, lineHeight: 1.7, color: "var(--help-body)" }}>{description}</p> : null}
    </div>
  );
}

type ArticleRowProps = {
  title: string;
  meta: string;
};

function ArticleRow({ title, meta }: ArticleRowProps) {
  return (
    <button className="help-idx-article-row">
      <div style={{ minWidth: 0, flex: 1 }}>
        <p style={{ margin: 0, fontSize: 15, fontWeight: 500, color: "var(--help-heading)" }}>{title}</p>
        <p style={{ margin: "6px 0 0", fontSize: 14, lineHeight: 1.8, color: "var(--help-body)" }}>{meta}</p>
      </div>
      <ChevronRight style={{ width: 16, height: 16, flexShrink: 0, color: "var(--help-body-light)", marginTop: 2 }} />
    </button>
  );
}

function HeroSection() {
  return (
    <section className="hlp-hero">
      <div className="hlp-hero-content">
        <h1 className="hlp-hero-title">
          どこを見ればいいか、<br />すぐわかる。
        </h1>
        <p className="hlp-hero-sub">
          NovaLoop のヘルプセンターです。機能ごと・よくある質問・ロール別、好きな切り口で探せます。
        </p>
      </div>
      <button type="button" className="hlp-search-trigger">
        <Search style={{ width: 16, height: 16, opacity: 0.5 }} />
        <span>キーワードで探す…</span>
        <kbd className="hlp-kbd">⌘K</kbd>
      </button>
    </section>
  );
}

function ProductAreaGrid() {
  return (
    <div className="help-idx-card">
      <SectionHeader
        eyebrow="Browse by product area"
        title="機能ごとに探す"
        description="どの画面・どの機能で迷っているかがわかっていれば、ここから最短で入れます。"
      />
      <div className="help-idx-area-grid">
        {categoryCards.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.title}
              className="help-idx-area-card"
              style={{ background: item.accent }}
            >
              <div className="help-idx-area-icon" style={{ background: `${item.iconAccent}14`, color: item.iconAccent }}>
                <Icon style={{ width: 16, height: 16 }} />
              </div>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--help-heading)" }}>{item.title}</p>
              <p style={{ margin: "4px 0 0", fontSize: 13, lineHeight: 1.6, color: "var(--help-body)" }}>{item.desc}</p>
              <div style={{ marginTop: 10, display: "grid", gap: 4 }}>
                {item.items.map((question) => (
                  <div key={question} style={{ fontSize: 13, lineHeight: 1.6, color: "var(--help-body-light)" }}>
                    ・{question}
                  </div>
                ))}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function FaqGrid() {
  return (
    <div className="help-idx-card">
      <SectionHeader
        eyebrow="Questions by area"
        title="よくある質問を、迷う場所ごとに見る"
        description="『この機能でよく詰まるのは何か』がひと目でわかるようにまとめています。"
      />
      <div className="help-idx-faq-grid">
        {groupedFaq.map((group) => (
          <div key={group.title} className="help-idx-faq-group">
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--help-accent)" }} />
              <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--help-heading)" }}>{group.title}</p>
            </div>
            <div style={{ display: "grid", gap: 0 }}>
              {group.items.map((item, idx) => (
                <React.Fragment key={item.title}>
                  {idx > 0 && <div style={{ height: 1, background: "var(--help-accent-border)" }} />}
                  <ArticleRow title={item.title} meta={item.meta} />
                </React.Fragment>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StarterArticlesCard() {
  return (
    <div className="help-idx-card">
      <SectionHeader
        eyebrow="First time only"
        title="はじめて使うときだけ見る3記事"
        description="最初に必要な案内だけをここにまとめています。運用中に何度も見返す前提ではありません。"
      />
      <div style={{ marginTop: 20, display: "grid", gap: 12 }}>
        {starterArticles.map((item, idx) => (
          <button
            key={item.title}
            className={`help-idx-starter-card ${idx === 0 ? "is-primary" : ""}`}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
              <div className={`help-idx-starter-num ${idx === 0 ? "is-primary" : ""}`}>
                {idx + 1}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <p style={{ margin: 0, fontSize: 15, fontWeight: 500, color: "var(--help-heading)" }}>{item.title}</p>
                <p style={{ margin: "6px 0 0", fontSize: 14, lineHeight: 1.8, color: "var(--help-body)" }}>{item.meta}</p>
              </div>
              <ChevronRight style={{ width: 16, height: 16, flexShrink: 0, color: "var(--help-body-light)", marginTop: 2 }} />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function RoleCardsCard() {
  return (
    <div className="help-idx-card">
      <SectionHeader
        eyebrow="By role"
        title="権限まわりから探す"
        description="誰が何を見られるか・どこまで操作できるかを、役割ごとに確認できます。"
      />
      <div style={{ marginTop: 20, display: "grid", gap: 12 }}>
        {roleCards.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.role}
              className="help-idx-role-card"
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: 14, minWidth: 0, flex: 1 }}>
                <div className="help-idx-role-icon">
                  <Icon style={{ width: 16, height: 16 }} />
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <p style={{ margin: 0, fontSize: 15, fontWeight: 500, color: "var(--help-heading)" }}>{item.role}</p>
                  <p style={{ margin: "6px 0 0", fontSize: 14, lineHeight: 1.8, color: "var(--help-body)" }}>{item.desc}</p>
                </div>
              </div>
              <ChevronRight style={{ width: 16, height: 16, flexShrink: 0, color: "var(--help-body-light)", marginTop: 2 }} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function HelpCenterPage() {
  return (
    <div className="help-page">
      <div className="help-idx-main">
        <HeroSection />
        <ProductAreaGrid />

        <div className="help-idx-bottom-grid">
          <FaqGrid />
          <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
            <StarterArticlesCard />
            <RoleCardsCard />
          </div>
        </div>
      </div>
    </div>
  );
}
