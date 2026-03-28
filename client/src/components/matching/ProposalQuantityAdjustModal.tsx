import { useEffect, useMemo, useState } from 'react';
import { Col, Form, Row } from 'react-bootstrap';
import type { MatchCandidate, MatchItem } from '../../types/matching';
import AppButton from '../ui/AppButton';
import AppModalShell from '../ui/AppModalShell';
import LoadingButton from '../ui/LoadingButton';
import { formatYen } from '../../utils/formatters';

type QuantityInputKey = `${'a' | 'b'}:${number}`;

interface DraftItem {
  key: QuantityInputKey;
  sideLabel: string;
  originalQuantity: number;
  quantityText: string;
  item: MatchItem;
}

interface QuantityDraftResult {
  candidate: MatchCandidate;
  totalValueA: number;
  totalValueB: number;
  valueDifference: number;
}

interface ProposalQuantityAdjustModalProps {
  show: boolean;
  candidate: MatchCandidate | null;
  pending?: boolean;
  onCancel: () => void;
  onConfirm: (candidate: MatchCandidate) => void;
}

const MIN_EXCHANGE_VALUE = 10000;
const VALUE_TOLERANCE = 10;

function formatQuantity(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : String(Number(value.toFixed(3)));
}

function createDraftItems(candidate: MatchCandidate | null): DraftItem[] {
  if (!candidate) return [];
  return [
    ...candidate.itemsFromA.map((item) => ({
      key: `a:${item.deadStockItemId}` as const,
      sideLabel: 'あなた → 相手',
      originalQuantity: item.quantity,
      quantityText: formatQuantity(item.quantity),
      item,
    })),
    ...candidate.itemsFromB.map((item) => ({
      key: `b:${item.deadStockItemId}` as const,
      sideLabel: '相手 → あなた',
      originalQuantity: item.quantity,
      quantityText: formatQuantity(item.quantity),
      item,
    })),
  ];
}

function buildAdjustedCandidate(
  candidate: MatchCandidate,
  draftItems: DraftItem[],
  quantityByKey: Record<string, string>,
): QuantityDraftResult | { error: string } {
  const draftByKey = new Map<QuantityInputKey, DraftItem>(
    draftItems.map((item) => [item.key, item]),
  );

  const adjustItem = (side: 'a' | 'b', item: MatchItem): { deadStockItemId: number; quantity: number } | { error: string } => {
    const key = `${side}:${item.deadStockItemId}` as QuantityInputKey;
    const raw = quantityByKey[key];
    const quantity = Number(raw);
    const draftItem = draftByKey.get(key);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return { error: `${item.drugName} の数量を正しく入力してください` };
    }
    if (draftItem && quantity > draftItem.originalQuantity) {
      return { error: `${item.drugName} の数量は元数量 ${formatQuantity(draftItem.originalQuantity)} を超えられません` };
    }
    return {
      deadStockItemId: item.deadStockItemId,
      quantity: Math.round(quantity * 1000) / 1000,
    };
  };

  const adjustedItemsA: Array<{ deadStockItemId: number; quantity: number }> = [];
  for (const item of candidate.itemsFromA) {
    const result = adjustItem('a', item);
    if ('error' in result) return result;
    adjustedItemsA.push(result);
  }

  const adjustedItemsB: Array<{ deadStockItemId: number; quantity: number }> = [];
  for (const item of candidate.itemsFromB) {
    const result = adjustItem('b', item);
    if ('error' in result) return result;
    adjustedItemsB.push(result);
  }

  const priceById = new Map<number, number>();
  for (const item of [...candidate.itemsFromA, ...candidate.itemsFromB]) {
    priceById.set(item.deadStockItemId, item.yakkaUnitPrice);
  }

  const adjustedQuantityById = new Map<number, number>();
  for (const item of [...adjustedItemsA, ...adjustedItemsB]) {
    adjustedQuantityById.set(item.deadStockItemId, item.quantity);
  }

  const totalValueA = adjustedItemsA.reduce((sum, item) => {
    const price = priceById.get(item.deadStockItemId) ?? 0;
    return sum + (price * item.quantity);
  }, 0);
  const totalValueB = adjustedItemsB.reduce((sum, item) => {
    const price = priceById.get(item.deadStockItemId) ?? 0;
    return sum + (price * item.quantity);
  }, 0);

  const roundedTotalValueA = Math.round(totalValueA * 100) / 100;
  const roundedTotalValueB = Math.round(totalValueB * 100) / 100;
  const roundedDifference = Math.round(Math.abs(totalValueA - totalValueB) * 100) / 100;

  if (Math.min(roundedTotalValueA, roundedTotalValueB) < MIN_EXCHANGE_VALUE) {
    return { error: `双方の合計金額は最低 ${formatYen(MIN_EXCHANGE_VALUE)} 以上が必要です` };
  }
  if (roundedDifference > VALUE_TOLERANCE) {
    return { error: `差額は ${formatYen(VALUE_TOLERANCE)} 以内に収めてください` };
  }

  return {
    candidate: {
      ...candidate,
      itemsFromA: candidate.itemsFromA.map((item) => ({
        ...item,
        quantity: adjustedItemsA.find((adjusted) => adjusted.deadStockItemId === item.deadStockItemId)?.quantity ?? item.quantity,
        yakkaValue: Math.round((item.yakkaUnitPrice * (adjustedQuantityById.get(item.deadStockItemId) ?? item.quantity)) * 100) / 100,
      })),
      itemsFromB: candidate.itemsFromB.map((item) => ({
        ...item,
        quantity: adjustedItemsB.find((adjusted) => adjusted.deadStockItemId === item.deadStockItemId)?.quantity ?? item.quantity,
        yakkaValue: Math.round((item.yakkaUnitPrice * (adjustedQuantityById.get(item.deadStockItemId) ?? item.quantity)) * 100) / 100,
      })),
      totalValueA: roundedTotalValueA,
      totalValueB: roundedTotalValueB,
      valueDifference: roundedDifference,
    },
    totalValueA: roundedTotalValueA,
    totalValueB: roundedTotalValueB,
    valueDifference: roundedDifference,
  };
}

