import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import DashboardPage from './pages/DashboardPage';
import AccountPage from './pages/AccountPage';
import UploadPage from './pages/UploadPage';
import DeadStockListPage from './pages/DeadStockListPage';
import UsedMedicationListPage from './pages/UsedMedicationListPage';
import InventoryBrowsePage from './pages/InventoryBrowsePage';
import MatchingPage from './pages/MatchingPage';
import ProposalsPage from './pages/ProposalsPage';
import ProposalDetailPage from './pages/ProposalDetailPage';
import ProposalPrintPage from './pages/ProposalPrintPage';
import ExchangeHistoryPage from './pages/ExchangeHistoryPage';
import PharmacyListPage from './pages/PharmacyListPage';
import AdminDashboardPage from './pages/admin/AdminDashboardPage';
import AdminPharmaciesPage from './pages/admin/AdminPharmaciesPage';
import AdminExchangesPage from './pages/admin/AdminExchangesPage';
import AdminLogsPage from './pages/admin/AdminLogsPage';

function AppRoutes() {
  const { user, loading } = useAuth();

  if (loading) return null;

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" /> : <LoginPage />} />
      <Route path="/register" element={user ? <Navigate to="/" /> : <RegisterPage />} />

      <Route path="/" element={
        <ProtectedRoute><Layout><DashboardPage /></Layout></ProtectedRoute>
      } />
      <Route path="/account" element={
        <ProtectedRoute><Layout><AccountPage /></Layout></ProtectedRoute>
      } />
      <Route path="/upload" element={
        <ProtectedRoute><Layout><UploadPage /></Layout></ProtectedRoute>
      } />
      <Route path="/inventory/dead-stock" element={
        <ProtectedRoute><Layout><DeadStockListPage /></Layout></ProtectedRoute>
      } />
      <Route path="/inventory/used-medication" element={
        <ProtectedRoute><Layout><UsedMedicationListPage /></Layout></ProtectedRoute>
      } />
      <Route path="/inventory/browse" element={
        <ProtectedRoute><Layout><InventoryBrowsePage /></Layout></ProtectedRoute>
      } />
      <Route path="/matching" element={
        <ProtectedRoute><Layout><MatchingPage /></Layout></ProtectedRoute>
      } />
      <Route path="/proposals" element={
        <ProtectedRoute><Layout><ProposalsPage /></Layout></ProtectedRoute>
      } />
      <Route path="/proposals/:id" element={
        <ProtectedRoute><Layout><ProposalDetailPage /></Layout></ProtectedRoute>
      } />
      <Route path="/proposals/:id/print" element={
        <ProtectedRoute><ProposalPrintPage /></ProtectedRoute>
      } />
      <Route path="/exchange-history" element={
        <ProtectedRoute><Layout><ExchangeHistoryPage /></Layout></ProtectedRoute>
      } />
      <Route path="/pharmacies" element={
        <ProtectedRoute><Layout><PharmacyListPage /></Layout></ProtectedRoute>
      } />

      {/* Admin */}
      <Route path="/admin" element={
        <ProtectedRoute adminOnly><Layout><AdminDashboardPage /></Layout></ProtectedRoute>
      } />
      <Route path="/admin/pharmacies" element={
        <ProtectedRoute adminOnly><Layout><AdminPharmaciesPage /></Layout></ProtectedRoute>
      } />
      <Route path="/admin/exchanges" element={
        <ProtectedRoute adminOnly><Layout><AdminExchangesPage /></Layout></ProtectedRoute>
      } />
      <Route path="/admin/logs" element={
        <ProtectedRoute adminOnly><Layout><AdminLogsPage /></Layout></ProtectedRoute>
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
