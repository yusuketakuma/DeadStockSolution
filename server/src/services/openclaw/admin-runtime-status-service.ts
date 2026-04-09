import { getDdsConnectionStatus } from '../dds-bootstrap-service';
import { getDdsRuntimeDigest, type DdsRuntimeDigest } from './runtime-digest-service';

export interface AdminDdsConnectionStatus {
  environment: string;
  connected: boolean;
  agentId: string | null;
  agentName: string | null;
  lastSeenAt: string | null;
  queuedJobs: number;
  awaitingUser: number;
  latestPrUrl: string | null;
  runtimeDigest: DdsRuntimeDigest;
}

export async function getAdminDdsConnectionStatus(): Promise<AdminDdsConnectionStatus> {
  const [connection, runtimeDigest] = await Promise.all([
    getDdsConnectionStatus(),
    getDdsRuntimeDigest(),
  ]);

  return {
    ...connection,
    runtimeDigest,
  };
}
