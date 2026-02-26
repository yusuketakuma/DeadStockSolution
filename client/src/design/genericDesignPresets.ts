export type DesignPresetId = 'clinical-calm' | 'clinical-contrast' | 'neutral-business' | 'high-legibility';

export interface DesignPresetMeta {
  id: DesignPresetId;
  label: string;
  intent: string;
  useCases: string[];
  sourceNotes: string[];
}

export const DESIGN_PRESETS: DesignPresetMeta[] = [
  {
    id: 'clinical-calm',
    label: 'Clinical Calm',
    intent: '医療業務での長時間利用を想定した低刺激・高可読性バランス',
    useCases: ['日常運用画面', '一覧・入力画面', '管理画面全般'],
    sourceNotes: ['WCAG 2.2', 'USWDS Design Tokens', 'NHS Service Manual'],
  },
  {
    id: 'clinical-contrast',
    label: 'Clinical Contrast',
    intent: '視認性を最優先し、境界・文字・フォーカス差を強めた高コントラスト',
    useCases: ['高照度環境', '視認性重視運用', '監視端末'],
    sourceNotes: ['WCAG 2.2 contrast guidance', 'USWDS accessibility guidance'],
  },
  {
    id: 'neutral-business',
    label: 'Neutral Business',
    intent: '医療外の業務アプリにも流用しやすい中立配色',
    useCases: ['バックオフィス', '社内業務システム', '一般B2B管理画面'],
    sourceNotes: ['Material Design color system (neutral roles)', 'GOV.UK/NHS plain style guidance'],
  },
  {
    id: 'high-legibility',
    label: 'High Legibility',
    intent: '文字可読性・入力集中を最優先にした高視認トーン',
    useCases: ['高齢ユーザー対応', '夜勤/長時間運用', '入力ミス低減が重要な画面'],
    sourceNotes: ['WCAG 2.2 Focus Appearance', 'CDC Plain Language', 'USWDS Accessibility Guidance'],
  },
];

export const DESIGN_PRESET_STORAGE_KEY = 'dss.design-preset';

export function isDesignPresetId(value: string | null): value is DesignPresetId {
  return value === 'clinical-calm'
    || value === 'clinical-contrast'
    || value === 'neutral-business'
    || value === 'high-legibility';
}
