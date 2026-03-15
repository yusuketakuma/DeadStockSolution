import { describe, expect, it } from 'vitest';
import { getActionStatusAlertVariant } from '../../pages/admin/components/AdminLogCenterLogDetailModal';

describe('AdminLogCenterPage feedback helpers', () => {
  it('maps success and error states without relying on message text', () => {
    expect(getActionStatusAlertVariant('success')).toBe('success');
    expect(getActionStatusAlertVariant('error')).toBe('warning');
    expect(getActionStatusAlertVariant('info')).toBe('info');
  });
});
