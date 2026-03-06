import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const openapiPath = path.resolve(__dirname, '..', '..', 'openapi', 'openapi.json');
const openapi = JSON.parse(fs.readFileSync(openapiPath, 'utf8'));

type ContractRequirement = {
  path: string;
  method: string;
  statuses: string[];
};

const REQUIRED_OPERATIONS: ContractRequirement[] = [
  { path: '/api/health', method: 'get', statuses: ['200', '503'] },
  { path: '/api/auth/login', method: 'post', statuses: ['200'] },
  { path: '/api/auth/register', method: 'post', statuses: ['201'] },
  { path: '/api/auth/password-reset/request', method: 'post', statuses: ['200', '400'] },
  { path: '/api/auth/password-reset/confirm', method: 'post', statuses: ['200', '400'] },
  { path: '/api/auth/test-pharmacies', method: 'get', statuses: ['200', '404', '503'] },
  { path: '/api/auth/me', method: 'get', statuses: ['200'] },
  { path: '/api/account', method: 'get', statuses: ['200'] },
  { path: '/api/account', method: 'put', statuses: ['200', '400', '409'] },
  { path: '/api/account', method: 'delete', statuses: ['200', '400', '404'] },
  { path: '/api/upload/status', method: 'get', statuses: ['200', '500'] },
  { path: '/api/upload/preview', method: 'post', statuses: ['200', '400', '500'] },
  { path: '/api/upload/diff-preview', method: 'post', statuses: ['200', '400', '500'] },
  { path: '/api/upload/confirm', method: 'post', statuses: ['202', '400', '409', '429', '500'] },
  { path: '/api/upload/confirm-async', method: 'post', statuses: ['202', '400', '409', '429', '500'] },
  { path: '/api/upload/jobs/{jobId}', method: 'get', statuses: ['200', '400', '404', '500'] },
  { path: '/api/upload/jobs/{jobId}/cancel', method: 'post', statuses: ['200', '400', '404', '409', '500'] },
  { path: '/api/upload/jobs/{jobId}/error-report', method: 'get', statuses: ['200', '400', '404', '500'] },
  { path: '/api/timeline', method: 'get', statuses: ['200', '400'] },
  { path: '/api/timeline/bootstrap', method: 'get', statuses: ['200'] },
  { path: '/api/timeline/unread-count', method: 'get', statuses: ['200'] },
  { path: '/api/timeline/mark-viewed', method: 'patch', statuses: ['200'] },
  { path: '/api/timeline/digest', method: 'get', statuses: ['200'] },
  { path: '/api/pharmacies', method: 'get', statuses: ['200'] },
  { path: '/api/pharmacies/relationships', method: 'get', statuses: ['200'] },
  { path: '/api/pharmacies/{id}', method: 'get', statuses: ['200'] },
  { path: '/api/pharmacies/{id}/favorite', method: 'post', statuses: ['200', '400', '404'] },
  { path: '/api/pharmacies/{id}/favorite', method: 'delete', statuses: ['200', '400'] },
  { path: '/api/pharmacies/{id}/block', method: 'post', statuses: ['200', '400', '404'] },
  { path: '/api/pharmacies/{id}/block', method: 'delete', statuses: ['200', '400'] },
  { path: '/api/search/drugs', method: 'get', statuses: ['200'] },
  { path: '/api/search/drug-master', method: 'get', statuses: ['200'] },
  { path: '/api/search/pharmacies', method: 'get', statuses: ['200'] },
  { path: '/api/statistics/summary', method: 'get', statuses: ['200', '500'] },
  { path: '/api/requests', method: 'post', statuses: ['201', '400', '401'] },
  { path: '/api/requests/me', method: 'get', statuses: ['200', '401'] },
  { path: '/api/auth/verification-status', method: 'get', statuses: ['200', '400', '404'] },
  { path: '/api/inventory/dead-stock/risk', method: 'get', statuses: ['200', '404', '500'] },
  { path: '/api/inventory/dead-stock/camera/resolve', method: 'post', statuses: ['200', '400', '500'] },
  { path: '/api/inventory/dead-stock/camera/manual-candidates', method: 'get', statuses: ['200', '400', '500'] },
  { path: '/api/inventory/dead-stock/camera/confirm-batch', method: 'post', statuses: ['201', '400', '500'] },
  { path: '/api/inventory/dead-stock/{id}', method: 'delete', statuses: ['200', '400', '404', '500'] },
  { path: '/api/inventory/used-medication', method: 'get', statuses: ['200', '500'] },
  { path: '/api/inventory/browse', method: 'get', statuses: ['200', '500'] },
  { path: '/api/exchange/find', method: 'post', statuses: ['200'] },
  { path: '/api/exchange/proposals', method: 'post', statuses: ['201', '400', '500'] },
  { path: '/api/exchange/proposals', method: 'get', statuses: ['200'] },
  { path: '/api/exchange/proposals/{id}', method: 'get', statuses: ['200'] },
  { path: '/api/exchange/proposals/{id}/print', method: 'get', statuses: ['200', '404', '500'] },
  { path: '/api/exchange/proposals/bulk-action', method: 'post', statuses: ['200', '400', '500'] },
  { path: '/api/exchange/proposals/{id}/accept', method: 'post', statuses: ['200', '404', '409'] },
  { path: '/api/exchange/proposals/{id}/reject', method: 'post', statuses: ['200', '404', '409'] },
  { path: '/api/exchange/proposals/{id}/complete', method: 'post', statuses: ['200', '404', '409'] },
  { path: '/api/exchange/proposals/{id}/comments', method: 'get', statuses: ['200', '404', '500'] },
  { path: '/api/exchange/proposals/{id}/comments', method: 'post', statuses: ['201', '400', '403', '404', '429', '500'] },
  { path: '/api/exchange/proposals/{id}/comments/{commentId}', method: 'patch', statuses: ['200', '400', '403', '404', '500'] },
  { path: '/api/exchange/proposals/{id}/comments/{commentId}', method: 'delete', statuses: ['200', '400', '403', '404', '500'] },
  { path: '/api/exchange/proposals/{id}/feedback', method: 'post', statuses: ['201', '400', '404', '500'] },
  { path: '/api/exchange/history', method: 'get', statuses: ['200', '400', '500'] },
  { path: '/api/business-hours', method: 'get', statuses: ['200', '500'] },
  { path: '/api/business-hours', method: 'put', statuses: ['200', '400', '409', '500'] },
  { path: '/api/business-hours/settings', method: 'get', statuses: ['200', '500'] },
  { path: '/api/business-hours/{pharmacyId}', method: 'get', statuses: ['200', '400', '500'] },
  { path: '/api/notifications', method: 'get', statuses: ['200'] },
  { path: '/api/notifications/unread-count', method: 'get', statuses: ['200'] },
  { path: '/api/notifications/read-all', method: 'patch', statuses: ['200'] },
  { path: '/api/notifications/{id}/read', method: 'patch', statuses: ['200'] },
  { path: '/api/notifications/messages/{id}/read', method: 'post', statuses: ['200'] },
  { path: '/api/notifications/matches/{id}/read', method: 'post', statuses: ['200'] },
  { path: '/api/openclaw/callback', method: 'post', statuses: ['200'] },
  { path: '/api/openclaw/commands', method: 'post', statuses: ['200', '400', '401', '403', '500', '503'] },
  { path: '/api/openclaw/commands/history', method: 'get', statuses: ['200', '500'] },
  { path: '/api/admin/stats', method: 'get', statuses: ['200'] },
  { path: '/api/admin/alerts', method: 'get', statuses: ['200'] },
  { path: '/api/admin/kpis', method: 'get', statuses: ['200'] },
  { path: '/api/admin/observability', method: 'get', statuses: ['200'] },
  { path: '/api/admin/logs', method: 'get', statuses: ['200'] },
  { path: '/api/admin/system-events', method: 'get', statuses: ['200'] },
  { path: '/api/admin/pharmacies/options', method: 'get', statuses: ['200'] },
  { path: '/api/admin/pharmacies', method: 'get', statuses: ['200'] },
  { path: '/api/admin/pharmacies/{id}', method: 'get', statuses: ['200', '400', '404'] },
  { path: '/api/admin/pharmacies/{id}', method: 'put', statuses: ['200', '400', '404', '409'] },
  { path: '/api/admin/pharmacies/{id}/business-hours/settings', method: 'get', statuses: ['200', '400', '404'] },
  { path: '/api/admin/pharmacies/{id}/business-hours', method: 'put', statuses: ['200', '400', '404', '409'] },
  { path: '/api/admin/pharmacies/{id}/toggle-active', method: 'put', statuses: ['200', '400', '404'] },
  { path: '/api/admin/pharmacies/{id}/verify', method: 'post', statuses: ['200', '400'] },
  { path: '/api/admin/exchanges', method: 'get', statuses: ['200'] },
  { path: '/api/admin/exchanges/{proposalId}/comments', method: 'get', statuses: ['200', '400', '404'] },
  { path: '/api/admin/exchanges/{proposalId}/timeline', method: 'get', statuses: ['200', '400', '404'] },
  { path: '/api/admin/messages', method: 'get', statuses: ['200'] },
  { path: '/api/admin/messages', method: 'post', statuses: ['201', '400', '404'] },
  { path: '/api/admin/requests', method: 'get', statuses: ['200'] },
  { path: '/api/admin/requests/{id}/handoff', method: 'post', statuses: ['200', '202', '400', '404'] },
  { path: '/api/admin/risk/overview', method: 'get', statuses: ['200'] },
  { path: '/api/admin/risk/pharmacies', method: 'get', statuses: ['200'] },
  { path: '/api/admin/reports/monthly', method: 'get', statuses: ['200'] },
  { path: '/api/admin/reports/monthly/generate', method: 'post', statuses: ['201', '400'] },
  { path: '/api/admin/reports/monthly/{id}/download', method: 'get', statuses: ['200', '400', '404'] },
  { path: '/api/admin/pharmacies/trust', method: 'get', statuses: ['200'] },
  { path: '/api/admin/pharmacies/trust/recalculate', method: 'post', statuses: ['202'] },
  { path: '/api/admin/upload-jobs', method: 'get', statuses: ['200'] },
  { path: '/api/admin/upload-jobs/{id}', method: 'get', statuses: ['200', '400', '404'] },
  { path: '/api/admin/upload-jobs/{id}/cancel', method: 'patch', statuses: ['200', '400', '404', '409'] },
  { path: '/api/admin/upload-jobs/{id}/retry', method: 'post', statuses: ['200', '400', '404', '409'] },
  { path: '/api/admin/upload-jobs/{id}/error-report', method: 'get', statuses: ['200', '400', '404'] },
  { path: '/api/admin/matching-rules/profile', method: 'get', statuses: ['200', '500'] },
  { path: '/api/admin/matching-rules/profile', method: 'put', statuses: ['200', '400', '409', '500'] },
  { path: '/api/admin/error-codes', method: 'get', statuses: ['200'] },
  { path: '/api/admin/error-codes', method: 'post', statuses: ['201', '400', '500'] },
  { path: '/api/admin/error-codes/{id}', method: 'put', statuses: ['200', '400', '404'] },
  { path: '/api/admin/log-center', method: 'get', statuses: ['200', '400'] },
  { path: '/api/admin/log-center/summary', method: 'get', statuses: ['200'] },
  { path: '/api/admin/drug-master/stats', method: 'get', statuses: ['200', '500'] },
  { path: '/api/admin/drug-master', method: 'get', statuses: ['200', '500'] },
  { path: '/api/admin/drug-master/detail/{yjCode}', method: 'get', statuses: ['200', '400', '404', '500'] },
  { path: '/api/admin/drug-master/detail/{yjCode}', method: 'put', statuses: ['200', '400', '404', '500'] },
  { path: '/api/admin/drug-master/sync', method: 'post', statuses: ['200', '400', '500'] },
  { path: '/api/admin/drug-master/upload-packages', method: 'post', statuses: ['200', '400', '500'] },
  { path: '/api/admin/drug-master/sync-logs', method: 'get', statuses: ['200', '500'] },
  { path: '/api/admin/drug-master/auto-sync', method: 'post', statuses: ['200', '500'] },
  { path: '/api/admin/drug-master/auto-sync/status', method: 'get', statuses: ['200', '500'] },
  { path: '/api/admin/drug-master/auto-sync/packages', method: 'post', statuses: ['200', '500'] },
  { path: '/api/admin/drug-master/auto-sync/packages/status', method: 'get', statuses: ['200', '500'] },
  { path: '/api/internal/matching-refresh/retry', method: 'get', statuses: ['200', '401', '500', '503'] },
  { path: '/api/internal/monthly-reports/run', method: 'get', statuses: ['200', '400', '401', '500', '503'] },
  { path: '/api/internal/upload-jobs/retry', method: 'get', statuses: ['200', '401', '500', '503'] },
  { path: '/api/internal/upload-jobs/retry', method: 'post', statuses: ['200', '401', '500', '503'] },
  { path: '/api/internal/monitoring/kpis', method: 'get', statuses: ['200', '401', '500', '503'] },
  { path: '/api/internal/monitoring/kpis', method: 'post', statuses: ['200', '401', '500', '503'] },
  { path: '/api/internal/predictive-alerts/run', method: 'get', statuses: ['200', '401', '500', '503'] },
  { path: '/api/internal/predictive-alerts/run', method: 'post', statuses: ['200', '401', '500', '503'] },
  { path: '/api/internal/vercel/deploy-events', method: 'post', statuses: ['202', '401', '500', '503'] },
  { path: '/api/updates/github', method: 'get', statuses: ['200', '502'] },
];

describe('openapi contract', () => {
  it('includes required paths/methods and response schemas', () => {
    for (const required of REQUIRED_OPERATIONS) {
      const pathItem = openapi.paths?.[required.path];
      expect(pathItem, `Missing path ${required.path}`).toBeDefined();

      const method = required.method.toLowerCase();
      const operation = pathItem?.[method];
      expect(operation, `Missing method ${method.toUpperCase()} on ${required.path}`).toBeDefined();

      const responses = operation?.responses;
      expect(responses, `Missing responses on ${required.path}`).toBeDefined();

      for (const status of required.statuses) {
        const response = responses[status];
        expect(response, `Missing response ${status} on ${required.path} ${method.toUpperCase()}`).toBeDefined();

        const schema = response?.content?.['application/json']?.schema;
        expect(schema, `Missing application/json schema for ${required.path} ${method.toUpperCase()} ${status}`).toBeDefined();
      }
    }
  });
});
