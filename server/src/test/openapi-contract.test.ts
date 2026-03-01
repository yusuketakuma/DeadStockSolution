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
  { path: '/api/auth/me', method: 'get', statuses: ['200'] },
  { path: '/api/account', method: 'get', statuses: ['200'] },
  { path: '/api/pharmacies', method: 'get', statuses: ['200'] },
  { path: '/api/pharmacies/{id}', method: 'get', statuses: ['200'] },
  { path: '/api/exchange/find', method: 'post', statuses: ['200'] },
  { path: '/api/exchange/proposals', method: 'get', statuses: ['200'] },
  { path: '/api/openclaw/callback', method: 'post', statuses: ['200'] },
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
