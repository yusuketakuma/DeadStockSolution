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
