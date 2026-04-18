const MAX_TEMPLATES = 8;

export function loadStoredTemplates(storageKey: string): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, MAX_TEMPLATES);
  } catch {
    return [];
  }
}

export function persistStoredTemplates(storageKey: string, templates: string[]): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(storageKey, JSON.stringify(templates.slice(0, MAX_TEMPLATES)));
}

export function addStoredTemplate(templates: string[], value: string): string[] {
  const normalized = value.trim();
  if (!normalized) return templates;
  return [normalized, ...templates.filter((template) => template !== normalized)].slice(0, MAX_TEMPLATES);
}

export function removeStoredTemplate(templates: string[], value: string): string[] {
  return templates.filter((template) => template !== value);
}
