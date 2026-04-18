import { describe, expect, it } from 'vitest';
import * as facade from '../services/dds-agent-service';
import * as bootstrap from '../services/dds-bootstrap-service';
import * as enqueue from '../services/dds-enqueue-service';
import * as job from '../services/dds-job-service';
import * as lease from '../services/dds-lease-service';
import * as message from '../services/dds-message-service';

describe('dds-agent-service facade', () => {
  it('re-exports the split DDS service entry points', () => {
    expect(facade.issueDdsBootstrapToken).toBe(bootstrap.issueDdsBootstrapToken);
    expect(facade.registerDdsAgent).toBe(bootstrap.registerDdsAgent);
    expect(facade.rotateDdsControlToken).toBe(bootstrap.rotateDdsControlToken);
    expect(facade.getDdsConnectionStatus).toBe(bootstrap.getDdsConnectionStatus);
    expect(facade.heartbeatDdsAgent).toBe(bootstrap.heartbeatDdsAgent);
    expect(facade.enqueueDdsWorkItemFromHandoff).toBe(enqueue.enqueueDdsWorkItemFromHandoff);
    expect(facade.claimNextDdsJob).toBe(job.claimNextDdsJob);
    expect(facade.getDdsWorkItemAttachmentDownload).toBe(lease.getDdsWorkItemAttachmentDownload);
    expect(facade.postDdsQuestion).toBe(message.postDdsQuestion);
    expect(facade.reportDdsPullRequest).toBe(message.reportDdsPullRequest);
    expect(facade.completeDdsWorkItem).toBe(message.completeDdsWorkItem);
    expect(facade.listRequestMessagesForUser).toBe(message.listRequestMessagesForUser);
    expect(facade.addUserReplyToRequest).toBe(message.addUserReplyToRequest);
  });
});
