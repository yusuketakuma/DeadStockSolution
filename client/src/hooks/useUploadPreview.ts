import { useState, useCallback, useRef } from 'react';
import { api } from '../api/client';
import type { UploadType } from '../pages/upload/upload-job-utils';

export interface PreviewResponse {
  headers: string[];
  rows: string[][];
  suggestedMapping: Record<string, string | null>;
  suggestedMappingByType: Record<UploadType, Record<string, string | null> | null>;
  headerRowIndex: number;
  hasSavedMapping: boolean;
  detectedUploadType: UploadType;
  resolvedUploadType: UploadType;
  rememberedUploadType: UploadType | null;
  uploadTypeConfidence: 'high' | 'medium' | 'low';
  uploadTypeScores: {
    dead_stock: number;
    used_medication: number;
  };
  mappingComplete?: boolean;
  missingRequiredFields?: string[];
  fieldHints?: Record<string, string[]>;
}

export interface UseUploadPreviewOptions {
  onPreviewSuccess?: (data: PreviewResponse) => void;
}

export interface UseUploadPreviewReturn {
  preview: PreviewResponse | null;
  setPreview: React.Dispatch<React.SetStateAction<PreviewResponse | null>>;
  loading: boolean;
  error: string;
  handlePreview: (file: File, signal?: AbortSignal) => Promise<PreviewResponse | null>;
  resolveSubmittedMapping: (selectedUploadType: UploadType) => Record<string, string | null> | null;
  resolveConfidenceLabel: (confidence: PreviewResponse['uploadTypeConfidence']) => string;
  reset: () => void;
  currentMapping: Record<string, string | null>;
  mappingComplete: boolean;
  missingRequiredFields: string[];
  duplicateAssignedFields: string[];
  fieldHints: Record<string, string[]>;
  handleMappingChange: (field: string, columnIndex: string | null) => void;
  setActiveMappingUploadType: (uploadType: UploadType) => void;
}

export function resolveConfidenceLabel(confidence: PreviewResponse['uploadTypeConfidence']): string {
  switch (confidence) {
    case 'high':
      return '高';
    case 'medium':
      return '中';
    case 'low':
      return '低';
    default:
      return '不明';
  }
}

export function resolveSubmittedMapping(
  preview: PreviewResponse | null,
  selectedUploadType: UploadType,
): Record<string, string | null> | null {
  if (!preview) return null;
  const selectedTypeMapping = preview.suggestedMappingByType[selectedUploadType];
  if (selectedTypeMapping) {
    return selectedTypeMapping;
  }
  if (selectedUploadType === preview.resolvedUploadType) {
    return preview.suggestedMapping;
  }
  return null;
}

const REQUIRED_FIELDS_BY_TYPE: Record<UploadType, string[]> = {
  dead_stock: ['drug_name', 'drug_code', 'quantity', 'yakka_unit_price'],
  used_medication: ['drug_name', 'drug_code'],
};

function computeMissingRequiredFields(
  mapping: Record<string, string | null>,
  uploadType: UploadType,
): string[] {
  const requiredFields = REQUIRED_FIELDS_BY_TYPE[uploadType] ?? [];
  return requiredFields.filter((field) => mapping[field] === null || mapping[field] === undefined);
}

function computeDuplicateAssignedFields(
  mapping: Record<string, string | null>,
): string[] {
  const firstFieldByColumnIndex = new Map<string, string>();
  const duplicateFields = new Set<string>();

  for (const [field, columnIndex] of Object.entries(mapping)) {
    if (columnIndex === null || columnIndex === undefined || columnIndex === '') continue;
    const existingField = firstFieldByColumnIndex.get(columnIndex);
    if (existingField) {
      duplicateFields.add(existingField);
      duplicateFields.add(field);
      continue;
    }
    firstFieldByColumnIndex.set(columnIndex, field);
  }

  return [...duplicateFields];
}

function resolveInitialMappingForType(
  preview: PreviewResponse,
  uploadType: UploadType,
): Record<string, string | null> {
  return preview.suggestedMappingByType[uploadType]
    ?? (uploadType === preview.resolvedUploadType ? preview.suggestedMapping : {});
}

function buildInitialMappingByType(
  preview: PreviewResponse,
): Record<UploadType, Record<string, string | null>> {
  return {
    dead_stock: { ...resolveInitialMappingForType(preview, 'dead_stock') },
    used_medication: { ...resolveInitialMappingForType(preview, 'used_medication') },
  };
}

