import { useState, useEffect, FormEvent } from 'react';
import { Card, Form, Button, Alert, Row, Col } from 'react-bootstrap';
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
