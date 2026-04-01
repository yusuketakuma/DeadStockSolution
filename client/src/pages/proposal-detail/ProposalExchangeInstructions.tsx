import AppDataPanel from '../../components/ui/AppDataPanel';

export function ProposalExchangeInstructions() {
  return (
    <AppDataPanel title="交換手順（3フェーズ）" className="mb-3" bodyClassName="small">
      <ol className="mb-0">
        <li><strong>仮マッチング:</strong> 印刷用ページから交換様式を印刷し、提案元が署名/押印後に相手先FAXへ送信します。</li>
        <li><strong>双方承認:</strong> 受信側は同意欄を記入してFAX返信し、双方がシステム上で「承認」します。</li>
        <li><strong>確定→完了:</strong> 双方承認で確定となります。受け渡し完了後に「交換完了」を実行します。</li>
      </ol>
    </AppDataPanel>
  );
}
