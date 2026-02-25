import { FormEvent } from 'react';
import { Card, Form, Button, Row, Col } from 'react-bootstrap';
import { AccountData, PREFECTURES } from './types';

export interface AccountFormState {
  name: string;
  postalCode: string;
  address: string;
  phone: string;
  fax: string;
  prefecture: string;
  currentPassword: string;
  newPassword: string;
}

interface AccountInfoFormProps {
  account: AccountData;
  form: AccountFormState;
  loading: boolean;
  onSubmit: (e: FormEvent) => void;
  onChange: (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => void;
}

export default function AccountInfoForm({ account, form, loading, onSubmit, onChange }: AccountInfoFormProps) {
  return (
    <Card>
      <Card.Body>
        <Form onSubmit={onSubmit}>
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
            <Form.Control type="text" value={form.name} onChange={onChange('name')} />
          </Form.Group>

          <Row>
            <Col md={6}>
              <Form.Group className="mb-3">
                <Form.Label>都道府県</Form.Label>
                <Form.Select value={form.prefecture} onChange={onChange('prefecture')}>
                  {PREFECTURES.map((pref) => (
                    <option key={pref} value={pref}>{pref}</option>
                  ))}
                </Form.Select>
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group className="mb-3">
                <Form.Label>郵便番号</Form.Label>
                <Form.Control type="text" value={form.postalCode} onChange={onChange('postalCode')} />
              </Form.Group>
            </Col>
          </Row>

          <Form.Group className="mb-3">
            <Form.Label>住所</Form.Label>
            <Form.Control type="text" value={form.address} onChange={onChange('address')} />
          </Form.Group>

          <Row>
            <Col md={6}>
              <Form.Group className="mb-3">
                <Form.Label>電話番号</Form.Label>
                <Form.Control type="tel" value={form.phone} onChange={onChange('phone')} />
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group className="mb-3">
                <Form.Label>FAX番号</Form.Label>
                <Form.Control type="tel" value={form.fax} onChange={onChange('fax')} />
              </Form.Group>
            </Col>
          </Row>

          <hr />
          <h6>パスワード変更（変更する場合のみ入力）</h6>
          <Row>
            <Col md={6}>
              <Form.Group className="mb-3">
                <Form.Label>現在のパスワード</Form.Label>
                <Form.Control type="password" value={form.currentPassword} onChange={onChange('currentPassword')} />
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group className="mb-3">
                <Form.Label>新しいパスワード</Form.Label>
                <Form.Control type="password" value={form.newPassword} onChange={onChange('newPassword')} minLength={8} />
              </Form.Group>
            </Col>
          </Row>

          <Button type="submit" variant="primary" disabled={loading}>
            {loading ? '更新中...' : '更新'}
          </Button>
        </Form>
      </Card.Body>
    </Card>
  );
}
