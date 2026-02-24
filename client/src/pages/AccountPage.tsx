import { useState, useEffect, FormEvent } from 'react';
import { Card, Form, Button, Alert, Row, Col, Table } from 'react-bootstrap';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../api/client';
import { useNavigate } from 'react-router-dom';

const PREFECTURES = [
  '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県',
  '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
  '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県',
  '岐阜県', '静岡県', '愛知県', '三重県',
  '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県',
  '鳥取県', '島根県', '岡山県', '広島県', '山口県',
  '徳島県', '香川県', '愛媛県', '高知県',
  '福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県',
];

const DAY_NAMES = ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'];

interface AccountData {
  id: number;
  email: string;
  name: string;
  postalCode: string;
  address: string;
  phone: string;
  fax: string;
  licenseNumber: string;
  prefecture: string;
}

interface BusinessHourEntry {
  dayOfWeek: number;
  openTime: string | null;
  closeTime: string | null;
  isClosed: boolean;
}

function createDefaultHours(): BusinessHourEntry[] {
  return Array.from({ length: 7 }, (_, i) => ({
    dayOfWeek: i,
    openTime: i === 0 ? null : '09:00', // Sunday closed by default
    closeTime: i === 0 ? null : '18:00',
    isClosed: i === 0,
  }));
}

