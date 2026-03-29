import AppAlert from '../ui/AppAlert';
import AppButton from '../ui/AppButton';
import AppCard from '../ui/AppCard';
import LoadingButton from '../ui/LoadingButton';

interface MatchingSearchHeaderProps {
  loading: boolean;
  proposalRetrySuggested: boolean;
  message: string;
  inventorySearchDrugs: string;
  requestedDrugTerms: string[];
  requestedDrugLabel: string;
  requestedTargetPharmacyId: number | null;
  onRetrySearch: () => void;
  onShowAllCandidates: () => void;
  onSearch: () => void;
}

export default function MatchingSearchHeader({
  loading,
  proposalRetrySuggested,
  message,
  inventorySearchDrugs,
  requestedDrugTerms,
  requestedDrugLabel,
  requestedTargetPharmacyId,
  onRetrySearch,
  onShowAllCandidates,
  onSearch,
}: MatchingSearchHeaderProps) {
  return (
    <>
      {proposalRetrySuggested && (
        <AppAlert variant="warning" className="d-flex align-items-center justify-content-between gap-2 flex-wrap">
          <span className="small">在庫状態が更新された可能性があります。最新条件で再マッチングしてください。</span>
          <LoadingButton size="sm" variant="outline-warning" onClick={onRetrySearch} loading={loading} loadingLabel="再実行中...">
            再マッチング
          </LoadingButton>
        </AppAlert>
      )}
      {message && <AppAlert variant="success">{message}</AppAlert>}
      {(requestedTargetPharmacyId !== null || inventorySearchDrugs) && (
        <AppAlert variant="info" className="d-flex align-items-center justify-content-between gap-2 flex-wrap">
          <span className="small">
            医薬品在庫検索からマッチング候補を確認しています。
            {inventorySearchDrugs && <> 対象薬剤: <strong>{inventorySearchDrugs}</strong></>}
          </span>
          <AppButton type="button" variant="outline-info" size="sm" onClick={onShowAllCandidates}>
            全候補を表示
          </AppButton>
        </AppAlert>
      )}
      {requestedDrugTerms.length > 0 && (
        <AppAlert variant="info" className="small">
          対象薬剤: <strong>{requestedDrugLabel}</strong>（一致候補を優先表示）
        </AppAlert>
      )}

      <AppCard className="mb-3">
        <AppCard.Body>
          <p className="mb-2">
            デッドストックリストと医薬品使用量リストの一致度・距離・金額バランスをもとに、交換候補を優先順位付きで表示します。
          </p>
          <div className="small text-muted mb-3">条件: 双方1万円以上 / 差額10円以内</div>
          <LoadingButton onClick={onSearch} variant="primary" loading={loading} loadingLabel="マッチング中...">
            マッチングを実行
          </LoadingButton>
        </AppCard.Body>
      </AppCard>
    </>
  );
}