export default function ProposalQuantityAdjustModal({
  show,
  candidate,
  pending = false,
  onCancel,
  onConfirm,
}: ProposalQuantityAdjustModalProps) {
  const [quantityByKey, setQuantityByKey] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  const draftItems = useMemo(() => createDraftItems(candidate), [candidate]);

  useEffect(() => {
    if (!candidate) {
      setQuantityByKey({});
      setError('');
      return;
    }

    setQuantityByKey(
      Object.fromEntries(draftItems.map((item) => [item.key, item.quantityText])),
    );
    setError('');
  }, [candidate, draftItems]);

  const draftResult = useMemo(() => {
    if (!candidate) return null;
    return buildAdjustedCandidate(candidate, draftItems, quantityByKey);
  }, [candidate, draftItems, quantityByKey]);

  const handleConfirm = () => {
    if (!candidate || !draftResult) return;
    if ('error' in draftResult) {
      setError(draftResult.error);
      return;
    }

    onConfirm(draftResult.candidate);
  };

  const footer = (
    <>
      <AppButton variant="outline-secondary" onClick={onCancel} disabled={pending}>
        キャンセル
      </AppButton>
      <LoadingButton
        variant="success"
        onClick={handleConfirm}
        loading={pending}
        loadingLabel="提案中..."
        disabled={!candidate || pending || (draftResult !== null && 'error' in draftResult)}
      >
        仮マッチングを開始
      </LoadingButton>
    </>
  );

  return (
    <AppModalShell
      show={show}
      title="数量を調整して仮マッチング"
      onHide={pending ? undefined : onCancel}
      closeButton={!pending}
      size="xl"
      footer={footer}
    >
      {candidate ? (
        <div className="d-flex flex-column gap-3">
          <div className="small text-muted">
            {candidate.pharmacyName} との提案を開始します。数量を調整したうえで送信できます。
          </div>

          {error ? <div className="alert alert-danger py-2 mb-0">{error}</div> : null}
          {!error && draftResult && 'error' in draftResult ? (
            <div className="alert alert-warning py-2 mb-0">{draftResult.error}</div>
          ) : null}

          <Row className="g-3">
            <Col md={4}>
              <div className="border rounded p-3 h-100">
                <div className="text-muted small">相手薬局</div>
                <div className="h5 mb-2">{candidate.pharmacyName}</div>
                <div className="small text-muted">距離 {candidate.distance}km</div>
                <div className="small text-muted">現在の差額 {candidate.valueDifference.toLocaleString()}円</div>
                <div className="small text-muted">A側合計 {formatYen(candidate.totalValueA)}</div>
                <div className="small text-muted">B側合計 {formatYen(candidate.totalValueB)}</div>
              </div>
            </Col>
            <Col md={8}>
              <div className="border rounded p-3 h-100">
                <div className="fw-semibold mb-2">数量編集</div>
                <div className="table-responsive">
                  <Form>
                    <table className="table table-sm align-middle mb-0">
                      <thead className="table-light">
                        <tr>
                          <th>側</th>
                          <th>薬品名</th>
                          <th>元数量</th>
                          <th>調整後数量</th>
                          <th className="text-end">行金額</th>
                        </tr>
                      </thead>
                      <tbody>
                        {draftItems.map((draftItem) => {
                          const rawQuantity = quantityByKey[draftItem.key] ?? draftItem.quantityText;
                          const quantity = Number(rawQuantity);
                          const lineTotal = Number.isFinite(quantity) && quantity > 0
                            ? Math.round(draftItem.item.yakkaUnitPrice * quantity * 100) / 100
                            : null;

                          return (
                            <tr key={draftItem.key}>
                              <td className="text-muted small">{draftItem.sideLabel}</td>
                              <td>{draftItem.item.drugName}</td>
                              <td>{formatQuantity(draftItem.originalQuantity)}</td>
                              <td style={{ minWidth: 120 }}>
                                <Form.Control
                                  type="number"
                                  min="0.001"
                                  step="0.001"
                                  value={rawQuantity}
                                  onChange={(event) => {
                                    const nextValue = event.target.value;
                                    setError('');
                                    setQuantityByKey((prev) => ({ ...prev, [draftItem.key]: nextValue }));
                                  }}
                                />
                              </td>
                              <td className="text-end">
                                {lineTotal === null ? '-' : formatYen(lineTotal)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </Form>
                </div>
              </div>
            </Col>
          </Row>

          <div className="border rounded p-3">
            <div className="fw-semibold mb-2">調整後の試算</div>
            <div className="d-flex flex-wrap gap-3 small">
              <span>A側合計: {draftResult && !('error' in draftResult) ? formatYen(draftResult.totalValueA) : '-'}</span>
              <span>B側合計: {draftResult && !('error' in draftResult) ? formatYen(draftResult.totalValueB) : '-'}</span>
              <span>差額: {draftResult && !('error' in draftResult) ? formatYen(draftResult.valueDifference) : '-'}</span>
            </div>
            <div className="text-muted small mt-2">
              バックエンドでは各在庫の利用可能数量、交換金額の下限、差額許容範囲を再検証します。
            </div>
          </div>
        </div>
      ) : null}
    </AppModalShell>
  );
}
