import type { Express } from 'express';
import authRoutes from '../routes/auth';
import verificationRoutes from '../routes/verification';
import accountRoutes from '../routes/account';
import adminRoutes from '../routes/admin';
import uploadRoutes from '../routes/upload';
import inventoryRoutes from '../routes/inventory';
import exchangeRoutes from '../routes/exchange';
import pharmaciesRoutes from '../routes/pharmacies';
import notificationsRoutes from '../routes/notifications';
import timelineRoutes from '../routes/timeline';
import requestsRoutes from '../routes/requests';
import openclawRoutes from '../routes/openclaw';
import businessHoursRoutes from '../routes/business-hours';
import searchRoutes from '../routes/search';
import drugMasterRoutes from '../routes/drug-master';
import adminErrorCodesRoutes from '../routes/admin-error-codes';
import adminLogCenterRoutes from '../routes/admin-log-center';
import openclawCommandsRoutes from '../routes/openclaw-commands';
import openclawConnectRoutes from '../routes/openclaw-connect';
import updatesRoutes from '../routes/updates';
import internalMatchingRefreshRoutes from '../routes/internal-matching-refresh';
import internalMonthlyReportsRoutes from '../routes/internal-monthly-reports';
import internalUploadJobsRoutes from '../routes/internal-upload-jobs';
import internalMonitoringRoutes from '../routes/internal-monitoring';
import internalPredictiveAlertsRoutes from '../routes/internal-predictive-alerts';
import internalVercelDeployEventsRoutes from '../routes/internal-vercel-deploy-events';
import statisticsRoutes from '../routes/statistics';
import groupsRoutes from '../routes/groups';
import alertsRoutes from '../routes/alerts';
import pushRoutes from '../routes/push';
import { requireLogin, rejectAdmin } from '../middleware/auth';
import { registerApiRoute } from './app-cors';

export function setupRoutes(app: Express): void {
  registerApiRoute(app, '/auth', authRoutes);
  registerApiRoute(app, '/auth', verificationRoutes);
  registerApiRoute(app, '/account', accountRoutes);
  registerApiRoute(app, '/admin', adminRoutes);
  // User-only routes (admin accounts are blocked)
  registerApiRoute(app, '/upload', rejectAdmin, uploadRoutes);
  registerApiRoute(app, '/inventory', rejectAdmin, inventoryRoutes);
  registerApiRoute(app, '/exchange', rejectAdmin, exchangeRoutes);
  registerApiRoute(app, '/pharmacies', rejectAdmin, pharmaciesRoutes);
  registerApiRoute(app, '/requests', rejectAdmin, requestsRoutes);
  registerApiRoute(app, '/business-hours', rejectAdmin, businessHoursRoutes);
  registerApiRoute(app, '/search', rejectAdmin, searchRoutes);
  registerApiRoute(app, '/statistics', rejectAdmin, statisticsRoutes);
  registerApiRoute(app, '/groups', requireLogin, rejectAdmin, groupsRoutes);
  registerApiRoute(app, '/alerts', requireLogin, rejectAdmin, alertsRoutes);
  registerApiRoute(app, '/push', rejectAdmin, pushRoutes);

  // Shared routes (both admin and user)
  registerApiRoute(app, '/notifications', notificationsRoutes);
  registerApiRoute(app, '/timeline', timelineRoutes);
  registerApiRoute(app, '/updates', updatesRoutes);

  // OpenClaw (webhook callbacks need access regardless)
  registerApiRoute(app, '/openclaw', openclawRoutes);
  registerApiRoute(app, '/openclaw/commands', openclawCommandsRoutes);
  registerApiRoute(app, '/openclaw/connect', openclawConnectRoutes);

  // Admin-only routes
  registerApiRoute(app, '/admin/drug-master', drugMasterRoutes);
  registerApiRoute(app, '/admin/error-codes', adminErrorCodesRoutes);
  registerApiRoute(app, '/admin/log-center', adminLogCenterRoutes);

  // Internal routes
  registerApiRoute(app, '/internal/matching-refresh', internalMatchingRefreshRoutes);
  registerApiRoute(app, '/internal/monthly-reports', internalMonthlyReportsRoutes);
  registerApiRoute(app, '/internal/upload-jobs', internalUploadJobsRoutes);
  registerApiRoute(app, '/internal/monitoring', internalMonitoringRoutes);
  registerApiRoute(app, '/internal/predictive-alerts', internalPredictiveAlertsRoutes);
  registerApiRoute(app, '/internal/vercel', internalVercelDeployEventsRoutes);
}
