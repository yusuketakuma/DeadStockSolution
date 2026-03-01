import AppDataPanel from '../../../components/ui/AppDataPanel';
import AppTable from '../../../components/ui/AppTable';
import AppMobileDataCard from '../../../components/ui/AppMobileDataCard';
import AppResponsiveSwitch from '../../../components/ui/AppResponsiveSwitch';
import { formatDateTimeJa } from '../../../utils/formatters';

export interface AdminMessage {
  id: number;
  targetType: 'all' | 'pharmacy';
  targetPharmacyId: number | null;
  title: string;
  body: string;
  actionPath: string | null;
  createdAt: string | null;
}

interface AdminSentMessagesPanelProps {
  messages: AdminMessage[];
}

export default function AdminSentMessagesPanel({ messages }: AdminSentMessagesPanelProps) {
  return (
    <AppDataPanel title="送信済みメッセージ（最新10件）">
      {messages.length === 0 ? (
        <div className="text-muted small">送信済みメッセージはありません。</div>
      ) : (
        <AppResponsiveSwitch
          desktop={() => (
            <div className="table-responsive">
              <AppTable striped size="sm" className="mobile-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>対象</th>
                    <th>タイトル</th>
                    <th>遷移先</th>
                    <th>送信日時</th>
                  </tr>
                </thead>
                <tbody>
                  {messages.map((item) => (
                    <tr key={item.id}>
                      <td>{item.id}</td>
                      <td>{item.targetType === 'all' ? '全体' : `薬局ID:${item.targetPharmacyId}`}</td>
                      <td>{item.title}</td>
                      <td>{item.actionPath || '-'}</td>
                      <td>{formatDateTimeJa(item.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </AppTable>
            </div>
          )}
          mobile={() => (
            <div className="dl-mobile-data-list">
              {messages.map((item) => (
                <AppMobileDataCard
                  key={item.id}
                  title={item.title}
                  subtitle={`ID: ${item.id}`}
                  fields={[
                    { label: '対象', value: item.targetType === 'all' ? '全体' : `薬局ID:${item.targetPharmacyId}` },
                    { label: '遷移先', value: item.actionPath || '-' },
                    { label: '送信日時', value: formatDateTimeJa(item.createdAt) },
                  ]}
                />
              ))}
            </div>
          )}
        />
      )}
    </AppDataPanel>
  );
}
