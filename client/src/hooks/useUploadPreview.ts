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
  fieldHints: Record<string, string[]>;
  handleMappingChange: (field: string, columnIndex: string | null) => void;
}

/**
 * Resolve confidence level to human-readable label.
 */
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

/**
 * Resolve the mapping to be submitted based on selected upload type.
 */
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

/**
 * Hook for managing upload preview state and operations.
 * Handles file preview fetching and mapping resolution.
 */
const REQUIRED_FIELDS_BY_TYPE: Record<UploadType, string[]> = {
  dead_stock: ['drug_name', 'drug_code', 'quantity', 'yakka_unit_price'],
  used_medication: ['drug_name', 'drug_code'],
};

function computeMissingRequiredFields(
  mapping: Record<string, string | null>,
  uploadType: UploadType,
): string[] {
  const requiredFields = REQUIRED_FIELDS_BY_TYPE[uploadType] ?? [];
  return requiredFields.filter((f) => mapping[f] === null || mapping[f] === undefined);
}

export function useUploadPreview(options: UseUploadPreviewOptions = {}): UseUploadPreviewReturn {
  const { onPreviewSuccess } = options;
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const [currentMapping, setCurrentMapping] = useState<Record<string, string | null>>({});
  const [mappingComplete, setMappingComplete] = useState(false);
  const [missingRequiredFields, setMissingRequiredFields] = useState<string[]>([]);
  const [fieldHints, setFieldHints] = useState<Record<string, string[]>>({});

  const handlePreview = useCallback(
    async (file: File, externalSignal?: AbortSignal): Promise<PreviewResponse | null> => {
      // Abort any previous request
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      // Link to external signal if provided
      if (externalSignal) {
        if (externalSignal.aborted) {
          return null;
        }
        externalSignal.addEventListener('abort', () => controller.abort());
      }

      setLoading(true);
      setError('');

      try {
        const formData = new FormData();
        formData.append('file', file);

        const data = await api.upload<PreviewResponse>('/upload/preview', formData, {
          signal: controller.signal,
        });

        if (controller.signal.aborted) return null;

        setPreview(data);

        // Initialize mapping state from preview response
        const initialMapping = data.suggestedMapping ?? {};
        setCurrentMapping(initialMapping);
        setFieldHints(data.fieldHints ?? {});
        const resolvedType = data.resolvedUploadType ?? 'dead_stock';
        const missing = data.missingRequiredFields ?? computeMissingRequiredFields(initialMapping, resolvedType);
        setMissingRequiredFields(missing);
        setMappingComplete(data.mappingComplete ?? missing.length === 0);

        onPreviewSuccess?.(data);
        return data;
      } catch (err) {
        if (controller.signal.aborted) return null;
        const errorMessage = err instanceof Error ? err.message : 'プレビューに失敗しました';
        setError(errorMessage);
        return null;
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    },
    [onPreviewSuccess],
  );

  const resolveMappingForType = useCallback(
    (selectedUploadType: UploadType): Record<string, string | null> | null => {
      return resolveSubmittedMapping(preview, selectedUploadType);
    },
    [preview],
  );

  const handleMappingChange = useCallback(
    (field: string, columnIndex: string | null) => {
      setCurrentMapping((prev) => {
        const next = { ...prev, [field]: columnIndex };
        // Recalculate missing required fields locally
        const uploadType = preview?.resolvedUploadType ?? 'dead_stock';
        const missing = computeMissingRequiredFields(next, uploadType);
        setMissingRequiredFields(missing);
        setMappingComplete(missing.length === 0);
        return next;
      });
    },
    [preview],
  );

  const reset = useCallback(() => {
    setPreview(null);
    setError('');
    setLoading(false);
    setCurrentMapping({});
    setMappingComplete(false);
    setMissingRequiredFields([]);
    setFieldHints({});
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  return {
    preview,
    setPreview,
    loading,
    error,
    handlePreview,
    resolveSubmittedMapping: resolveMappingForType,
    resolveConfidenceLabel,
    reset,
    currentMapping,
    mappingComplete,
    missingRequiredFields,
    fieldHints,
    handleMappingChange,
  };
}
