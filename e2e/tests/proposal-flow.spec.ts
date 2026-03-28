import { type APIRequestContext, expect } from '@playwright/test';
import { createAuthenticatedPage, test } from '../fixtures/auth';

interface ProposalSeedResponse {
  actor: { id: number; name: string };
  counterparty: { id: number; name: string };
  candidate: Record<string, unknown>;
  stockIds: {
    actorDeadStockId: number;
    counterpartyDeadStockId: number;
  };
}

function buildInternalHeaders(): Record<string, string> {
  const secret = process.env.E2E_HELPER_SECRET?.trim();
  return secret ? { Authorization: `Bearer ${secret}` } : {};
}

async function seedProposalFlow(
  request: APIRequestContext,
  actorIndex = 0,
  counterpartyIndex = 1,
): Promise<ProposalSeedResponse> {
  const response = await request.post('/api/internal/e2e/proposal-flow/seed', {
    data: { actorIndex, counterpartyIndex },
    headers: buildInternalHeaders(),
  });
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<ProposalSeedResponse>;
}

async function createProposal(request: APIRequestContext, candidate: Record<string, unknown>): Promise<number> {
  const response = await request.post('/api/exchange/proposals', {
    data: { candidate },
  });
  expect(response.ok()).toBeTruthy();
  const payload = await response.json() as { proposalId: number };
  return payload.proposalId;
}

async function listProposalIds(request: APIRequestContext): Promise<number[]> {
  const response = await request.get('/api/exchange/proposals?page=1&sort=newest');
  expect(response.ok()).toBeTruthy();
  const payload = await response.json() as { data?: Array<{ id: number }> };
  return (payload.data ?? []).map((item) => item.id);
}

async function fetchProposalStatus(request: APIRequestContext, proposalId: number): Promise<string> {
  const response = await request.get(`/api/exchange/proposals/${proposalId}`);
  expect(response.ok()).toBeTruthy();
  const payload = await response.json() as { proposal?: { status?: string } };
  return payload.proposal?.status ?? '';
}

test.describe('提案フロー', () => {
  test('ハッピーパス: seed→提案→相互承認→完了', async ({ browser, baseURL, request }) => {
    const seed = await seedProposalFlow(request);
    const actor = await createAuthenticatedPage(browser, baseURL!, 0);
    const counterparty = await createAuthenticatedPage(browser, baseURL!, 1);

    const proposalId = await createProposal(actor.page.request, seed.candidate);
    await actor.page.goto(`/proposals/${proposalId}`);
    await expect(actor.page.getByText(`マッチング #${proposalId}`)).toBeVisible();

    const counterpartyProposalIds = await listProposalIds(counterparty.page.request);
    expect(counterpartyProposalIds).toContain(proposalId);

    const acceptFirst = await counterparty.page.request.post(`/api/exchange/proposals/${proposalId}/accept`);
    expect(acceptFirst.ok()).toBeTruthy();

    const acceptSecond = await actor.page.request.post(`/api/exchange/proposals/${proposalId}/accept`);
    expect(acceptSecond.ok()).toBeTruthy();

    const completeResponse = await actor.page.request.post(`/api/exchange/proposals/${proposalId}/complete`);
    expect(completeResponse.ok()).toBeTruthy();
    await expect.poll(async () => fetchProposalStatus(actor.page.request, proposalId)).toBe('completed');

    await actor.context.close();
    await counterparty.context.close();
  });

  test('提案拒否フロー', async ({ browser, baseURL, request }) => {
    const seed = await seedProposalFlow(request);
    const actor = await createAuthenticatedPage(browser, baseURL!, 0);
    const counterparty = await createAuthenticatedPage(browser, baseURL!, 1);

    const proposalId = await createProposal(actor.page.request, seed.candidate);

    const rejectResponse = await counterparty.page.request.post(`/api/exchange/proposals/${proposalId}/reject`);
    expect(rejectResponse.ok()).toBeTruthy();
    await expect.poll(async () => fetchProposalStatus(actor.page.request, proposalId)).toBe('rejected');

    await actor.context.close();
    await counterparty.context.close();
  });

  test('競合シナリオ: 在庫減少後の完了失敗を返す', async ({ browser, baseURL, request }) => {
    const seed = await seedProposalFlow(request);
    const actor = await createAuthenticatedPage(browser, baseURL!, 0);
    const counterparty = await createAuthenticatedPage(browser, baseURL!, 1);

    const proposalId = await createProposal(actor.page.request, seed.candidate);

    const acceptFirst = await counterparty.page.request.post(`/api/exchange/proposals/${proposalId}/accept`);
    expect(acceptFirst.ok()).toBeTruthy();
    const acceptSecond = await actor.page.request.post(`/api/exchange/proposals/${proposalId}/accept`);
    expect(acceptSecond.ok()).toBeTruthy();

    const depleteResponse = await request.post('/api/internal/e2e/proposal-flow/deplete', {
      data: {
        deadStockItemId: seed.stockIds.counterpartyDeadStockId,
        quantity: 0,
      },
      headers: buildInternalHeaders(),
    });
    expect(depleteResponse.ok()).toBeTruthy();

    const completeResponse = await actor.page.request.post(`/api/exchange/proposals/${proposalId}/complete`);
    expect(completeResponse.ok()).toBeFalsy();
    const payload = await completeResponse.json() as { error?: string };
    expect(payload.error ?? '').toContain('在庫状態の問題により交換を完了できません');

    await actor.context.close();
    await counterparty.context.close();
  });
});
