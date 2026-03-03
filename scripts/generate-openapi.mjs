#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const OPENAPI_PATH = path.resolve(ROOT_DIR, 'server', 'openapi', 'openapi.json');
const IS_CHECK = process.argv.includes('--check');

const METHOD_ORDER = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'];

const ROUTE_BASELINE = [
  {
    path: '/api/account',
    method: 'get',
    operationId: 'getAccount',
    summary: 'Get account details',
    tags: ['Account'],
    responses: [
      { status: '200', description: 'Account details response', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/auth/csrf-token',
    method: 'get',
    operationId: 'getCsrfToken',
    summary: 'Get CSRF token',
    tags: ['Auth'],
    responses: [
      { status: '200', description: 'CSRF token response', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/auth/login',
    method: 'post',
    operationId: 'login',
    summary: 'Login',
    tags: ['Auth'],
    responses: [
      { status: '200', description: 'Login success response', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/auth/logout',
    method: 'post',
    operationId: 'logout',
    summary: 'Logout',
    tags: ['Auth'],
    responses: [
      { status: '200', description: 'Logout success response', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/auth/me',
    method: 'get',
    operationId: 'getMe',
    summary: 'Get current user',
    tags: ['Auth'],
    responses: [
      { status: '200', description: 'Current user response', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/auth/register',
    method: 'post',
    operationId: 'register',
    summary: 'Register user',
    tags: ['Auth'],
    responses: [
      { status: '201', description: 'Registration success response', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/auth/password-reset/request',
    method: 'post',
    operationId: 'requestPasswordReset',
    summary: 'Request password reset',
    tags: ['Auth'],
    responses: [
      { status: '200', description: 'Password reset request accepted', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '400', description: 'Invalid reset request payload', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/auth/password-reset/confirm',
    method: 'post',
    operationId: 'confirmPasswordReset',
    summary: 'Confirm password reset',
    tags: ['Auth'],
    responses: [
      { status: '200', description: 'Password reset completed', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '400', description: 'Invalid or expired reset token', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/auth/test-pharmacies',
    method: 'get',
    operationId: 'getTestPharmacies',
    summary: 'Get test pharmacy preview accounts',
    tags: ['Auth'],
    responses: [
      { status: '200', description: 'Test pharmacy account list', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '404', description: 'Test pharmacy preview unavailable', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '503', description: 'Test pharmacy schema unavailable', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/exchange/find',
    method: 'post',
    operationId: 'findExchange',
    summary: 'Find exchange proposals',
    tags: ['Exchange'],
    responses: [
      { status: '200', description: 'Exchange find response', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/exchange/proposals',
    method: 'get',
    operationId: 'listProposals',
    summary: 'List proposals',
    tags: ['Exchange'],
    responses: [
      { status: '200', description: 'Proposal list response', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/exchange/proposals/{id}',
    method: 'get',
    operationId: 'getProposal',
    summary: 'Get proposal detail',
    tags: ['Exchange'],
    responses: [
      { status: '200', description: 'Proposal response', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/health',
    method: 'get',
    operationId: 'getHealth',
    summary: 'Get health status',
    tags: ['System'],
    responses: [
      { status: '200', description: 'Healthy', schemaRef: '#/components/schemas/HealthResponse' },
      { status: '503', description: 'Degraded', schemaRef: '#/components/schemas/HealthResponse' },
    ],
  },
  {
    path: '/api/account',
    method: 'put',
    operationId: 'updateAccount',
    summary: 'Update account details',
    tags: ['Account'],
    responses: [
      { status: '200', description: 'Account update response', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '400', description: 'Invalid account update payload', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '409', description: 'Account update conflict', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/account',
    method: 'delete',
    operationId: 'deleteAccount',
    summary: 'Deactivate account',
    tags: ['Account'],
    responses: [
      { status: '200', description: 'Account deactivation response', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '400', description: 'Invalid account deactivation payload', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '404', description: 'Account not found', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/inventory/dead-stock',
    method: 'get',
    operationId: 'getDeadStock',
    summary: 'Get dead stock list',
    tags: ['Inventory'],
    responses: [
      { status: '200', description: 'Dead stock response', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/upload/status',
    method: 'get',
    operationId: 'getUploadStatus',
    summary: 'Get upload status',
    tags: ['Upload'],
    responses: [
      { status: '200', description: 'Upload status response', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '500', description: 'Upload status fetch failed', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/upload/preview',
    method: 'post',
    operationId: 'previewUpload',
    summary: 'Preview upload file',
    tags: ['Upload'],
    responses: [
      { status: '200', description: 'Upload preview response', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '400', description: 'Invalid upload preview request', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '500', description: 'Upload preview failed', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/upload/diff-preview',
    method: 'post',
    operationId: 'previewUploadDiff',
    summary: 'Preview upload diff',
    tags: ['Upload'],
    responses: [
      { status: '200', description: 'Upload diff preview response', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '400', description: 'Invalid upload diff preview request', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '500', description: 'Upload diff preview failed', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/upload/confirm',
    method: 'post',
    operationId: 'confirmUploadLegacy',
    summary: 'Enqueue upload confirm job (legacy endpoint)',
    tags: ['Upload'],
    responses: [
      { status: '202', description: 'Upload confirm job accepted', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '400', description: 'Invalid upload confirm request', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '409', description: 'Upload idempotency conflict', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '429', description: 'Upload queue limit exceeded', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '500', description: 'Upload confirm enqueue failed', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/upload/confirm-async',
    method: 'post',
    operationId: 'confirmUploadAsync',
    summary: 'Enqueue upload confirm job',
    tags: ['Upload'],
    responses: [
      { status: '202', description: 'Upload confirm async job accepted', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '400', description: 'Invalid upload confirm async request', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '409', description: 'Upload idempotency conflict', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '429', description: 'Upload queue limit exceeded', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '500', description: 'Upload confirm async enqueue failed', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/upload/jobs/{jobId}',
    method: 'get',
    operationId: 'getUploadJobStatus',
    summary: 'Get upload confirm job status',
    tags: ['Upload'],
    responses: [
      { status: '200', description: 'Upload job status response', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '400', description: 'Invalid job id', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '404', description: 'Upload job not found', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '500', description: 'Upload job status fetch failed', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/upload/jobs/{jobId}/cancel',
    method: 'post',
    operationId: 'cancelUploadJob',
    summary: 'Cancel upload confirm job',
    tags: ['Upload'],
    responses: [
      { status: '200', description: 'Upload job cancel response', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '400', description: 'Invalid job id', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '404', description: 'Upload job not found', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '409', description: 'Upload job cannot be canceled', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '500', description: 'Upload job cancel failed', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/upload/jobs/{jobId}/error-report',
    method: 'get',
    operationId: 'getUploadJobErrorReport',
    summary: 'Get upload confirm job error report',
    tags: ['Upload'],
    responses: [
      { status: '200', description: 'Upload job error report response', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '400', description: 'Invalid job id', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '404', description: 'Upload job error report not found', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '500', description: 'Upload job error report fetch failed', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/timeline',
    method: 'get',
    operationId: 'getTimeline',
    summary: 'Get timeline events',
    tags: ['Timeline'],
    responses: [
      { status: '200', description: 'Timeline response', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '400', description: 'Invalid timeline cursor', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/timeline/bootstrap',
    method: 'get',
    operationId: 'getTimelineBootstrap',
    summary: 'Get timeline bootstrap payload',
    tags: ['Timeline'],
    responses: [
      { status: '200', description: 'Timeline bootstrap response', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/timeline/unread-count',
    method: 'get',
    operationId: 'getTimelineUnreadCount',
    summary: 'Get timeline unread count',
    tags: ['Timeline'],
    responses: [
      { status: '200', description: 'Timeline unread count response', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/timeline/mark-viewed',
    method: 'patch',
    operationId: 'markTimelineViewed',
    summary: 'Mark timeline as viewed',
    tags: ['Timeline'],
    responses: [
      { status: '200', description: 'Timeline mark viewed response', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/timeline/digest',
    method: 'get',
    operationId: 'getTimelineDigest',
    summary: 'Get timeline digest',
    tags: ['Timeline'],
    responses: [
      { status: '200', description: 'Timeline digest response', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/notifications',
    method: 'get',
    operationId: 'getNotifications',
    summary: 'Get notifications',
    tags: ['Notifications'],
    responses: [
      { status: '200', description: 'Notifications response', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/notifications/unread-count',
    method: 'get',
    operationId: 'getNotificationsUnreadCount',
    summary: 'Get unread notifications count',
    tags: ['Notifications'],
    responses: [
      { status: '200', description: 'Unread count response', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/notifications/read-all',
    method: 'patch',
    operationId: 'markAllNotificationsRead',
    summary: 'Mark all notifications as read',
    tags: ['Notifications'],
    responses: [
      { status: '200', description: 'Mark all read response', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/notifications/{id}/read',
    method: 'patch',
    operationId: 'markNotificationRead',
    summary: 'Mark a notification as read',
    tags: ['Notifications'],
    responses: [
      { status: '200', description: 'Mark read response', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/notifications/messages/{id}/read',
    method: 'post',
    operationId: 'markAdminMessageRead',
    summary: 'Mark an admin message as read',
    tags: ['Notifications'],
    responses: [
      { status: '200', description: 'Admin message read response', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/notifications/matches/{id}/read',
    method: 'post',
    operationId: 'markMatchNotificationRead',
    summary: 'Mark a match update notification as read',
    tags: ['Notifications'],
    responses: [
      { status: '200', description: 'Match notification read response', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/updates/github',
    method: 'get',
    operationId: 'getGitHubUpdates',
    summary: 'Get GitHub updates feed',
    tags: ['Updates'],
    responses: [
      { status: '200', description: 'Updates response', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '502', description: 'GitHub updates fetch failed', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/openclaw/callback',
    method: 'post',
    operationId: 'openclawCallback',
    summary: 'OpenClaw callback',
    tags: ['OpenClaw'],
    responses: [
      { status: '200', description: 'Callback response', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/pharmacies',
    method: 'get',
    operationId: 'listPharmacies',
    summary: 'List pharmacies',
    tags: ['Pharmacies'],
    responses: [
      { status: '200', description: 'Pharmacy list response', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/pharmacies/{id}',
    method: 'get',
    operationId: 'getPharmacy',
    summary: 'Get pharmacy detail',
    tags: ['Pharmacies'],
    responses: [
      { status: '200', description: 'Pharmacy detail response', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/pharmacies/relationships',
    method: 'get',
    operationId: 'getPharmacyRelationships',
    summary: 'Get pharmacy relationships',
    tags: ['Pharmacies'],
    responses: [
      { status: '200', description: 'Pharmacy relationships response', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/pharmacies/{id}/favorite',
    method: 'post',
    operationId: 'addPharmacyFavorite',
    summary: 'Add pharmacy favorite',
    tags: ['Pharmacies'],
    responses: [
      { status: '200', description: 'Pharmacy favorite add response', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '400', description: 'Invalid favorite request', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '404', description: 'Target pharmacy not found', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/pharmacies/{id}/favorite',
    method: 'delete',
    operationId: 'removePharmacyFavorite',
    summary: 'Remove pharmacy favorite',
    tags: ['Pharmacies'],
    responses: [
      { status: '200', description: 'Pharmacy favorite remove response', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '400', description: 'Invalid favorite request', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/pharmacies/{id}/block',
    method: 'post',
    operationId: 'addPharmacyBlock',
    summary: 'Add pharmacy block',
    tags: ['Pharmacies'],
    responses: [
      { status: '200', description: 'Pharmacy block add response', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '400', description: 'Invalid block request', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '404', description: 'Target pharmacy not found', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/pharmacies/{id}/block',
    method: 'delete',
    operationId: 'removePharmacyBlock',
    summary: 'Remove pharmacy block',
    tags: ['Pharmacies'],
    responses: [
      { status: '200', description: 'Pharmacy block remove response', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '400', description: 'Invalid block request', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/search/drugs',
    method: 'get',
    operationId: 'searchDrugs',
    summary: 'Search drug suggestions',
    tags: ['Search'],
    responses: [
      { status: '200', description: 'Drug search response', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/search/drug-master',
    method: 'get',
    operationId: 'searchDrugMaster',
    summary: 'Search drug master entries',
    tags: ['Search'],
    responses: [
      { status: '200', description: 'Drug master search response', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/search/pharmacies',
    method: 'get',
    operationId: 'searchPharmacies',
    summary: 'Search pharmacy suggestions',
    tags: ['Search'],
    responses: [
      { status: '200', description: 'Pharmacy search response', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/statistics/summary',
    method: 'get',
    operationId: 'getStatisticsSummary',
    summary: 'Get statistics summary',
    tags: ['Statistics'],
    responses: [
      { status: '200', description: 'Statistics summary response', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '500', description: 'Statistics summary failed', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/requests',
    method: 'post',
    operationId: 'createUserRequest',
    summary: 'Submit user request',
    tags: ['Requests'],
    responses: [
      { status: '201', description: 'User request created', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '400', description: 'Invalid user request payload', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '401', description: 'Unauthorized request submission', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/requests/me',
    method: 'get',
    operationId: 'listMyRequests',
    summary: 'Get current user requests',
    tags: ['Requests'],
    responses: [
      { status: '200', description: 'User requests list response', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '401', description: 'Unauthorized request list access', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/auth/verification-status',
    method: 'get',
    operationId: 'getVerificationStatus',
    summary: 'Get verification status by email',
    tags: ['Auth'],
    responses: [
      { status: '200', description: 'Verification status response', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '400', description: 'Invalid verification status query', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '404', description: 'Account not found', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/inventory/dead-stock/risk',
    method: 'get',
    operationId: 'getDeadStockRiskSummary',
    summary: 'Get dead stock risk summary',
    tags: ['Inventory'],
    responses: [
      { status: '200', description: 'Dead stock risk summary response', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '404', description: 'Dead stock risk source not found', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '500', description: 'Dead stock risk summary failed', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/inventory/dead-stock/camera/resolve',
    method: 'post',
    operationId: 'resolveDeadStockCameraCode',
    summary: 'Resolve GS1/YJ code from camera/manual input',
    tags: ['Inventory'],
    responses: [
      { status: '200', description: 'Camera code resolved', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '400', description: 'Invalid camera code input', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '500', description: 'Camera code resolve failed', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/inventory/dead-stock/camera/manual-candidates',
    method: 'get',
    operationId: 'searchDeadStockCameraManualCandidates',
    summary: 'Search drug master candidates for unmatched camera rows',
    tags: ['Inventory'],
    responses: [
      { status: '200', description: 'Camera manual candidates response', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '400', description: 'Invalid manual candidate query', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '500', description: 'Manual candidate search failed', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/inventory/dead-stock/camera/confirm-batch',
    method: 'post',
    operationId: 'confirmDeadStockCameraBatch',
    summary: 'Confirm and persist dead stock rows captured by camera',
    tags: ['Inventory'],
    responses: [
      { status: '201', description: 'Camera dead stock batch created', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '400', description: 'Invalid camera dead stock batch', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '500', description: 'Camera dead stock batch failed', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/inventory/dead-stock/{id}',
    method: 'delete',
    operationId: 'deleteDeadStockItem',
    summary: 'Delete dead stock item',
    tags: ['Inventory'],
    responses: [
      { status: '200', description: 'Dead stock delete response', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '400', description: 'Invalid dead stock id', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '404', description: 'Dead stock item not found', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '500', description: 'Dead stock delete failed', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/inventory/used-medication',
    method: 'get',
    operationId: 'getUsedMedicationList',
    summary: 'Get used medication list',
    tags: ['Inventory'],
    responses: [
      { status: '200', description: 'Used medication list response', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '500', description: 'Used medication list failed', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/inventory/browse',
    method: 'get',
    operationId: 'browseInventory',
    summary: 'Browse network inventory',
    tags: ['Inventory'],
    responses: [
      { status: '200', description: 'Inventory browse response', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '500', description: 'Inventory browse failed', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/exchange/proposals',
    method: 'post',
    operationId: 'createProposal',
    summary: 'Create exchange proposal',
    tags: ['Exchange'],
    responses: [
      { status: '201', description: 'Exchange proposal created', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '400', description: 'Invalid proposal candidate payload', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '500', description: 'Exchange proposal create failed', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/exchange/proposals/bulk-action',
    method: 'post',
    operationId: 'bulkProposalAction',
    summary: 'Bulk accept or reject proposals',
    tags: ['Exchange'],
    responses: [
      { status: '200', description: 'Bulk proposal action response', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '400', description: 'Invalid bulk proposal action payload', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '500', description: 'Bulk proposal action failed', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/exchange/proposals/{id}/accept',
    method: 'post',
    operationId: 'acceptProposal',
    summary: 'Accept proposal',
    tags: ['Exchange'],
    responses: [
      { status: '200', description: 'Accept proposal response', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '404', description: 'Proposal not found', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '409', description: 'Proposal status conflict', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/exchange/proposals/{id}/reject',
    method: 'post',
    operationId: 'rejectProposal',
    summary: 'Reject proposal',
    tags: ['Exchange'],
    responses: [
      { status: '200', description: 'Reject proposal response', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '404', description: 'Proposal not found', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '409', description: 'Proposal status conflict', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/exchange/proposals/{id}/complete',
    method: 'post',
    operationId: 'completeProposal',
    summary: 'Complete proposal exchange',
    tags: ['Exchange'],
    responses: [
      { status: '200', description: 'Complete proposal response', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '404', description: 'Proposal not found', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '409', description: 'Proposal status conflict', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/exchange/proposals/{id}/print',
    method: 'get',
    operationId: 'getProposalPrintData',
    summary: 'Get proposal print payload',
    tags: ['Exchange'],
    responses: [
      { status: '200', description: 'Proposal print data response', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '404', description: 'Proposal print data not found', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '500', description: 'Proposal print data fetch failed', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/exchange/proposals/{id}/comments',
    method: 'get',
    operationId: 'listProposalComments',
    summary: 'List proposal comments',
    tags: ['Exchange'],
    responses: [
      { status: '200', description: 'Proposal comments list response', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '404', description: 'Proposal not found', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '500', description: 'Proposal comments list failed', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/exchange/proposals/{id}/comments',
    method: 'post',
    operationId: 'createProposalComment',
    summary: 'Create proposal comment',
    tags: ['Exchange'],
    responses: [
      { status: '201', description: 'Proposal comment created', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '400', description: 'Invalid proposal comment payload', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '403', description: 'Comment operation forbidden', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '404', description: 'Proposal not found', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '429', description: 'Proposal comment rate limited', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '500', description: 'Proposal comment create failed', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/exchange/proposals/{id}/comments/{commentId}',
    method: 'patch',
    operationId: 'updateProposalComment',
    summary: 'Update proposal comment',
    tags: ['Exchange'],
    responses: [
      { status: '200', description: 'Proposal comment updated', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '400', description: 'Invalid proposal comment update payload', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '403', description: 'Comment operation forbidden', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '404', description: 'Proposal comment not found', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '500', description: 'Proposal comment update failed', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/exchange/proposals/{id}/comments/{commentId}',
    method: 'delete',
    operationId: 'deleteProposalComment',
    summary: 'Delete proposal comment',
    tags: ['Exchange'],
    responses: [
      { status: '200', description: 'Proposal comment deleted', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '400', description: 'Invalid proposal comment delete payload', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '403', description: 'Comment operation forbidden', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '404', description: 'Proposal comment not found', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '500', description: 'Proposal comment delete failed', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/exchange/proposals/{id}/feedback',
    method: 'post',
    operationId: 'createProposalFeedback',
    summary: 'Create proposal feedback',
    tags: ['Exchange'],
    responses: [
      { status: '201', description: 'Proposal feedback created', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '400', description: 'Invalid proposal feedback payload', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '404', description: 'Proposal not found', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '500', description: 'Proposal feedback create failed', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/exchange/history',
    method: 'get',
    operationId: 'listExchangeHistory',
    summary: 'List exchange history',
    tags: ['Exchange'],
    responses: [
      { status: '200', description: 'Exchange history response', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '400', description: 'Invalid exchange history cursor', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '500', description: 'Exchange history failed', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/business-hours',
    method: 'get',
    operationId: 'getBusinessHours',
    summary: 'Get my business hours',
    tags: ['BusinessHours'],
    responses: [
      { status: '200', description: 'Business hours response', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '500', description: 'Business hours fetch failed', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/business-hours',
    method: 'put',
    operationId: 'updateBusinessHours',
    summary: 'Update my business hours',
    tags: ['BusinessHours'],
    responses: [
      { status: '200', description: 'Business hours updated', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '400', description: 'Invalid business hours payload', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '409', description: 'Business hours version conflict', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '500', description: 'Business hours update failed', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/business-hours/settings',
    method: 'get',
    operationId: 'getBusinessHourSettings',
    summary: 'Get my business hour settings',
    tags: ['BusinessHours'],
    responses: [
      { status: '200', description: 'Business hour settings response', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '500', description: 'Business hour settings fetch failed', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/business-hours/{pharmacyId}',
    method: 'get',
    operationId: 'getPharmacyBusinessHours',
    summary: 'Get pharmacy business hours',
    tags: ['BusinessHours'],
    responses: [
      { status: '200', description: 'Pharmacy business hours response', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '400', description: 'Invalid pharmacy id', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '500', description: 'Pharmacy business hours fetch failed', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/openclaw/commands',
    method: 'post',
    operationId: 'receiveOpenClawCommand',
    summary: 'Receive OpenClaw command webhook',
    tags: ['OpenClaw'],
    responses: [
      { status: '200', description: 'OpenClaw command processed', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '400', description: 'Invalid OpenClaw command payload', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '401', description: 'OpenClaw command authentication failed', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '403', description: 'OpenClaw command rejected', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '500', description: 'OpenClaw command processing failed', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '503', description: 'OpenClaw command service unavailable', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/openclaw/commands/history',
    method: 'get',
    operationId: 'getOpenClawCommandHistory',
    summary: 'Get OpenClaw command history',
    tags: ['OpenClaw'],
    responses: [
      { status: '200', description: 'OpenClaw command history response', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '500', description: 'OpenClaw command history failed', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/admin/stats',
    method: 'get',
    operationId: 'getAdminStats',
    summary: 'Get admin stats',
    tags: ['Admin'],
    responses: [
      { status: '200', description: 'Admin stats response', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/admin/alerts',
    method: 'get',
    operationId: 'getAdminAlerts',
    summary: 'Get admin alerts',
    tags: ['Admin'],
    responses: [
      { status: '200', description: 'Admin alerts response', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/admin/kpis',
    method: 'get',
    operationId: 'getAdminKpis',
    summary: 'Get admin KPI snapshot',
    tags: ['Admin'],
    responses: [
      { status: '200', description: 'Admin KPI snapshot response', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/admin/observability',
    method: 'get',
    operationId: 'getAdminObservability',
    summary: 'Get admin observability snapshot',
    tags: ['Admin'],
    responses: [
      { status: '200', description: 'Admin observability response', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/admin/logs',
    method: 'get',
    operationId: 'getAdminLogs',
    summary: 'Get admin activity logs',
    tags: ['Admin'],
    responses: [
      { status: '200', description: 'Admin logs response', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/admin/system-events',
    method: 'get',
    operationId: 'getAdminSystemEvents',
    summary: 'Get admin system events',
    tags: ['Admin'],
    responses: [
      { status: '200', description: 'Admin system events response', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/admin/pharmacies/options',
    method: 'get',
    operationId: 'getAdminPharmacyOptions',
    summary: 'Get admin pharmacy options',
    tags: ['Admin'],
    responses: [
      { status: '200', description: 'Admin pharmacy options response', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/admin/pharmacies',
    method: 'get',
    operationId: 'getAdminPharmacies',
    summary: 'Get admin pharmacies list',
    tags: ['Admin'],
    responses: [
      { status: '200', description: 'Admin pharmacies list response', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/admin/history',
    method: 'get',
    operationId: 'getAdminExchangeHistory',
    summary: 'Get admin exchange history list',
    tags: ['Admin'],
    responses: [
      { status: '200', description: 'Admin exchange history response', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/admin/messages',
    method: 'get',
    operationId: 'getAdminMessages',
    summary: 'Get admin message list',
    tags: ['Admin'],
    responses: [
      { status: '200', description: 'Admin message list response', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/admin/messages',
    method: 'post',
    operationId: 'createAdminMessage',
    summary: 'Create admin message',
    tags: ['Admin'],
    responses: [
      { status: '201', description: 'Admin message created', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '400', description: 'Invalid admin message payload', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '404', description: 'Admin message target not found', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/admin/requests',
    method: 'get',
    operationId: 'getAdminRequests',
    summary: 'Get admin requests list',
    tags: ['Admin'],
    responses: [
      { status: '200', description: 'Admin requests list response', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/admin/requests/{id}/handoff',
    method: 'post',
    operationId: 'handoffAdminRequest',
    summary: 'Handoff request to OpenClaw from admin',
    tags: ['Admin'],
    responses: [
      { status: '200', description: 'Admin request handoff accepted', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '202', description: 'Admin request handoff pending', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '400', description: 'Invalid admin request handoff state', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '404', description: 'Admin request not found', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/admin/pharmacies/{id}',
    method: 'get',
    operationId: 'getAdminPharmacyDetail',
    summary: 'Get admin pharmacy detail',
    tags: ['Admin'],
    responses: [
      { status: '200', description: 'Admin pharmacy detail response', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '400', description: 'Invalid pharmacy id', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '404', description: 'Pharmacy not found', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/admin/pharmacies/{id}',
    method: 'put',
    operationId: 'updateAdminPharmacy',
    summary: 'Update admin pharmacy detail',
    tags: ['Admin'],
    responses: [
      { status: '200', description: 'Admin pharmacy updated', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '400', description: 'Invalid admin pharmacy payload', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '404', description: 'Pharmacy not found', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '409', description: 'Admin pharmacy version conflict', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/admin/pharmacies/{id}/business-hours/settings',
    method: 'get',
    operationId: 'getAdminPharmacyBusinessHourSettings',
    summary: 'Get admin pharmacy business hour settings',
    tags: ['Admin'],
    responses: [
      { status: '200', description: 'Admin pharmacy business hour settings response', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '400', description: 'Invalid pharmacy id', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '404', description: 'Pharmacy not found', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/admin/pharmacies/{id}/business-hours',
    method: 'put',
    operationId: 'updateAdminPharmacyBusinessHours',
    summary: 'Update admin pharmacy business hours',
    tags: ['Admin'],
    responses: [
      { status: '200', description: 'Admin pharmacy business hours updated', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '400', description: 'Invalid admin pharmacy business hours payload', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '404', description: 'Pharmacy not found', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '409', description: 'Admin pharmacy business hours version conflict', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/admin/pharmacies/{id}/toggle-active',
    method: 'put',
    operationId: 'toggleAdminPharmacyActive',
    summary: 'Toggle admin pharmacy active state',
    tags: ['Admin'],
    responses: [
      { status: '200', description: 'Admin pharmacy active state toggled', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '400', description: 'Invalid pharmacy id', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '404', description: 'Pharmacy not found', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/admin/pharmacies/{id}/verify',
    method: 'post',
    operationId: 'verifyAdminPharmacy',
    summary: 'Verify admin pharmacy manually',
    tags: ['Admin'],
    responses: [
      { status: '200', description: 'Admin pharmacy verification updated', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '400', description: 'Invalid admin pharmacy verification payload', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/admin/exchanges',
    method: 'get',
    operationId: 'getAdminExchanges',
    summary: 'Get admin exchange proposals list',
    tags: ['Admin'],
    responses: [
      { status: '200', description: 'Admin exchange proposals response', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/admin/exchanges/{proposalId}/comments',
    method: 'get',
    operationId: 'getAdminExchangeComments',
    summary: 'Get admin exchange comments',
    tags: ['Admin'],
    responses: [
      { status: '200', description: 'Admin exchange comments response', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '400', description: 'Invalid proposal id', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '404', description: 'Proposal not found', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/admin/exchanges/{proposalId}/timeline',
    method: 'get',
    operationId: 'getAdminExchangeTimeline',
    summary: 'Get admin exchange timeline',
    tags: ['Admin'],
    responses: [
      { status: '200', description: 'Admin exchange timeline response', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '400', description: 'Invalid proposal id', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '404', description: 'Proposal not found', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/admin/risk/overview',
    method: 'get',
    operationId: 'getAdminRiskOverview',
    summary: 'Get admin risk overview',
    tags: ['Admin'],
    responses: [
      { status: '200', description: 'Admin risk overview response', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/admin/risk/pharmacies',
    method: 'get',
    operationId: 'getAdminRiskPharmacies',
    summary: 'Get admin risk pharmacy list',
    tags: ['Admin'],
    responses: [
      { status: '200', description: 'Admin risk pharmacy list response', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/admin/reports/monthly',
    method: 'get',
    operationId: 'getAdminMonthlyReports',
    summary: 'Get admin monthly reports list',
    tags: ['Admin'],
    responses: [
      { status: '200', description: 'Admin monthly reports list response', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/admin/reports/monthly/generate',
    method: 'post',
    operationId: 'generateAdminMonthlyReport',
    summary: 'Generate admin monthly report',
    tags: ['Admin'],
    responses: [
      { status: '201', description: 'Admin monthly report generated', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '400', description: 'Invalid monthly report generation payload', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/admin/reports/monthly/{id}/download',
    method: 'get',
    operationId: 'downloadAdminMonthlyReport',
    summary: 'Download admin monthly report',
    tags: ['Admin'],
    responses: [
      { status: '200', description: 'Admin monthly report download response', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '400', description: 'Invalid monthly report id', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '404', description: 'Monthly report not found', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/admin/pharmacies/trust',
    method: 'get',
    operationId: 'getAdminTrustScores',
    summary: 'Get admin trust score list',
    tags: ['Admin'],
    responses: [
      { status: '200', description: 'Admin trust score list response', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/admin/pharmacies/trust/recalculate',
    method: 'post',
    operationId: 'recalculateAdminTrustScores',
    summary: 'Trigger admin trust score recalculation',
    tags: ['Admin'],
    responses: [
      { status: '202', description: 'Admin trust score recalculation accepted', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/admin/upload-jobs',
    method: 'get',
    operationId: 'getAdminUploadJobs',
    summary: 'Get admin upload jobs list',
    tags: ['Admin'],
    responses: [
      { status: '200', description: 'Admin upload jobs list response', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/admin/upload-jobs/{id}',
    method: 'get',
    operationId: 'getAdminUploadJobDetail',
    summary: 'Get admin upload job detail',
    tags: ['Admin'],
    responses: [
      { status: '200', description: 'Admin upload job detail response', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '400', description: 'Invalid upload job id', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '404', description: 'Upload job not found', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/admin/upload-jobs/{id}/cancel',
    method: 'patch',
    operationId: 'cancelAdminUploadJob',
    summary: 'Cancel admin upload job',
    tags: ['Admin'],
    responses: [
      { status: '200', description: 'Admin upload job cancel response', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '400', description: 'Invalid upload job id', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '404', description: 'Upload job not found', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '409', description: 'Upload job cancel conflict', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/admin/upload-jobs/{id}/retry',
    method: 'post',
    operationId: 'retryAdminUploadJob',
    summary: 'Retry admin upload job',
    tags: ['Admin'],
    responses: [
      { status: '200', description: 'Admin upload job retry response', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '400', description: 'Invalid upload job id', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '404', description: 'Upload job not found', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '409', description: 'Upload job retry conflict', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/admin/upload-jobs/{id}/error-report',
    method: 'get',
    operationId: 'getAdminUploadJobErrorReport',
    summary: 'Get admin upload job error report',
    tags: ['Admin'],
    responses: [
      { status: '200', description: 'Admin upload job error report response', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '400', description: 'Invalid upload job id', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '404', description: 'Upload job error report not found', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/admin/matching-rules/profile',
    method: 'get',
    operationId: 'getAdminMatchingRulesProfile',
    summary: 'Get admin matching rules profile',
    tags: ['Admin'],
    responses: [
      { status: '200', description: 'Admin matching rules profile response', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '500', description: 'Admin matching rules profile fetch failed', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/admin/matching-rules/profile',
    method: 'put',
    operationId: 'updateAdminMatchingRulesProfile',
    summary: 'Update admin matching rules profile',
    tags: ['Admin'],
    responses: [
      { status: '200', description: 'Admin matching rules profile updated', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '400', description: 'Invalid admin matching rules profile payload', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '409', description: 'Admin matching rules profile version conflict', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '500', description: 'Admin matching rules profile update failed', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/admin/error-codes',
    method: 'get',
    operationId: 'getAdminErrorCodes',
    summary: 'Get admin error codes',
    tags: ['Admin'],
    responses: [
      { status: '200', description: 'Admin error codes response', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/admin/error-codes',
    method: 'post',
    operationId: 'createAdminErrorCode',
    summary: 'Create admin error code',
    tags: ['Admin'],
    responses: [
      { status: '201', description: 'Admin error code created', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '400', description: 'Invalid admin error code payload', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '500', description: 'Admin error code create failed', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/admin/error-codes/{id}',
    method: 'put',
    operationId: 'updateAdminErrorCode',
    summary: 'Update admin error code',
    tags: ['Admin'],
    responses: [
      { status: '200', description: 'Admin error code updated', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '400', description: 'Invalid admin error code id or payload', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '404', description: 'Admin error code not found', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/admin/log-center',
    method: 'get',
    operationId: 'getAdminLogCenter',
    summary: 'Get admin log center entries',
    tags: ['Admin'],
    responses: [
      { status: '200', description: 'Admin log center response', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '400', description: 'Invalid admin log center query', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/admin/log-center/summary',
    method: 'get',
    operationId: 'getAdminLogCenterSummary',
    summary: 'Get admin log center summary',
    tags: ['Admin'],
    responses: [
      { status: '200', description: 'Admin log center summary response', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/admin/drug-master/stats',
    method: 'get',
    operationId: 'getAdminDrugMasterStats',
    summary: 'Get admin drug master stats',
    tags: ['Admin'],
    responses: [
      { status: '200', description: 'Admin drug master stats response', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '500', description: 'Admin drug master stats failed', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/admin/drug-master',
    method: 'get',
    operationId: 'getAdminDrugMasterList',
    summary: 'Get admin drug master list',
    tags: ['Admin'],
    responses: [
      { status: '200', description: 'Admin drug master list response', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '500', description: 'Admin drug master list failed', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/admin/drug-master/detail/{yjCode}',
    method: 'get',
    operationId: 'getAdminDrugMasterDetail',
    summary: 'Get admin drug master detail',
    tags: ['Admin'],
    responses: [
      { status: '200', description: 'Admin drug master detail response', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '400', description: 'Invalid yjCode', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '404', description: 'Drug master item not found', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '500', description: 'Admin drug master detail failed', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/admin/drug-master/detail/{yjCode}',
    method: 'put',
    operationId: 'updateAdminDrugMasterDetail',
    summary: 'Update admin drug master detail',
    tags: ['Admin'],
    responses: [
      { status: '200', description: 'Admin drug master detail updated', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '400', description: 'Invalid yjCode or payload', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '404', description: 'Drug master item not found', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '500', description: 'Admin drug master detail update failed', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/admin/drug-master/sync',
    method: 'post',
    operationId: 'syncAdminDrugMaster',
    summary: 'Sync admin drug master',
    tags: ['Admin'],
    responses: [
      { status: '200', description: 'Admin drug master sync completed', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '400', description: 'Invalid admin drug master sync payload', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '500', description: 'Admin drug master sync failed', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/admin/drug-master/upload-packages',
    method: 'post',
    operationId: 'uploadAdminDrugMasterPackages',
    summary: 'Upload admin drug master package data',
    tags: ['Admin'],
    responses: [
      { status: '200', description: 'Admin drug master package upload completed', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '400', description: 'Invalid admin drug master package upload payload', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '500', description: 'Admin drug master package upload failed', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/admin/drug-master/sync-logs',
    method: 'get',
    operationId: 'getAdminDrugMasterSyncLogs',
    summary: 'Get admin drug master sync logs',
    tags: ['Admin'],
    responses: [
      { status: '200', description: 'Admin drug master sync logs response', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '500', description: 'Admin drug master sync logs failed', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/admin/drug-master/auto-sync',
    method: 'post',
    operationId: 'triggerAdminDrugMasterAutoSync',
    summary: 'Trigger admin drug master auto sync',
    tags: ['Admin'],
    responses: [
      { status: '200', description: 'Admin drug master auto sync trigger response', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '500', description: 'Admin drug master auto sync trigger failed', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/admin/drug-master/auto-sync/status',
    method: 'get',
    operationId: 'getAdminDrugMasterAutoSyncStatus',
    summary: 'Get admin drug master auto sync status',
    tags: ['Admin'],
    responses: [
      { status: '200', description: 'Admin drug master auto sync status response', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '500', description: 'Admin drug master auto sync status failed', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/admin/drug-master/auto-sync/packages',
    method: 'post',
    operationId: 'triggerAdminDrugMasterPackageAutoSync',
    summary: 'Trigger admin drug master package auto sync',
    tags: ['Admin'],
    responses: [
      { status: '200', description: 'Admin drug master package auto sync trigger response', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '500', description: 'Admin drug master package auto sync trigger failed', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/admin/drug-master/auto-sync/packages/status',
    method: 'get',
    operationId: 'getAdminDrugMasterPackageAutoSyncStatus',
    summary: 'Get admin drug master package auto sync status',
    tags: ['Admin'],
    responses: [
      { status: '200', description: 'Admin drug master package auto sync status response', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '500', description: 'Admin drug master package auto sync status failed', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/internal/matching-refresh/retry',
    method: 'get',
    operationId: 'retryInternalMatchingRefresh',
    summary: 'Retry internal matching refresh jobs',
    tags: ['Internal'],
    responses: [
      { status: '200', description: 'Internal matching refresh retry response', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '401', description: 'Internal matching refresh unauthorized', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '500', description: 'Internal matching refresh retry failed', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '503', description: 'Internal matching refresh not configured', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/internal/monthly-reports/run',
    method: 'get',
    operationId: 'runInternalMonthlyReport',
    summary: 'Run internal monthly report job',
    tags: ['Internal'],
    responses: [
      { status: '200', description: 'Internal monthly report run response', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '400', description: 'Invalid internal monthly report run payload', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '401', description: 'Internal monthly report unauthorized', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '500', description: 'Internal monthly report run failed', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '503', description: 'Internal monthly report not configured', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/internal/upload-jobs/retry',
    method: 'get',
    operationId: 'retryInternalUploadJobsGet',
    summary: 'Retry internal upload jobs (GET)',
    tags: ['Internal'],
    responses: [
      { status: '200', description: 'Internal upload jobs retry response', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '401', description: 'Internal upload jobs unauthorized', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '500', description: 'Internal upload jobs retry failed', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '503', description: 'Internal upload jobs not configured', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/internal/upload-jobs/retry',
    method: 'post',
    operationId: 'retryInternalUploadJobsPost',
    summary: 'Retry internal upload jobs (POST)',
    tags: ['Internal'],
    responses: [
      { status: '200', description: 'Internal upload jobs retry response', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '401', description: 'Internal upload jobs unauthorized', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '500', description: 'Internal upload jobs retry failed', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '503', description: 'Internal upload jobs not configured', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/internal/monitoring/kpis',
    method: 'get',
    operationId: 'getInternalMonitoringKpis',
    summary: 'Get internal monitoring KPI snapshot',
    tags: ['Internal'],
    responses: [
      { status: '200', description: 'Internal monitoring KPI response', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '401', description: 'Internal monitoring unauthorized', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '500', description: 'Internal monitoring KPI failed', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '503', description: 'Internal monitoring not configured', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/internal/monitoring/kpis',
    method: 'post',
    operationId: 'postInternalMonitoringKpis',
    summary: 'Trigger internal monitoring KPI snapshot',
    tags: ['Internal'],
    responses: [
      { status: '200', description: 'Internal monitoring KPI response', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '401', description: 'Internal monitoring unauthorized', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '500', description: 'Internal monitoring KPI failed', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '503', description: 'Internal monitoring not configured', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/internal/predictive-alerts/run',
    method: 'get',
    operationId: 'runInternalPredictiveAlertsGet',
    summary: 'Run internal predictive alerts (GET)',
    tags: ['Internal'],
    responses: [
      { status: '200', description: 'Internal predictive alerts run response', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '401', description: 'Internal predictive alerts unauthorized', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '500', description: 'Internal predictive alerts run failed', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '503', description: 'Internal predictive alerts not configured', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/internal/predictive-alerts/run',
    method: 'post',
    operationId: 'runInternalPredictiveAlertsPost',
    summary: 'Run internal predictive alerts (POST)',
    tags: ['Internal'],
    responses: [
      { status: '200', description: 'Internal predictive alerts run response', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '401', description: 'Internal predictive alerts unauthorized', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '500', description: 'Internal predictive alerts run failed', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '503', description: 'Internal predictive alerts not configured', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
  {
    path: '/api/internal/vercel/deploy-events',
    method: 'post',
    operationId: 'ingestInternalVercelDeployEvent',
    summary: 'Ingest internal Vercel deploy event',
    tags: ['Internal'],
    responses: [
      { status: '202', description: 'Internal Vercel deploy event accepted', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '401', description: 'Internal Vercel deploy event unauthorized', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '500', description: 'Internal Vercel deploy event ingest failed', schemaRef: '#/components/schemas/GenericResponse' },
      { status: '503', description: 'Internal Vercel deploy event not configured', schemaRef: '#/components/schemas/GenericResponse' },
    ],
  },
];

function buildResponses(entries) {
  return entries.reduce((acc, entry) => {
    acc[entry.status] = {
      description: entry.description,
      content: {
        'application/json': {
          schema: {
            $ref: entry.schemaRef,
          },
        },
      },
    };

    return acc;
  }, {});
}

function sortRouteOrder(a, b) {
  if (a.path === b.path) {
    return METHOD_ORDER.indexOf(a.method) - METHOD_ORDER.indexOf(b.method);
  }
  return a.path.localeCompare(b.path);
}

async function generateOpenApi() {
  const sortedRoutes = [...ROUTE_BASELINE]
    .map((route) => ({ ...route, method: route.method.toLowerCase() }))
    .sort(sortRouteOrder);

  const paths = {};
  for (const route of sortedRoutes) {
    if (!paths[route.path]) {
      paths[route.path] = {};
    }
    paths[route.path][route.method] = {
      operationId: route.operationId,
      summary: route.summary,
      tags: route.tags,
      responses: buildResponses(route.responses),
    };
  }

  const spec = {
    openapi: '3.1.0',
    info: {
      title: 'DeadStockSolution API',
      version: '1.0.0',
      description: 'Baseline OpenAPI contract for public server routes',
    },
    paths,
    components: {
      schemas: {
        GenericResponse: {
          type: 'object',
          additionalProperties: true,
        },
        HealthResponse: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            timestamp: { type: 'string', format: 'date-time' },
            checks: { type: 'object', additionalProperties: true },
            uptime: { type: 'number' },
          },
          required: ['status', 'timestamp'],
          additionalProperties: true,
        },
      },
    },
  };

  await fs.mkdir(path.dirname(OPENAPI_PATH), { recursive: true });
  return `${JSON.stringify(spec, null, 2)}\n`;
}

const generated = await generateOpenApi();

if (IS_CHECK) {
  const existing = await fs.readFile(OPENAPI_PATH, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') {
      return '';
    }
    throw error;
  });

  if (existing !== generated) {
    console.error('OpenAPI contract mismatch. Regenerate with npm run openapi:generate');
    process.exit(1);
  }

  console.log('OpenAPI contract is up to date');
  process.exit(0);
}

await fs.writeFile(OPENAPI_PATH, generated, 'utf8');
console.log(`Wrote OpenAPI contract: ${OPENAPI_PATH}`);
