import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import LoginPage from '../pages/LoginPage';
import RegisterPage from '../pages/RegisterPage';
import PasswordResetPage from '../pages/PasswordResetPage';
import VerificationPendingPage from '../pages/VerificationPendingPage';
import CallbackPage from '../pages/CallbackPage';

const OnboardingPage = lazy(() => import('../pages/OnboardingPage'));
const DashboardPage = lazy(() => import('../pages/DashboardPage'));
const AccountPage = lazy(() => import('../pages/AccountPage'));
const UploadPage = lazy(() => import('../pages/UploadPage'));
const DeadStockListPage = lazy(() => import('../pages/DeadStockListPage'));
const UsedMedicationListPage = lazy(() => import('../pages/UsedMedicationListPage'));
const InventoryBrowsePage = lazy(() => import('../pages/InventoryBrowsePage'));
const InventorySearchPage = lazy(() => import('../pages/InventorySearchPage'));
const MatchingPage = lazy(() => import('../pages/MatchingPage'));
const ProposalsPage = lazy(() => import('../pages/ProposalsPage'));
const ProposalDetailPage = lazy(() => import('../pages/ProposalDetailPage'));
const ProposalPrintPage = lazy(() => import('../pages/ProposalPrintPage'));
const ExchangeHistoryPage = lazy(() => import('../pages/ExchangeHistoryPage'));
const PharmacyListPage = lazy(() => import('../pages/PharmacyListPage'));
const StatisticsPage = lazy(() => import('../pages/StatisticsPage'));
const AdminDashboardPage = lazy(() => import('../pages/admin/AdminDashboardPage'));
const AdminPharmaciesPage = lazy(() => import('../pages/admin/AdminPharmaciesPage'));
const AdminPharmacyEditPage = lazy(() => import('../pages/admin/AdminPharmacyEditPage'));
const AdminExchangesPage = lazy(() => import('../pages/admin/AdminExchangesPage'));
const AdminLogCenterPage = lazy(() => import('../pages/admin/AdminLogCenterPage'));
const AdminRiskPage = lazy(() => import('../pages/admin/AdminRiskPage'));
const AdminMonthlyReportsPage = lazy(() => import('../pages/admin/AdminMonthlyReportsPage'));
const AdminDrugMasterPage = lazy(() => import('../pages/admin/AdminDrugMasterPage'));
const AdminOpenClawPage = lazy(() => import('../pages/admin/AdminOpenClawPage'));
const AdminUploadJobsPage = lazy(() => import('../pages/admin/AdminUploadJobsPage'));
const AdminMatchingRulesPage = lazy(() => import('../pages/admin/AdminMatchingRulesPage'));
const AdminDrugEquivalencesPage = lazy(() => import('../pages/admin/AdminDrugEquivalencesPage'));
const AdminUserRequestsPage = lazy(() => import('../pages/admin/AdminUserRequestsPage'));
const AdminGroupsPage = lazy(() => import('../pages/admin/AdminGroupsPage'));
const AdminAlertsPage = lazy(() => import('../pages/admin/AdminAlertsPage'));
const AdminNotificationsPage = lazy(() => import('../pages/admin/AdminNotificationsPage'));
const AdminOpenClawCommandsPage = lazy(() => import('../pages/admin/AdminOpenClawCommandsPage'));
const AdminPharmacyHealthPage = lazy(() => import('../pages/admin/AdminPharmacyHealthPage'));
const AdminMatchingPerformancePage = lazy(() => import('../pages/admin/AdminMatchingPerformancePage'));
const AdminUploadQualityPage = lazy(() => import('../pages/admin/AdminUploadQualityPage'));
const AdminAuditPage = lazy(() => import('../pages/admin/AdminAuditPage'));
const AdminBusinessHoursPage = lazy(() => import('../pages/admin/AdminBusinessHoursPage'));
const AdminBulkActionsPage = lazy(() => import('../pages/admin/AdminBulkActionsPage'));
const AdminRelationshipsPage = lazy(() => import('../pages/admin/AdminRelationshipsPage'));
const AdminRateLimitsPage = lazy(() => import('../pages/admin/AdminRateLimitsPage'));
const GroupListPage = lazy(() => import('../pages/GroupListPage'));
const GroupDetailPage = lazy(() => import('../pages/GroupDetailPage'));
const AlertListPage = lazy(() => import('../pages/AlertListPage'));
const BookmarksPage = lazy(() => import('../pages/BookmarksPage'));


