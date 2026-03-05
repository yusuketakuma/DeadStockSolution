import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api/client';
import ErrorRetryAlert from '../components/ui/ErrorRetryAlert';
import AppButton from '../components/ui/AppButton';
import PageLoader from '../components/ui/PageLoader';
import { formatDateJa } from '../utils/formatters';
import '../styles/proposal-print.css';

interface PharmacyInfo {
  name: string;
  phone: string;
  fax: string;
  address: string;
  prefecture: string;
  licenseNumber: string;
}

interface PrintItem {
  id: number;
  fromPharmacyId: number;
  toPharmacyId: number;
  quantity: number;
  yakkaValue: number;
  drugName: string;
  unit: string | null;
  yakkaUnitPrice: number | null;
}

interface PrintData {
  proposal: {
    id: number;
    pharmacyAId: number;
    pharmacyBId: number;
    totalValueA: number;
    totalValueB: number;
    proposedAt: string;
  };
  items: PrintItem[];
  pharmacyA: PharmacyInfo | null;
  pharmacyB: PharmacyInfo | null;
}

function safePharmacy(pharmacy: PharmacyInfo | null) {
  return {
    name: pharmacy?.name || '未取得',
    phone: pharmacy?.phone || '-',
    fax: pharmacy?.fax || '-',
    address: pharmacy?.address || '-',
    prefecture: pharmacy?.prefecture || '-',
    licenseNumber: pharmacy?.licenseNumber || '-',
  };
}

