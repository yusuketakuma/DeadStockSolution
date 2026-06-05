export interface WorkflowNavLink {
  to: string;
  label: string;
}

export interface WorkflowNavGroup {
  id: 'register' | 'exchange' | 'communicate';
  title: string;
  description: string;
  primary: WorkflowNavLink;
  links: readonly WorkflowNavLink[];
}

export const USER_WORKFLOW_GROUPS: readonly WorkflowNavGroup[] = [
  {
    id: 'register',
    title: '1. 登録と品質確認',
    description: '在庫データを登録し、箱数・期限・品質の確認まで進めます。',
    primary: { to: '/upload', label: 'アップロード' },
    links: [
      { to: '/upload-quality', label: '品質を確認' },
      { to: '/inventory/dead-stock', label: 'デッドストックを確認' },
      { to: '/inventory/used-medication', label: '使用量を確認' },
      { to: '/inventory/browse', label: '在庫を確認' },
      { to: '/inventory/search', label: '在庫を検索' },
      { to: '/statistics', label: '統計を確認' },
    ],
  },
  {
    id: 'exchange',
    title: '2. 候補確認と提案対応',
    description: '交換候補を確認し、提案状況と交換履歴を追います。',
    primary: { to: '/matching', label: '候補を確認' },
    links: [
      { to: '/proposals', label: '提案一覧を確認' },
      { to: '/exchange-history', label: '交換履歴を確認' },
      { to: '/bookmarks', label: 'ブックマークを確認' },
    ],
  },
  {
    id: 'communicate',
    title: '3. 連絡とネットワーク',
    description: '通知、メッセージ、薬局グループ、薬局設定を確認します。',
    primary: { to: '/messages', label: 'メッセージを確認' },
    links: [
      { to: '/notifications', label: '通知を確認' },
      { to: '/alerts', label: 'アラートを確認' },
      { to: '/requests', label: '要望を確認' },
      { to: '/groups', label: 'グループを確認' },
      { to: '/pharmacies', label: '薬局を確認' },
      { to: '/account', label: '薬局設定を確認' },
    ],
  },
] as const;

export const USER_DEFAULT_QUICK_ACTIONS: readonly WorkflowNavLink[] = [
  USER_WORKFLOW_GROUPS[0].primary,
  USER_WORKFLOW_GROUPS[1].primary,
  USER_WORKFLOW_GROUPS[2].primary,
] as const;

export function findWorkflowGroup(id: WorkflowNavGroup['id']): WorkflowNavGroup {
  return USER_WORKFLOW_GROUPS.find((group) => group.id === id) ?? USER_WORKFLOW_GROUPS[0];
}