export function useUploadPreview(options: UseUploadPreviewOptions = {}): UseUploadPreviewReturn {
  const { onPreviewSuccess } = options;
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const [activeMappingUploadType, setActiveMappingUploadTypeState] = useState<UploadType>('dead_stock');
  const [mappingByType, setMappingByType] = useState<Record<UploadType, Record<string, string | null>>>({
    dead_stock: {},
    used_medication: {},
  });
  const [mappingComplete, setMappingComplete] = useState(false);
  const [missingRequiredFields, setMissingRequiredFields] = useState<string[]>([]);
  const [duplicateAssignedFields, setDuplicateAssignedFields] = useState<string[]>([]);
  const [fieldHints, setFieldHints] = useState<Record<string, string[]>>({});
  const currentMapping = mappingByType[activeMappingUploadType] ?? {};

  const applyDerivedState = useCallback((
    nextMappingByType: Record<UploadType, Record<string, string | null>>,
    nextActiveUploadType: UploadType,
  ) => {
    const activeMapping = nextMappingByType[nextActiveUploadType] ?? {};
    const missing = computeMissingRequiredFields(activeMapping, nextActiveUploadType);
    const duplicates = computeDuplicateAssignedFields(activeMapping);
    setMissingRequiredFields(missing);
    setDuplicateAssignedFields(duplicates);
    setMappingComplete(missing.length === 0 && duplicates.length === 0);
  }, []);

  const resetDerivedState = useCallback(() => {
    setMappingByType({ dead_stock: {}, used_medication: {} });
    setActiveMappingUploadTypeState('dead_stock');
    setMappingComplete(false);
    setMissingRequiredFields([]);
    setDuplicateAssignedFields([]);
    setFieldHints({});
  }, []);

  const handlePreview = useCallback(
    async (file: File, externalSignal?: AbortSignal): Promise<PreviewResponse | null> => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const onExternalAbort = () => controller.abort();

      if (externalSignal) {
        if (externalSignal.aborted) {
          if (abortRef.current === controller) {
            abortRef.current = null;
          }
          return null;
        }
        externalSignal.addEventListener('abort', onExternalAbort, { once: true });
      }

      setLoading(true);
      setError('');

      try {
        const formData = new FormData();
        formData.append('file', file);

        const data = await api.upload<PreviewResponse>('/upload/preview', formData, {
          signal: controller.signal,
        });

        if (controller.signal.aborted) {
          return null;
        }

        const initialMappings = buildInitialMappingByType(data);
        setPreview(data);
        setMappingByType(initialMappings);
        setActiveMappingUploadTypeState(data.resolvedUploadType);
        setFieldHints(data.fieldHints ?? {});
        applyDerivedState(initialMappings, data.resolvedUploadType);

        onPreviewSuccess?.(data);
        return data;
      } catch (err) {
        if (controller.signal.aborted) {
          return null;
        }
        setError(err instanceof Error ? err.message : 'プレビューに失敗しました');
        return null;
      } finally {
        const isLatestController = abortRef.current === controller;
        if (isLatestController) {
          abortRef.current = null;
        }
        if (externalSignal) {
          externalSignal.removeEventListener('abort', onExternalAbort);
        }
        if (!controller.signal.aborted || isLatestController) {
          setLoading(false);
        }
      }
    },
    [applyDerivedState, onPreviewSuccess],
  );

  const resolveMappingForType = useCallback(
    (selectedUploadType: UploadType): Record<string, string | null> | null => {
      if (!preview) {
        return null;
      }
      const mapping = mappingByType[selectedUploadType] ?? resolveInitialMappingForType(preview, selectedUploadType);
      const missing = computeMissingRequiredFields(mapping, selectedUploadType);
      const duplicates = computeDuplicateAssignedFields(mapping);
      return missing.length === 0 && duplicates.length === 0 ? mapping : null;
    },
    [mappingByType, preview],
  );

  const handleMappingChange = useCallback(
    (field: string, columnIndex: string | null) => {
      setMappingByType((prev) => {
        const next = {
          ...prev,
          [activeMappingUploadType]: {
            ...(prev[activeMappingUploadType] ?? {}),
            [field]: columnIndex,
          },
        };
        applyDerivedState(next, activeMappingUploadType);
        return next;
      });
    },
    [activeMappingUploadType, applyDerivedState],
  );

  const setActiveMappingUploadType = useCallback((uploadType: UploadType) => {
    setActiveMappingUploadTypeState(uploadType);
    applyDerivedState(mappingByType, uploadType);
  }, [applyDerivedState, mappingByType]);

  const setPreviewState = useCallback((value: React.SetStateAction<PreviewResponse | null>) => {
    setPreview((prev) => {
      const next = typeof value === 'function'
        ? (value as (current: PreviewResponse | null) => PreviewResponse | null)(prev)
        : value;
      if (next === null) {
        resetDerivedState();
      }
      return next;
    });
  }, [resetDerivedState]);

  const reset = useCallback(() => {
    setPreview(null);
    setError('');
    setLoading(false);
    resetDerivedState();
    abortRef.current?.abort();
    abortRef.current = null;
  }, [resetDerivedState]);

  return {
    preview,
    setPreview: setPreviewState,
    loading,
    error,
    handlePreview,
    resolveSubmittedMapping: resolveMappingForType,
    resolveConfidenceLabel,
    reset,
    currentMapping,
    mappingComplete,
    missingRequiredFields,
    duplicateAssignedFields,
    fieldHints,
    handleMappingChange,
    setActiveMappingUploadType,
  };
}
