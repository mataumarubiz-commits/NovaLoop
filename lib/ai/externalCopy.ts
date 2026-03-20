export const EXTERNAL_CHAT_COPY = {
  settings: {
    overview:
      "Discord や LINE から、NovaLoop 内の案件請求外注請求支払い通知マニュアルを確認できます",
    scope: "回答は、あなたの権限で閲覧できる範囲に限定されます",
    audit: "外部チャット経由の問い合わせは、改善と安全性のため監査ログに記録されます",
  },
  common: {
    noData: "現在、該当するデータは見つかりませんでした",
    permission: "その情報は、このアカウントの閲覧権限では確認できません",
    permissionAdmin: "組織全体の請求サマリーは、owner または executive_assistant 権限で確認できます",
    permissionVendor: "vendor は自分に関係する情報だけ返します",
    temporaryError: "いま一時的に情報を取得できませんでした。少し時間をおいてもう一度お試しください",
    temporaryErrorFollow: "必要なら NovaLoop の画面でも確認してください",
    unlinkedTitle: "まだNovaLoopと連携されていません",
    unlinkedBody: "設定 > 外部チャット連携 から接続してください",
    linkedTitle: "NovaLoop との連携が完了しました",
    linkedBody: "このチャットで案件請求外注請求支払い通知マニュアルを確認できます",
  },
  discord: {
    unlinkedTitle: "まだNovaLoopと連携されていません",
    unlinkedBody:
      "このDiscordアカウントでは、NovaLoop の組織データをまだ参照できません。NovaLoop の設定画面で Discord 連携を完了してください。",
    linkedTitle: "NovaLoop と連携しました",
    linkedBody:
      "このDiscordアカウントで、あなたがアクセス可能な案件請求外注請求支払い通知マニュアルを確認できます。",
    linkedExamples: [
      "今月の請求どうなってる？",
      "遅延案件ある？",
      "未提出の外注請求ある？",
      "請求の手順教えて",
    ],
    buttons: {
      open: "NovaLoopを開く",
      detail: "詳細を見る",
      refresh: "再読み込み",
      link: "NovaLoopで連携する",
      howTo: "連携方法を見る",
      approvalOnly: "承認待ちだけ見る",
      returnedOnly: "差し戻しだけ見る",
      delayedOnly: "遅延案件を見る",
      unsubmittedVendorOnly: "未提出外注を見る",
      manuals: "マニュアルを開く",
    },
  },
  line: {
    unlinkedTitle: "まだNovaLoopと連携されていません。",
    unlinkedBody:
      "NovaLoop の設定画面で LINE 連携を完了すると、案件請求通知を確認できるようになります。",
    linkedTitle: "NovaLoopとの連携が完了しました。",
    linkedBody: "このLINEで、案件請求外注請求支払い通知マニュアルを確認できます。",
    linkedExamples: [
      "今月の請求どうなってる？",
      "遅延案件ある？",
      "未提出の外注請求ある？",
      "請求の手順教えて",
    ],
    followups: [
      "承認待ちだけ",
      "差し戻しだけ",
      "A社だけ",
      "今週分だけ",
      "外注未提出の詳細",
      "請求の手順",
      "支払い予定だけ",
    ],
  },
} as const