type RouteComponent = ComponentType | LazyExoticComponent<ComponentType>;

interface BaseRouteMeta {
  path: string;
  component: RouteComponent;
  title?: string;
  parent?: string;
}

export interface PublicRouteMeta extends BaseRouteMeta {
  access: 'public';
  redirectAuthenticatedTo: string;
  adminOnly?: never;
  userOnly?: never;
  useLayout?: never;
}

export interface ProtectedRouteMeta extends BaseRouteMeta {
  access: 'protected';
  adminOnly?: boolean;
  userOnly?: boolean;
  useLayout?: boolean;
  redirectAuthenticatedTo?: never;
}

export type RouteMeta = PublicRouteMeta | ProtectedRouteMeta;

export const ROUTE_META: readonly RouteMeta[] = Object.freeze([
  { path: '/login', access: 'public', redirectAuthenticatedTo: '/', component: LoginPage, title: 'ログイン' },
  { path: '/register', access: 'public', redirectAuthenticatedTo: '/', component: RegisterPage, title: '新規登録' },
  { path: '/password-reset', access: 'public', redirectAuthenticatedTo: '/', component: PasswordResetPage, title: 'パスワードリセット' },
  { path: '/verification-pending', access: 'public', redirectAuthenticatedTo: '/', component: VerificationPendingPage, title: 'メール確認待ち' },
  { path: '/auth/callback', access: 'public', redirectAuthenticatedTo: '/', component: CallbackPage, title: '認証コールバック' },
  { path: '/onboarding', access: 'public', redirectAuthenticatedTo: '/', component: OnboardingPage, title: 'オンボーディング' },

  { path: '/', access: 'protected', userOnly: true, useLayout: true, component: DashboardPage, title: 'ダッシュボード' },
  { path: '/account', access: 'protected', useLayout: true, component: AccountPage, title: 'アカウント' },
  { path: '/upload', access: 'protected', userOnly: true, useLayout: true, component: UploadPage, title: 'アップロード' },
  { path: '/inventory/dead-stock', access: 'protected', userOnly: true, useLayout: true, component: DeadStockListPage, title: 'デッドストック', parent: '/inventory' },
  { path: '/inventory/used-medication', access: 'protected', userOnly: true, useLayout: true, component: UsedMedicationListPage, title: '医薬品使用量', parent: '/inventory' },
  { path: '/inventory/browse', access: 'protected', userOnly: true, useLayout: true, component: InventoryBrowsePage, title: '在庫参照', parent: '/inventory' },
  { path: '/inventory/search', access: 'protected', userOnly: true, useLayout: true, component: InventorySearchPage, title: '医薬品在庫検索', parent: '/inventory' },
  { path: '/matching', access: 'protected', userOnly: true, useLayout: true, component: MatchingPage, title: 'マッチング' },
  { path: '/proposals', access: 'protected', userOnly: true, useLayout: true, component: ProposalsPage, title: 'マッチング一覧' },
  { path: '/proposals/:id', access: 'protected', userOnly: true, useLayout: true, component: ProposalDetailPage, title: '提案詳細', parent: '/proposals' },
  { path: '/proposals/:id/print', access: 'protected', userOnly: true, useLayout: false, component: ProposalPrintPage, title: '提案印刷', parent: '/proposals' },
  { path: '/exchange-history', access: 'protected', userOnly: true, useLayout: true, component: ExchangeHistoryPage, title: '交換履歴' },
  { path: '/pharmacies', access: 'protected', userOnly: true, useLayout: true, component: PharmacyListPage, title: '薬局一覧' },
  { path: '/statistics', access: 'protected', userOnly: true, useLayout: true, component: StatisticsPage, title: '統計' },
  { path: '/groups', access: 'protected', userOnly: true, useLayout: true, component: GroupListPage, title: 'グループ' },
  { path: '/groups/:id', access: 'protected', userOnly: true, useLayout: true, component: GroupDetailPage, title: 'グループ詳細', parent: '/groups' },
  { path: '/alerts', access: 'protected', userOnly: true, useLayout: true, component: AlertListPage, title: 'アラート' },
  { path: '/bookmarks', access: 'protected', userOnly: true, useLayout: true, component: BookmarksPage, title: 'ブックマーク' },

  { path: '/admin', access: 'protected', adminOnly: true, useLayout: true, component: AdminDashboardPage, title: 'ダッシュボード' },
  { path: '/admin/pharmacies', access: 'protected', adminOnly: true, useLayout: true, component: AdminPharmaciesPage, title: '薬局管理', parent: '/admin' },
  { path: '/admin/pharmacies/:id/edit', access: 'protected', adminOnly: true, useLayout: true, component: AdminPharmacyEditPage, title: '薬局編集', parent: '/admin/pharmacies' },
  { path: '/admin/groups', access: 'protected', adminOnly: true, useLayout: true, component: AdminGroupsPage, title: 'グループ管理', parent: '/admin' },
  { path: '/admin/user-requests', access: 'protected', adminOnly: true, useLayout: true, component: AdminUserRequestsPage, title: 'ユーザーリクエスト', parent: '/admin' },
  { path: '/admin/alerts', access: 'protected', adminOnly: true, useLayout: true, component: AdminAlertsPage, title: 'アラート管理', parent: '/admin' },
  { path: '/admin/exchanges', access: 'protected', adminOnly: true, useLayout: true, component: AdminExchangesPage, title: '交換履歴', parent: '/admin' },
  { path: '/admin/upload-jobs', access: 'protected', adminOnly: true, useLayout: true, component: AdminUploadJobsPage, title: '取込ジョブ管理', parent: '/admin' },
  { path: '/admin/risk', access: 'protected', adminOnly: true, useLayout: true, component: AdminRiskPage, title: '期限リスク分析', parent: '/admin' },
  { path: '/admin/reports', access: 'protected', adminOnly: true, useLayout: true, component: AdminMonthlyReportsPage, title: '月次レポート', parent: '/admin' },
  { path: '/admin/notifications', access: 'protected', adminOnly: true, useLayout: true, component: AdminNotificationsPage, title: '通知・配信状況', parent: '/admin' },
  { path: '/admin/drug-master', access: 'protected', adminOnly: true, useLayout: true, component: AdminDrugMasterPage, title: '医薬品マスター', parent: '/admin' },
  { path: '/admin/drug-equivalences', access: 'protected', adminOnly: true, useLayout: true, component: AdminDrugEquivalencesPage, title: '薬品同等性', parent: '/admin' },
  { path: '/admin/matching-rules', access: 'protected', adminOnly: true, useLayout: true, component: AdminMatchingRulesPage, title: 'マッチングルール', parent: '/admin' },
  { path: '/admin/openclaw', access: 'protected', adminOnly: true, useLayout: true, component: AdminOpenClawPage, title: 'OpenClaw連携', parent: '/admin' },
  { path: '/admin/openclaw-commands', access: 'protected', adminOnly: true, useLayout: true, component: AdminOpenClawCommandsPage, title: 'コマンド管理', parent: '/admin/openclaw' },
  { path: '/admin/pharmacy-health', access: 'protected', adminOnly: true, useLayout: true, component: AdminPharmacyHealthPage, title: '薬局ヘルス', parent: '/admin' },
  { path: '/admin/matching-performance', access: 'protected', adminOnly: true, useLayout: true, component: AdminMatchingPerformancePage, title: 'マッチング性能', parent: '/admin' },
  { path: '/admin/upload-quality', access: 'protected', adminOnly: true, useLayout: true, component: AdminUploadQualityPage, title: 'アップロード品質', parent: '/admin' },
  { path: '/admin/audit', access: 'protected', adminOnly: true, useLayout: true, component: AdminAuditPage, title: '監査ログ', parent: '/admin' },
  { path: '/admin/business-hours', access: 'protected', adminOnly: true, useLayout: true, component: AdminBusinessHoursPage, title: '営業時間', parent: '/admin' },
  { path: '/admin/bulk-actions', access: 'protected', adminOnly: true, useLayout: true, component: AdminBulkActionsPage, title: '一括操作', parent: '/admin' },
  { path: '/admin/relationships', access: 'protected', adminOnly: true, useLayout: true, component: AdminRelationshipsPage, title: '関係性監査', parent: '/admin' },
  { path: '/admin/log-center', access: 'protected', adminOnly: true, useLayout: true, component: AdminLogCenterPage, title: 'ログセンター', parent: '/admin' },
  { path: '/admin/rate-limits', access: 'protected', adminOnly: true, useLayout: true, component: AdminRateLimitsPage, title: 'レート制限設定', parent: '/admin' },
]);
