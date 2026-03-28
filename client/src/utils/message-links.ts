export interface MessageLinkInput {
  pharmacyId: number;
  pharmacyName?: string | null;
  draft?: string | null;
  context?: 'matching' | 'proposal';
  contextId?: number | null;
}

export function buildMessagesPath(input: MessageLinkInput): string {
  const params = new URLSearchParams();
  params.set('pharmacyId', String(input.pharmacyId));
  if (input.pharmacyName) {
    params.set('pharmacyName', input.pharmacyName);
  }
  if (input.draft) {
    params.set('draft', input.draft);
  }
  if (input.context) {
    params.set('context', input.context);
  }
  if (input.contextId) {
    params.set('contextId', String(input.contextId));
  }
  return `/messages?${params.toString()}`;
}
