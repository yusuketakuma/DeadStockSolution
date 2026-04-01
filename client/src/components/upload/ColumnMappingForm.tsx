import { Form, Alert, Badge } from 'react-bootstrap';

interface ColumnMappingFormProps {
  headers: string[];
  mapping: Record<string, string | null>;
  uploadType: 'dead_stock' | 'used_medication';
  missingRequiredFields: string[];
  fieldHints: Record<string, string[]>;
  mappingComplete: boolean;
  onChange: (field: string, columnIndex: string | null) => void;
}

interface FieldConfig {
  key: string;
  label: string;
  required: boolean | ((uploadType: 'dead_stock' | 'used_medication') => boolean);
  showFor?: 'dead_stock' | 'used_medication';
}

const FIELD_CONFIGS: FieldConfig[] = [
  { key: 'drug_name', label: '薬品名', required: true },
  { key: 'drug_code', label: '薬品コード', required: true },
  { key: 'quantity', label: '数量', required: (t) => t === 'dead_stock' },
  { key: 'yakka_unit_price', label: '薬価単価', required: (t) => t === 'dead_stock' },
  { key: 'unit', label: '単位', required: false },
  { key: 'expiration_date', label: '使用期限', required: false },
  { key: 'lot_number', label: 'ロット番号', required: false },
  { key: 'monthly_usage', label: '月間使用量', required: false, showFor: 'used_medication' },
];

function isFieldRequired(field: FieldConfig, uploadType: 'dead_stock' | 'used_medication'): boolean {
  if (typeof field.required === 'function') return field.required(uploadType);
  return field.required;
}

export default function ColumnMappingForm({
  headers,
  mapping,
  uploadType,
  missingRequiredFields,
  fieldHints,
  mappingComplete,
  onChange,
}: ColumnMappingFormProps) {
  const visibleFields = FIELD_CONFIGS.filter(
    (f) => !f.showFor || f.showFor === uploadType,
  );

  return (
    <div className="mb-3">
      <h6 className="fw-bold mb-2">カラムマッピング設定</h6>

      {!mappingComplete && (
        <Alert variant="warning" className="small py-2">
          必須フィールドの割り当てが不足しています
        </Alert>
      )}

      {visibleFields.map((field) => {
        const required = isFieldRequired(field, uploadType);
        const isMissing = missingRequiredFields.includes(field.key);
        const currentValue = mapping[field.key] ?? '';
        const hints = fieldHints[field.key];

        return (
          <Form.Group
            key={field.key}
            className="mb-2 d-flex flex-wrap align-items-start gap-2"
            controlId={`mapping-${field.key}`}
          >
            <div style={{ minWidth: 160 }} className="pt-1">
              <Form.Label className="mb-0 small fw-bold">
                {field.label}
              </Form.Label>
              {' '}
              {required ? (
                <Badge bg="danger" className="ms-1">必須</Badge>
              ) : (
                <Badge bg="secondary" className="ms-1">任意</Badge>
              )}
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <Form.Select
                size="sm"
                value={currentValue}
                className={isMissing ? 'border-danger' : ''}
                onChange={(e) => {
                  const val = e.target.value;
                  onChange(field.key, val === '' ? null : val);
                }}
              >
                <option value="">未設定</option>
                {headers.map((header, idx) => (
                  <option key={idx} value={String(idx)}>
                    {header || `列${idx + 1}`}
                  </option>
                ))}
              </Form.Select>
              {isMissing && (
                <div className="small text-danger mt-1">
                  このフィールドは必須です
                </div>
              )}
              {hints && hints.length > 0 && (
                <div className="small text-muted mt-1">
                  認識キーワード: {hints.join(', ')}
                </div>
              )}
            </div>
          </Form.Group>
        );
      })}
    </div>
  );
}
