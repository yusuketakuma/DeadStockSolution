import { describe, it, expect } from 'vitest';
import { isCommandAllowed, BUILTIN_COMMANDS } from '../services/openclaw-command-service';

describe('openclaw-command-service', () => {
  describe('BUILTIN_COMMANDS', () => {
    it('should have system.status', () => {
      expect(BUILTIN_COMMANDS).toHaveProperty('system.status');
    });

    it('should include read, write, and admin categories', () => {
      const categories = new Set(Object.values(BUILTIN_COMMANDS).map(c => c.category));
      expect(categories).toContain('read');
      expect(categories).toContain('write');
      expect(categories).toContain('admin');
    });

    it('should have handlers as functions', () => {
      for (const [_name, def] of Object.entries(BUILTIN_COMMANDS)) {
        expect(typeof def.handler).toBe('function');
      }
    });

    it('should have Japanese descriptions', () => {
      for (const [_name, def] of Object.entries(BUILTIN_COMMANDS)) {
        expect(def.descriptionJa).toBeTruthy();
      }
    });
  });

  describe('isCommandAllowed', () => {
    it('should allow known commands', () => {
      expect(isCommandAllowed('system.status')).toBe(true);
      expect(isCommandAllowed('logs.query')).toBe(true);
      expect(isCommandAllowed('cache.clear')).toBe(true);
      expect(isCommandAllowed('maintenance.enable')).toBe(true);
    });

    it('should reject unknown commands', () => {
      expect(isCommandAllowed('system.destroy')).toBe(false);
      expect(isCommandAllowed('drop_database')).toBe(false);
      expect(isCommandAllowed('')).toBe(false);
      expect(isCommandAllowed('rm -rf')).toBe(false);
    });
  });
});
