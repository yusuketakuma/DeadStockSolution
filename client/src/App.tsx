import { Suspense, lazy, type ReactElement } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import PasswordResetPage from './pages/PasswordResetPage';

const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const AccountPage = lazy(() => import('./pages/AccountPage'));
const UploadPage = lazy(() => import('./pages/UploadPage'));
const DeadStockListPage = lazy(() => import('./pages/DeadStockListPage'));
const UsedMedicationListPage = lazy(() => import('./pages/UsedMedicationListPage'));
const InventoryBrowsePage = lazy(() => import('./pages/InventoryBrowsePage'));
const MatchingPage = lazy(() => import('./pages/MatchingPage'));
const ProposalsPage = lazy(() => import('./pages/ProposalsPage'));
const ProposalDetailPage = lazy(() => import('./pages/ProposalDetailPage'));
const ProposalPrintPage = lazy(() => import('./pages/ProposalPrintPage'));
const ExchangeHistoryPage = lazy(() => import('./pages/ExchangeHistoryPage'));
const PharmacyListPage = lazy(() => import('./pages/PharmacyListPage'));
const AdminDashboardPage = lazy(() => import('./pages/admin/AdminDashboardPage'));
const AdminPharmaciesPage = lazy(() => import('./pages/admin/AdminPharmaciesPage'));
const AdminExchangesPage = lazy(() => import('./pages/admin/AdminExchangesPage'));
const AdminLogsPage = lazy(() => import('./pages/admin/AdminLogsPage'));
const AdminDrugMasterPage = lazy(() => import('./pages/admin/AdminDrugMasterPage'));
const AdminOpenClawPage = lazy(() => import('./pages/admin/AdminOpenClawPage'));

function RouteLoadingFallback() {
  return (
    <div className="d-flex justify-content-center align-items-center py-5">
      <div className="spinner-border text-primary" role="status">
        <span className="visually-hidden">読み込み中...</span>
      </div>
    </div>
  );
}

function withRouteSuspense(element: ReactElement): ReactElement {
  return (
    <Suspense fallback={<RouteLoadingFallback />}>
      {element}
    </Suspense>
  );
}

function AppRoutes() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="d-flex justify-content-center align-items-center" style={{ minHeight: '100vh' }}>
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">読み込み中...</span>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" /> : <LoginPage />} />
      <Route path="/register" element={user ? <Navigate to="/" /> : <RegisterPage />} />
      <Route path="/password-reset" element={user ? <Navigate to="/" /> : <PasswordResetPage />} />

      <Route path="/" element={
        withRouteSuspense(<ProtectedRoute><Layout><DashboardPage /></Layout></ProtectedRoute>)
      } />
      <Route path="/account" element={
        withRouteSuspense(<ProtectedRoute><Layout><AccountPage /></Layout></ProtectedRoute>)
      } />
      <Route path="/upload" element={
        withRouteSuspense(<ProtectedRoute><Layout><UploadPage /></Layout></ProtectedRoute>)
      } />
      <Route path="/inventory/dead-stock" element={
        withRouteSuspense(<ProtectedRoute><Layout><DeadStockListPage /></Layout></ProtectedRoute>)
      } />
      <Route path="/inventory/used-medication" element={
        withRouteSuspense(<ProtectedRoute><Layout><UsedMedicationListPage /></Layout></ProtectedRoute>)
      } />
      <Route path="/inventory/browse" element={
        withRouteSuspense(<ProtectedRoute><Layout><InventoryBrowsePage /></Layout></ProtectedRoute>)
      } />
      <Route path="/matching" element={
        withRouteSuspense(<ProtectedRoute><Layout><MatchingPage /></Layout></ProtectedRoute>)
      } />
      <Route path="/proposals" element={
        withRouteSuspense(<ProtectedRoute><Layout><ProposalsPage /></Layout></ProtectedRoute>)
      } />
      <Route path="/proposals/:id" element={
        withRouteSuspense(<ProtectedRoute><Layout><ProposalDetailPage /></Layout></ProtectedRoute>)
      } />
      <Route path="/proposals/:id/print" element={
        withRouteSuspense(<ProtectedRoute><ProposalPrintPage /></ProtectedRoute>)
      } />
      <Route path="/exchange-history" element={
        withRouteSuspense(<ProtectedRoute><Layout><ExchangeHistoryPage /></Layout></ProtectedRoute>)
      } />
      <Route path="/pharmacies" element={
        withRouteSuspense(<ProtectedRoute><Layout><PharmacyListPage /></Layout></ProtectedRoute>)
      } />

      {/* Admin */}
      <Route path="/admin" element={
        withRouteSuspense(<ProtectedRoute adminOnly><Layout><AdminDashboardPage /></Layout></ProtectedRoute>)
      } />
      <Route path="/admin/pharmacies" element={
        withRouteSuspense(<ProtectedRoute adminOnly><Layout><AdminPharmaciesPage /></Layout></ProtectedRoute>)
      } />
      <Route path="/admin/exchanges" element={
        withRouteSuspense(<ProtectedRoute adminOnly><Layout><AdminExchangesPage /></Layout></ProtectedRoute>)
      } />
      <Route path="/admin/logs" element={
        withRouteSuspense(<ProtectedRoute adminOnly><Layout><AdminLogsPage /></Layout></ProtectedRoute>)
      } />
      <Route path="/admin/drug-master" element={
        withRouteSuspense(<ProtectedRoute adminOnly><Layout><AdminDrugMasterPage /></Layout></ProtectedRoute>)
      } />
      <Route path="/admin/openclaw" element={
        withRouteSuspense(<ProtectedRoute adminOnly><Layout><AdminOpenClawPage /></Layout></ProtectedRoute>)
      } />

      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
