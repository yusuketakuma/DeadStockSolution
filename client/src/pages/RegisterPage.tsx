import { useState, FormEvent } from 'react';
import { Container, Card, Form, Button, Alert, Row, Col } from 'react-bootstrap';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { ApiError, type FieldError } from '../api/client';

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

export default function RegisterPage() {
  const [form, setForm] = useState({
    email: '', password: '', name: '', postalCode: '', address: '',
    phone: '', fax: '', licenseNumber: '', prefecture: '',
  });
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();

  const handleChange = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
    // 入力時にそのフィールドのエラーをクリア
    setFieldErrors((prev) => prev.filter((fe) => fe.field !== field));
  };

  const getFieldError = (field: string): string | undefined => {
    return fieldErrors.find((fe) => fe.field === field)?.message;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!agreed) {
      setError('免責事項に同意してください');
      return;
    }
    setError('');
    setFieldErrors([]);
    setLoading(true);
    try {
      await register(form);
      navigate('/');
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors && err.fieldErrors.length > 0) {
        setFieldErrors(err.fieldErrors);
        setError('入力内容にエラーがあります。各項目を確認してください。');
      } else {
        setError(err instanceof Error ? err.message : '登録に失敗しました');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container className="py-4 form-max-640">
      <Card>
        <Card.Body>
          <h4 className="text-center mb-4">新規薬局登録</h4>
          {error && <Alert variant="danger">{error}</Alert>}
          <Form onSubmit={handleSubmit}>
            <Form.Group className="mb-3">
              <Form.Label>メールアドレス <span className="text-danger">*</span></Form.Label>
              <Form.Control
                type="email"
                value={form.email}
                onChange={handleChange('email')}
                required
                isInvalid={!!getFieldError('email')}
              />
              <Form.Control.Feedback type="invalid">{getFieldError('email')}</Form.Control.Feedback>
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>パスワード <span className="text-danger">*</span></Form.Label>
              <Form.Control
                type="password"
                value={form.password}
                onChange={handleChange('password')}
                required
                minLength={8}
                isInvalid={!!getFieldError('password')}
              />
              <Form.Control.Feedback type="invalid">{getFieldError('password')}</Form.Control.Feedback>
              {!getFieldError('password') && <Form.Text className="text-muted">8文字以上</Form.Text>}
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>薬局名 <span className="text-danger">*</span></Form.Label>
              <Form.Control
                type="text"
                value={form.name}
                onChange={handleChange('name')}
                required
                isInvalid={!!getFieldError('name')}
              />
              <Form.Control.Feedback type="invalid">{getFieldError('name')}</Form.Control.Feedback>
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>薬局開設許可番号 <span className="text-danger">*</span></Form.Label>
              <Form.Control
                type="text"
                value={form.licenseNumber}
                onChange={handleChange('licenseNumber')}
                required
                isInvalid={!!getFieldError('licenseNumber')}
              />
              <Form.Control.Feedback type="invalid">{getFieldError('licenseNumber')}</Form.Control.Feedback>
            </Form.Group>

            <Row>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>都道府県 <span className="text-danger">*</span></Form.Label>
                  <Form.Select
                    value={form.prefecture}
                    onChange={handleChange('prefecture')}
                    required
                    isInvalid={!!getFieldError('prefecture')}
                  >
                    <option value="">選択してください</option>
                    {PREFECTURES.map((pref) => (
                      <option key={pref} value={pref}>{pref}</option>
                    ))}
                  </Form.Select>
                  <Form.Control.Feedback type="invalid">{getFieldError('prefecture')}</Form.Control.Feedback>
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>郵便番号 <span className="text-danger">*</span></Form.Label>
                  <Form.Control
                    type="text"
                    value={form.postalCode}
                    onChange={handleChange('postalCode')}
                    placeholder="1234567"
                    required
                    isInvalid={!!getFieldError('postalCode')}
                  />
                  <Form.Control.Feedback type="invalid">{getFieldError('postalCode')}</Form.Control.Feedback>
                </Form.Group>
              </Col>
            </Row>

            <Form.Group className="mb-3">
              <Form.Label>住所 <span className="text-danger">*</span></Form.Label>
              <Form.Control
                type="text"
                value={form.address}
                onChange={handleChange('address')}
                required
                isInvalid={!!getFieldError('address')}
                placeholder="市区町村以降の住所"
              />
              <Form.Control.Feedback type="invalid">{getFieldError('address')}</Form.Control.Feedback>
              {!getFieldError('address') && <Form.Text className="text-muted">位置情報の特定に使用します。正確な住所を入力してください</Form.Text>}
            </Form.Group>

            <Row>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>電話番号 <span className="text-danger">*</span></Form.Label>
                  <Form.Control
                    type="tel"
                    value={form.phone}
                    onChange={handleChange('phone')}
                    required
                    isInvalid={!!getFieldError('phone')}
                  />
                  <Form.Control.Feedback type="invalid">{getFieldError('phone')}</Form.Control.Feedback>
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>FAX番号 <span className="text-danger">*</span></Form.Label>
                  <Form.Control
                    type="tel"
                    value={form.fax}
                    onChange={handleChange('fax')}
                    required
                    isInvalid={!!getFieldError('fax')}
                  />
                  <Form.Control.Feedback type="invalid">{getFieldError('fax')}</Form.Control.Feedback>
                </Form.Group>
              </Col>
            </Row>

            <Form.Check
              type="checkbox"
              className="mb-3"
              label="本システムはあくまで業務補助ツールであり、医薬品の交換に関する一切の責任を負わないことに同意します"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
            />

            <Button type="submit" variant="primary" className="w-100" disabled={loading || !agreed}>
              {loading ? '登録中...' : '登録'}
            </Button>
          </Form>
          <div className="text-center mt-3">
            <Link to="/login">ログインはこちら</Link>
          </div>
        </Card.Body>
      </Card>
    </Container>
  );
}