export default function AccountPage() {
  const { refreshUser, logout } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: '', postalCode: '', address: '', phone: '', fax: '', prefecture: '',
    currentPassword: '', newPassword: '',
  });
  const [account, setAccount] = useState<AccountData | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);

  // Business hours state
  const [businessHours, setBusinessHours] = useState<BusinessHourEntry[]>(createDefaultHours());
  const [hoursLoaded, setHoursLoaded] = useState(false);
  const [hoursSaving, setHoursSaving] = useState(false);
  const [hoursMessage, setHoursMessage] = useState('');
  const [hoursError, setHoursError] = useState('');

  useEffect(() => {
    api.get<AccountData>('/account').then((data) => {
      setAccount(data);
      setForm((prev) => ({
        ...prev,
        name: data.name,
        postalCode: data.postalCode,
        address: data.address,
        phone: data.phone,
        fax: data.fax,
        prefecture: data.prefecture,
      }));
    });

    // Load business hours
    api.get<BusinessHourEntry[]>('/business-hours').then((data) => {
      if (data.length > 0) {
        setBusinessHours(data);
      }
      setHoursLoaded(true);
    });
  }, []);

  const handleChange = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);
    try {
      await api.put('/account', form);
      setMessage('アカウント情報を更新しました');
      setForm((prev) => ({ ...prev, currentPassword: '', newPassword: '' }));
      refreshUser();
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const handleHoursChange = (dayOfWeek: number, field: 'openTime' | 'closeTime', value: string) => {
    setBusinessHours((prev) =>
      prev.map((h) => h.dayOfWeek === dayOfWeek ? { ...h, [field]: value } : h)
    );
  };

  const handleClosedChange = (dayOfWeek: number, isClosed: boolean) => {
    setBusinessHours((prev) =>
      prev.map((h) => h.dayOfWeek === dayOfWeek
        ? { ...h, isClosed, openTime: isClosed ? null : (h.openTime || '09:00'), closeTime: isClosed ? null : (h.closeTime || '18:00') }
        : h
      )
    );
  };

  const handleHoursSave = async () => {
    setHoursError('');
    setHoursMessage('');
    setHoursSaving(true);
    try {
      await api.put('/business-hours', { hours: businessHours });
      setHoursMessage('営業時間を更新しました');
    } catch (err) {
      setHoursError(err instanceof Error ? err.message : '営業時間の更新に失敗しました');
    } finally {
      setHoursSaving(false);
    }
  };

  const handleWithdraw = async () => {
    const confirmed = confirm(
      '退会するとアカウントが無効化され、現在のセッションは終了します。実行しますか？'
    );
    if (!confirmed) return;

    setWithdrawing(true);
    setError('');
    setMessage('');
    try {
      await api.delete<{ message: string }>('/account');
      await logout();
      navigate('/login');
    } catch (err) {
      setError(err instanceof Error ? err.message : '退会処理に失敗しました');
    } finally {
      setWithdrawing(false);
    }
  };

  if (!account) return null;

  return (
    <div>
      <h4 className="page-title mb-3">薬局登録情報の編集</h4>
      {message && <Alert variant="success" onClose={() => setMessage('')} dismissible>{message}</Alert>}
      {error && <Alert variant="danger" onClose={() => setError('')} dismissible>{error}</Alert>}

      <Card>
        <Card.Body>
          <Form onSubmit={handleSubmit}>
            <Form.Group className="mb-3">
              <Form.Label>メールアドレス</Form.Label>
              <Form.Control type="email" value={account.email} disabled />
              <Form.Text className="text-muted">メールアドレスは変更できません</Form.Text>
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>薬局開設許可番号</Form.Label>
              <Form.Control type="text" value={account.licenseNumber} disabled />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>薬局名</Form.Label>
              <Form.Control type="text" value={form.name} onChange={handleChange('name')} />
            </Form.Group>

            <Row>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>都道府県</Form.Label>
                  <Form.Select value={form.prefecture} onChange={handleChange('prefecture')}>
                    {PREFECTURES.map((pref) => (
                      <option key={pref} value={pref}>{pref}</option>
                    ))}
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>郵便番号</Form.Label>
                  <Form.Control type="text" value={form.postalCode} onChange={handleChange('postalCode')} />
                </Form.Group>
              </Col>
            </Row>

            <Form.Group className="mb-3">
              <Form.Label>住所</Form.Label>
              <Form.Control type="text" value={form.address} onChange={handleChange('address')} />
            </Form.Group>

            <Row>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>電話番号</Form.Label>
                  <Form.Control type="tel" value={form.phone} onChange={handleChange('phone')} />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>FAX番号</Form.Label>
                  <Form.Control type="tel" value={form.fax} onChange={handleChange('fax')} />
                </Form.Group>
              </Col>
            </Row>

            <hr />
            <h6>パスワード変更（変更する場合のみ入力）</h6>
            <Row>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>現在のパスワード</Form.Label>
                  <Form.Control type="password" value={form.currentPassword} onChange={handleChange('currentPassword')} />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>新しいパスワード</Form.Label>
                  <Form.Control type="password" value={form.newPassword} onChange={handleChange('newPassword')} minLength={8} />
                </Form.Group>
              </Col>
            </Row>

            <Button type="submit" variant="primary" disabled={loading}>
              {loading ? '更新中...' : '更新'}
            </Button>
          </Form>
        </Card.Body>
      </Card>

      {/* Business Hours Section */}
      <Card className="mt-3">
        <Card.Header>営業時間設定</Card.Header>
        <Card.Body>
          {hoursMessage && <Alert variant="success" onClose={() => setHoursMessage('')} dismissible>{hoursMessage}</Alert>}
          {hoursError && <Alert variant="danger" onClose={() => setHoursError('')} dismissible>{hoursError}</Alert>}

          <p className="small text-muted mb-3">
            営業時間を設定すると、マッチングや在庫検索で他の薬局に表示されます。
          </p>

          {hoursLoaded && (
            <>
              <div className="table-responsive">
                <Table size="sm" className="mb-3">
                  <thead className="table-light">
                    <tr>
                      <th>曜日</th>
                      <th>定休日</th>
                      <th>開店時間</th>
                      <th>閉店時間</th>
                    </tr>
                  </thead>
                  <tbody>
                    {businessHours
                      .sort((a, b) => a.dayOfWeek - b.dayOfWeek)
                      .map((h) => (
                        <tr key={h.dayOfWeek}>
                          <td className="align-middle fw-medium">{DAY_NAMES[h.dayOfWeek]}</td>
                          <td>
                            <Form.Check
                              type="checkbox"
                              checked={h.isClosed}
                              onChange={(e) => handleClosedChange(h.dayOfWeek, e.target.checked)}
                            />
                          </td>
                          <td>
                            <Form.Control
                              type="time"
                              size="sm"
                              value={h.openTime || ''}
                              onChange={(e) => handleHoursChange(h.dayOfWeek, 'openTime', e.target.value)}
                              disabled={h.isClosed}
                              style={{ maxWidth: '140px' }}
                            />
                          </td>
                          <td>
                            <Form.Control
                              type="time"
                              size="sm"
                              value={h.closeTime || ''}
                              onChange={(e) => handleHoursChange(h.dayOfWeek, 'closeTime', e.target.value)}
                              disabled={h.isClosed}
                              style={{ maxWidth: '140px' }}
                            />
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </Table>
              </div>
              <Button variant="primary" onClick={handleHoursSave} disabled={hoursSaving}>
                {hoursSaving ? '保存中...' : '営業時間を保存'}
              </Button>
            </>
          )}
        </Card.Body>
      </Card>

      <Card className="mt-3 border-danger">
        <Card.Header className="bg-danger-subtle text-danger-emphasis">退会</Card.Header>
        <Card.Body>
          <p className="small mb-3">
            退会するとアカウントは無効化され、ログインできなくなります。再利用する場合は管理者へお問い合わせください。
          </p>
          <Button
            variant="outline-danger"
            onClick={handleWithdraw}
            disabled={withdrawing}
          >
            {withdrawing ? '処理中...' : '退会する'}
          </Button>
        </Card.Body>
      </Card>
    </div>
  );
}
