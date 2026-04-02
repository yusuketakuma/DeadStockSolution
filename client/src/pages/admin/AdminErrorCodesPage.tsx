import { Link } from 'react-router-dom';
import PageShell, { ScrollArea } from '../../components/ui/PageShell';
import AppDataPanel from '../../components/ui/AppDataPanel';
import ErrorCodesTab from './components/ErrorCodesTab';

export default function AdminErrorCodesPage() {
  return (
    <PageShell>
      <div className="dl-page-header">
        <div className="dl-page-header-copy">
          <h4 className="page-title mb-0">エラーコード</h4>
          <div className="text-muted small">運用ログで使うエラーコード定義を単独で確認・更新できます。</div>
        </div>
        <div className="dl-page-header-actions d-flex gap-2 flex-wrap">
          <Link to="/admin/log-center" className="btn btn-outline-secondary btn-sm">ログセンター</Link>
          <Link to="/admin/audit" className="btn btn-outline-secondary btn-sm">監査ログ</Link>
          <Link to="/admin/logs" className="btn btn-outline-secondary btn-sm">操作ログ</Link>
        </div>
      </div>

      <ScrollArea>
        <AppDataPanel title="近接導線" className="mb-3">
          <div className="d-flex gap-2 flex-wrap">
            <Link to="/admin/log-center" className="btn btn-outline-primary btn-sm">再発監視へ戻る</Link>
            <Link to="/admin/upload-quality" className="btn btn-outline-secondary btn-sm">アップロード品質</Link>
            <Link to="/admin/notifications" className="btn btn-outline-secondary btn-sm">通知・配信</Link>
          </div>
          <div className="small text-muted mt-2">
            エラーコードを更新した後は、ログセンターや通知運用で反映を確認できます。
          </div>
        </AppDataPanel>

        <ErrorCodesTab />
      </ScrollArea>
    </PageShell>
  );
}
