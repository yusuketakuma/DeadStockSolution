import { db } from '../config/database';
import { logger } from './logger';

export interface ServiceDependencies {
  db: typeof db;
  logger: typeof logger;
}

const defaultDeps: ServiceDependencies = { db, logger };

export function getServiceDeps(): ServiceDependencies {
  return defaultDeps;
}

export function createTestDeps(overrides: Partial<ServiceDependencies>): ServiceDependencies {
  return { ...defaultDeps, ...overrides };
}
