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
  pharmacyA: PharmacyInfo;
  pharmacyB: PharmacyInfo;
}

const printStyles = `
  @media print {
    body { font-size: 12pt; color: #000; background: #fff; }
    .no-print { display: none !important; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #000; padding: 4px 8px; }
    h1 { font-size: 18pt; }
    h2 { font-size: 14pt; }
  }
  @page { size: A4 portrait; margin: 15mm; }
`;

export default function ProposalPrintPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<PrintData | null>(null);

  useEffect(() => {
    api.get<PrintData>(`/exchange/proposals/${id}/print`).then(setData);
  }, [id]);

  if (!data) return <div>読み込み中...</div>;

  const { proposal, items, pharmacyA, pharmacyB } = data;
  const itemsAtoB = items.filter((i) => i.fromPharmacyId === proposal.pharmacyAId);
  const itemsBtoA = items.filter((i) => i.fromPharmacyId === proposal.pharmacyBId);

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '20px', fontFamily: '"Noto Sans JP", sans-serif' }}>
      <style>{printStyles}</style>

      <div className="no-print" style={{ marginBottom: '20px' }}>
        <button onClick={() => window.print()} style={{ padding: '8px 24px', fontSize: '16px' }}>
          印刷
        </button>
        <button onClick={() => window.close()} style={{ padding: '8px 24px', fontSize: '16px', marginLeft: '10px' }}>
          閉じる
        </button>
      </div>

      <h1 style={{ textAlign: 'center', marginBottom: '20px' }}>医薬品交換依頼書</h1>
      <p style={{ textAlign: 'center', color: '#666' }}>
        提案番号: {proposal.id} / 提案日: {new Date(proposal.proposedAt).toLocaleDateString('ja-JP')}
      </p>

      <div style={{ display: 'flex', gap: '20px', marginBottom: '20px' }}>
        <div style={{ flex: 1, border: '1px solid #ccc', padding: '10px' }}>
          <h2>{pharmacyA.name}</h2>
          <p>〒{pharmacyA.prefecture} {pharmacyA.address}</p>
          <p>TEL: {pharmacyA.phone} / FAX: {pharmacyA.fax}</p>
          <p>許可番号: {pharmacyA.licenseNumber}</p>
        </div>
        <div style={{ flex: 1, border: '1px solid #ccc', padding: '10px' }}>
          <h2>{pharmacyB.name}</h2>
          <p>〒{pharmacyB.prefecture} {pharmacyB.address}</p>
          <p>TEL: {pharmacyB.phone} / FAX: {pharmacyB.fax}</p>
          <p>許可番号: {pharmacyB.licenseNumber}</p>
        </div>
      </div>

      <h2>{pharmacyA.name} → {pharmacyB.name} (合計: {proposal.totalValueA?.toLocaleString()}円)</h2>
      <table style={{ width: '100%', marginBottom: '20px', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ backgroundColor: '#f0f0f0' }}>
            <th style={{ border: '1px solid #ccc', padding: '6px' }}>薬品名</th>
            <th style={{ border: '1px solid #ccc', padding: '6px' }}>数量</th>
            <th style={{ border: '1px solid #ccc', padding: '6px' }}>単位</th>
            <th style={{ border: '1px solid #ccc', padding: '6px' }}>薬価(単価)</th>
            <th style={{ border: '1px solid #ccc', padding: '6px' }}>薬価(合計)</th>
          </tr>
        </thead>
        <tbody>
          {itemsAtoB.map((item) => (
            <tr key={item.id}>
              <td style={{ border: '1px solid #ccc', padding: '6px' }}>{item.drugName}</td>
              <td style={{ border: '1px solid #ccc', padding: '6px' }}>{item.quantity}</td>
              <td style={{ border: '1px solid #ccc', padding: '6px' }}>{item.unit}</td>
              <td style={{ border: '1px solid #ccc', padding: '6px' }}>{item.yakkaUnitPrice?.toLocaleString()}</td>
              <td style={{ border: '1px solid #ccc', padding: '6px' }}>{item.yakkaValue?.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>{pharmacyB.name} → {pharmacyA.name} (合計: {proposal.totalValueB?.toLocaleString()}円)</h2>
      <table style={{ width: '100%', marginBottom: '20px', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ backgroundColor: '#f0f0f0' }}>
            <th style={{ border: '1px solid #ccc', padding: '6px' }}>薬品名</th>
            <th style={{ border: '1px solid #ccc', padding: '6px' }}>数量</th>
            <th style={{ border: '1px solid #ccc', padding: '6px' }}>単位</th>
            <th style={{ border: '1px solid #ccc', padding: '6px' }}>薬価(単価)</th>
            <th style={{ border: '1px solid #ccc', padding: '6px' }}>薬価(合計)</th>
          </tr>
        </thead>
        <tbody>
          {itemsBtoA.map((item) => (
            <tr key={item.id}>
              <td style={{ border: '1px solid #ccc', padding: '6px' }}>{item.drugName}</td>
              <td style={{ border: '1px solid #ccc', padding: '6px' }}>{item.quantity}</td>
              <td style={{ border: '1px solid #ccc', padding: '6px' }}>{item.unit}</td>
              <td style={{ border: '1px solid #ccc', padding: '6px' }}>{item.yakkaUnitPrice?.toLocaleString()}</td>
              <td style={{ border: '1px solid #ccc', padding: '6px' }}>{item.yakkaValue?.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ marginTop: '40px', padding: '10px', border: '1px solid #ccc', backgroundColor: '#fffff0' }}>
        <p style={{ fontSize: '10pt', color: '#666' }}>
          本システムはあくまで業務補助ツールであり、医薬品の交換に関する一切の責任を負いません。
          実際の医薬品のやり取り（配送・受渡し）には一切関与しません。
          本書面に基づく交換は、双方の薬局間の合意のもとに直接行ってください。
        </p>
      </div>

      <div style={{ marginTop: '40px', display: 'flex', gap: '40px' }}>
        <div style={{ flex: 1 }}>
          <p>承認欄（{pharmacyA.name}）</p>
          <div style={{ borderBottom: '1px solid #000', height: '60px' }}></div>
          <p style={{ fontSize: '10pt' }}>日付: ___年___月___日</p>
        </div>
        <div style={{ flex: 1 }}>
          <p>承認欄（{pharmacyB.name}）</p>
          <div style={{ borderBottom: '1px solid #000', height: '60px' }}></div>
          <p style={{ fontSize: '10pt' }}>日付: ___年___月___日</p>
        </div>
      </div>
    </div>
  );
}