export default function ProposalPrintPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<PrintData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const fetchPrintData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const printData = await api.get<PrintData>(`/exchange/proposals/${id}/print`);
      setData(printData);
    } catch (err) {
      setError(err instanceof Error ? err.message : '印刷データの取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void fetchPrintData();
  }, [fetchPrintData]);

  if (loading && !data) return <PageLoader />;
  if (error && !data) {
    return (
      <div className="p-3">
        <ErrorRetryAlert error={error} onRetry={() => void fetchPrintData()} />
      </div>
    );
  }
  if (!data) return <PageLoader />;

  const { proposal, items } = data;
  const pharmacyA = safePharmacy(data.pharmacyA);
  const pharmacyB = safePharmacy(data.pharmacyB);
  const itemsAtoB = items.filter((item) => item.fromPharmacyId === proposal.pharmacyAId);
  const itemsBtoA = items.filter((item) => item.fromPharmacyId === proposal.pharmacyBId);

  return (
    <div className="proposal-print-sheet">
      <div className="proposal-print-actions no-print">
        <AppButton type="button" onClick={() => window.print()} className="proposal-print-action-button">
          印刷
        </AppButton>
        <AppButton type="button" onClick={() => window.close()} className="proposal-print-action-button">
          閉じる
        </AppButton>
      </div>

      <h1 className="proposal-print-title">医薬品交換様式（FAX確認用）</h1>
      <p className="proposal-print-meta">
        マッチング番号: {proposal.id} / 開始日: {formatDateJa(proposal.proposedAt)}
      </p>

      <table className="proposal-print-table proposal-print-table-md">
        <tbody>
          <tr>
            <th className="proposal-print-col-th">送信元</th>
            <td className="proposal-print-col-td">{pharmacyA.name}</td>
            <th className="proposal-print-col-th">送信先</th>
            <td className="proposal-print-col-td">{pharmacyB.name}</td>
          </tr>
          <tr>
            <th>送信元FAX</th>
            <td>{pharmacyA.fax}</td>
            <th>送信先FAX</th>
            <td>{pharmacyB.fax}</td>
          </tr>
          <tr>
            <th>送信日時</th>
            <td>_____年_____月_____日 _____:_____</td>
            <th>送信枚数</th>
            <td>本紙含む ______ 枚</td>
          </tr>
        </tbody>
      </table>

      <div className="proposal-print-procedure-box">
        <strong>交換手順（3フェーズ）</strong>
        <ol className="proposal-print-procedure-list">
          <li><strong>仮マッチング:</strong> 提案元薬局が本様式を印刷し、内容を確認したうえで同意欄を記入します。</li>
          <li>提案元薬局から相手薬局FAX宛に送信し、受信側薬局が同意欄を記入してFAX返信します。</li>
          <li><strong>確定:</strong> 双方がシステム上で「承認」を行い、仮マッチングが確定します。</li>
          <li><strong>完了:</strong> 受渡し完了後にシステム上で「交換完了」を実行します。</li>
        </ol>
      </div>

      <div className="proposal-print-pharmacy-grid">
        <div className="proposal-print-pharmacy-card">
          <strong>{pharmacyA.name}</strong>
          <div className="proposal-print-pharmacy-detail">
            住所: {pharmacyA.prefecture} {pharmacyA.address}<br />
            TEL: {pharmacyA.phone} / FAX: {pharmacyA.fax}<br />
            許可番号: {pharmacyA.licenseNumber}
          </div>
        </div>
        <div className="proposal-print-pharmacy-card">
          <strong>{pharmacyB.name}</strong>
          <div className="proposal-print-pharmacy-detail">
            住所: {pharmacyB.prefecture} {pharmacyB.address}<br />
            TEL: {pharmacyB.phone} / FAX: {pharmacyB.fax}<br />
            許可番号: {pharmacyB.licenseNumber}
          </div>
        </div>
      </div>

      <h2 className="proposal-print-section-title">
        {pharmacyA.name} → {pharmacyB.name}（合計: {proposal.totalValueA?.toLocaleString()}円）
      </h2>
      <table className="proposal-print-table proposal-print-table-md">
        <thead>
          <tr className="proposal-print-table-head">
            <th>薬品名</th>
            <th>数量</th>
            <th>単位</th>
            <th>薬価(単価)</th>
            <th>薬価(合計)</th>
          </tr>
        </thead>
        <tbody>
          {itemsAtoB.map((item) => (
            <tr key={item.id}>
              <td>{item.drugName}</td>
              <td>{item.quantity}</td>
              <td>{item.unit || '-'}</td>
              <td>{item.yakkaUnitPrice?.toLocaleString() || '-'}</td>
              <td>{item.yakkaValue?.toLocaleString() || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="proposal-print-section-title">
        {pharmacyB.name} → {pharmacyA.name}（合計: {proposal.totalValueB?.toLocaleString()}円）
      </h2>
      <table className="proposal-print-table proposal-print-table-lg">
        <thead>
          <tr className="proposal-print-table-head">
            <th>薬品名</th>
            <th>数量</th>
            <th>単位</th>
            <th>薬価(単価)</th>
            <th>薬価(合計)</th>
          </tr>
        </thead>
        <tbody>
          {itemsBtoA.map((item) => (
            <tr key={item.id}>
              <td>{item.drugName}</td>
              <td>{item.quantity}</td>
              <td>{item.unit || '-'}</td>
              <td>{item.yakkaUnitPrice?.toLocaleString() || '-'}</td>
              <td>{item.yakkaValue?.toLocaleString() || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="proposal-print-section-title">双方同意欄</h2>
      <table className="proposal-print-table proposal-print-table-lg">
        <thead>
          <tr className="proposal-print-table-head">
            <th>薬局</th>
            <th>同意区分</th>
            <th>担当者署名/押印</th>
            <th>確認日</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{pharmacyA.name}</td>
            <td>[ ] 同意  [ ] 条件付き同意  [ ] 不同意</td>
            <td className="proposal-print-signature-col"></td>
            <td className="proposal-print-date-col">_____年_____月_____日</td>
          </tr>
          <tr>
            <td>{pharmacyB.name}</td>
            <td>[ ] 同意  [ ] 条件付き同意  [ ] 不同意</td>
            <td></td>
            <td>_____年_____月_____日</td>
          </tr>
        </tbody>
      </table>

      <div className="proposal-print-note-box">
        <p className="proposal-print-note-text">
          本システムは業務補助ツールです。医薬品交換の最終判断と責任は当事者間にあります。
          配送・受渡しは各薬局で実施してください。
        </p>
      </div>
    </div>
  );
}
