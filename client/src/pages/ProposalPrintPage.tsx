import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api/client';

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

const printStyles = `
  body { margin: 0; color: #111; background: #fff; }
  @media print {
    body { font-size: 11pt; }
    .no-print { display: none !important; }
    .sheet { padding: 0; max-width: none !important; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #111; padding: 4px 6px; }
  }
  @page { size: A4 portrait; margin: 10mm; }
`;

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

  useEffect(() => {
    api.get<PrintData>(`/exchange/proposals/${id}/print`)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : '印刷データの取得に失敗しました'));
  }, [id]);

  if (error) return <div className="p-3">{error}</div>;
  if (!data) return <div className="p-3">読み込み中...</div>;

  const { proposal, items } = data;
  const pharmacyA = safePharmacy(data.pharmacyA);
  const pharmacyB = safePharmacy(data.pharmacyB);
  const itemsAtoB = items.filter((item) => item.fromPharmacyId === proposal.pharmacyAId);
  const itemsBtoA = items.filter((item) => item.fromPharmacyId === proposal.pharmacyBId);

  return (
    <div className="sheet" style={{ maxWidth: '980px', margin: '0 auto', padding: '16px', fontFamily: '"Noto Sans JP", sans-serif' }}>
      <style>{printStyles}</style>

      <div className="no-print" style={{ marginBottom: '16px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <button onClick={() => window.print()} style={{ padding: '8px 18px', fontSize: '14px' }}>
          印刷
        </button>
        <button onClick={() => window.close()} style={{ padding: '8px 18px', fontSize: '14px' }}>
          閉じる
        </button>
      </div>

      <h1 style={{ textAlign: 'center', marginBottom: '8px', fontSize: '22px' }}>医薬品交換様式（FAX確認用）</h1>
      <p style={{ textAlign: 'center', marginTop: 0, color: '#555', marginBottom: '12px' }}>
        提案番号: {proposal.id} / 提案日: {new Date(proposal.proposedAt).toLocaleDateString('ja-JP')}
      </p>

      <table style={{ width: '100%', marginBottom: '12px', borderCollapse: 'collapse' }}>
        <tbody>
          <tr>
            <th style={{ width: '16%' }}>送信元</th>
            <td style={{ width: '34%' }}>{pharmacyA.name}</td>
            <th style={{ width: '16%' }}>送信先</th>
            <td style={{ width: '34%' }}>{pharmacyB.name}</td>
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

      <div style={{ border: '1px solid #111', padding: '8px 10px', marginBottom: '14px', backgroundColor: '#f8f8f8' }}>
        <strong>FAX送信手順</strong>
        <ol style={{ margin: '6px 0 0 18px', padding: 0 }}>
          <li>提案元薬局が本様式を印刷し、内容を確認したうえで同意欄を記入します。</li>
          <li>提案元薬局から相手薬局FAX宛に送信します。</li>
          <li>受信側薬局が同意欄を記入し、FAX返信します。</li>
          <li>双方同意後にシステム上で「承認」を行い、受渡し完了後に「交換完了」を実行します。</li>
        </ol>
      </div>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '12px', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 320px', border: '1px solid #bbb', padding: '8px' }}>
          <strong>{pharmacyA.name}</strong>
          <div style={{ fontSize: '12px', marginTop: '4px' }}>
            住所: {pharmacyA.prefecture} {pharmacyA.address}<br />
            TEL: {pharmacyA.phone} / FAX: {pharmacyA.fax}<br />
            許可番号: {pharmacyA.licenseNumber}
          </div>
        </div>
        <div style={{ flex: '1 1 320px', border: '1px solid #bbb', padding: '8px' }}>
          <strong>{pharmacyB.name}</strong>
          <div style={{ fontSize: '12px', marginTop: '4px' }}>
            住所: {pharmacyB.prefecture} {pharmacyB.address}<br />
            TEL: {pharmacyB.phone} / FAX: {pharmacyB.fax}<br />
            許可番号: {pharmacyB.licenseNumber}
          </div>
        </div>
      </div>

      <h2 style={{ margin: '0 0 6px', fontSize: '16px' }}>
        {pharmacyA.name} → {pharmacyB.name}（合計: {proposal.totalValueA?.toLocaleString()}円）
      </h2>
      <table style={{ width: '100%', marginBottom: '12px', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ backgroundColor: '#efefef' }}>
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

      <h2 style={{ margin: '0 0 6px', fontSize: '16px' }}>
        {pharmacyB.name} → {pharmacyA.name}（合計: {proposal.totalValueB?.toLocaleString()}円）
      </h2>
      <table style={{ width: '100%', marginBottom: '14px', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ backgroundColor: '#efefef' }}>
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

      <h2 style={{ margin: '0 0 6px', fontSize: '16px' }}>双方同意欄</h2>
      <table style={{ width: '100%', marginBottom: '14px', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ backgroundColor: '#efefef' }}>
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
            <td style={{ minWidth: '200px' }}></td>
            <td style={{ minWidth: '150px' }}>_____年_____月_____日</td>
          </tr>
          <tr>
            <td>{pharmacyB.name}</td>
            <td>[ ] 同意  [ ] 条件付き同意  [ ] 不同意</td>
            <td></td>
            <td>_____年_____月_____日</td>
          </tr>
        </tbody>
      </table>

      <div style={{ border: '1px solid #bbb', backgroundColor: '#fffff0', padding: '10px' }}>
        <p style={{ margin: 0, fontSize: '11px', color: '#555' }}>
          本システムは業務補助ツールです。医薬品交換の最終判断と責任は当事者間にあります。
          配送・受渡しは各薬局で実施してください。
        </p>
      </div>
    </div>
  );
}
