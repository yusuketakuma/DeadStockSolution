import { Link } from 'react-router-dom';
import PageShell, { ScrollArea } from '../../components/ui/PageShell';
import AppDataPanel from '../../components/ui/AppDataPanel';
import AppDropdownMenu from '../../components/ui/AppDropdownMenu';
import ErrorCodesTab from './components/ErrorCodesTab';

export default function AdminErrorCodesPage() {
  return (
    <PageShell>
      <div className="dl-page-header">
        <div className="dl-page-header-copy">
          <h4 className="page-title mb-0">エラーコード</h4>
          <div className="text-muted small">運用ログで使うエラーコード定義を単独で確認・更新できます。</div>
        </div>
        <div className="dl-action-row mobile-stack">
          <Link to="/admin/log-center" className="btn btn-outline-primary btn-sm">ログセンター</Link>
          <AppDropdownMenu
            label="関連"
            size="sm"
            variant="outline-secondary"
            items={[
              { label: '監査ログ', to: '/admin/audit' },
              { label: '操作ログ', to: '/admin/logs' },
            ]}
          />
        </div>
      </div>

      <ScrollArea>
        <AppDataPanel title="近接導線" className="mb-3">
          <div className="dl-action-row mobile-stack">
            <Link to="/admin/log-center" className="btn btn-outline-primary btn-sm">再発監視へ戻る</Link>
            <AppDropdownMenu
              label="関連"
              size="sm"
              variant="outline-secondary"
              items={[
                { label: 'アップロード品質', to: '/admin/upload-quality' },
                { label: '通知・配信', to: '/admin/notifications' },
              ]}
            />
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
