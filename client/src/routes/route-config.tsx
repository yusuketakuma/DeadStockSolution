import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import LoginPage from '../pages/LoginPage';
import RegisterPage from '../pages/RegisterPage';
import PasswordResetPage from '../pages/PasswordResetPage';

const DashboardPage = lazy(() => import('../pages/DashboardPage'));
const AccountPage = lazy(() => import('../pages/AccountPage'));
const UploadPage = lazy(() => import('../pages/UploadPage'));
const DeadStockListPage = lazy(() => import('../pages/DeadStockListPage'));
const UsedMedicationListPage = lazy(() => import('../pages/UsedMedicationListPage'));
const InventoryBrowsePage = lazy(() => import('../pages/InventoryBrowsePage'));
const MatchingPage = lazy(() => import('../pages/MatchingPage'));
const ProposalsPage = lazy(() => import('../pages/ProposalsPage'));
const ProposalDetailPage = lazy(() => import('../pages/ProposalDetailPage'));
const ProposalPrintPage = lazy(() => import('../pages/ProposalPrintPage'));
const ExchangeHistoryPage = lazy(() => import('../pages/ExchangeHistoryPage'));
const PharmacyListPage = lazy(() => import('../pages/PharmacyListPage'));
const AdminDashboardPage = lazy(() => import('../pages/admin/AdminDashboardPage'));
const AdminPharmaciesPage = lazy(() => import('../pages/admin/AdminPharmaciesPage'));
const AdminExchangesPage = lazy(() => import('../pages/admin/AdminExchangesPage'));
const AdminLogsPage = lazy(() => import('../pages/admin/AdminLogsPage'));
const AdminRiskPage = lazy(() => import('../pages/admin/AdminRiskPage'));
const AdminMonthlyReportsPage = lazy(() => import('../pages/admin/AdminMonthlyReportsPage'));
const AdminDrugMasterPage = lazy(() => import('../pages/admin/AdminDrugMasterPage'));
const AdminOpenClawPage = lazy(() => import('../pages/admin/AdminOpenClawPage'));

type RouteComponent = ComponentType | LazyExoticComponent<ComponentType>;

interface BaseRouteMeta {
  path: string;
  component: RouteComponent;
}

export interface PublicRouteMeta extends BaseRouteMeta {
  access: 'public';
  redirectAuthenticatedTo: string;
  adminOnly?: never;
  useLayout?: never;
}

export interface ProtectedRouteMeta extends BaseRouteMeta {
  access: 'protected';
  adminOnly?: boolean;
  useLayout?: boolean;
  redirectAuthenticatedTo?: never;
}

export type RouteMeta = PublicRouteMeta | ProtectedRouteMeta;

export const ROUTE_META: RouteMeta[] = [
  { path: '/login', access: 'public', redirectAuthenticatedTo: '/', component: LoginPage },
  { path: '/register', access: 'public', redirectAuthenticatedTo: '/', component: RegisterPage },
  { path: '/password-reset', access: 'public', redirectAuthenticatedTo: '/', component: PasswordResetPage },

  { path: '/', access: 'protected', useLayout: true, component: DashboardPage },
  { path: '/account', access: 'protected', useLayout: true, component: AccountPage },
  { path: '/upload', access: 'protected', useLayout: true, component: UploadPage },
  { path: '/inventory/dead-stock', access: 'protected', useLayout: true, component: DeadStockListPage },
  { path: '/inventory/used-medication', access: 'protected', useLayout: true, component: UsedMedicationListPage },
  { path: '/inventory/browse', access: 'protected', useLayout: true, component: InventoryBrowsePage },
  { path: '/matching', access: 'protected', useLayout: true, component: MatchingPage },
  { path: '/proposals', access: 'protected', useLayout: true, component: ProposalsPage },
  { path: '/proposals/:id', access: 'protected', useLayout: true, component: ProposalDetailPage },
  { path: '/proposals/:id/print', access: 'protected', useLayout: false, component: ProposalPrintPage },
  { path: '/exchange-history', access: 'protected', useLayout: true, component: ExchangeHistoryPage },
  { path: '/pharmacies', access: 'protected', useLayout: true, component: PharmacyListPage },

  { path: '/admin', access: 'protected', adminOnly: true, useLayout: true, component: AdminDashboardPage },
  { path: '/admin/risk', access: 'protected', adminOnly: true, useLayout: true, component: AdminRiskPage },
  { path: '/admin/reports', access: 'protected', adminOnly: true, useLayout: true, component: AdminMonthlyReportsPage },
  { path: '/admin/pharmacies', access: 'protected', adminOnly: true, useLayout: true, component: AdminPharmaciesPage },
  { path: '/admin/exchanges', access: 'protected', adminOnly: true, useLayout: true, component: AdminExchangesPage },
  { path: '/admin/logs', access: 'protected', adminOnly: true, useLayout: true, component: AdminLogsPage },
  { path: '/admin/drug-master', access: 'protected', adminOnly: true, useLayout: true, component: AdminDrugMasterPage },
  { path: '/admin/openclaw', access: 'protected', adminOnly: true, useLayout: true, component: AdminOpenClawPage },
];
