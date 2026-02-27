import { FormEvent } from 'react';
import { Row, Col } from 'react-bootstrap';
import { PREFECTURES } from './types';
import AppSelect from '../ui/AppSelect';
import LoadingButton from '../ui/LoadingButton';
import AppField from '../ui/AppField';
import AppDataPanel from '../ui/AppDataPanel';

export interface AccountFormState {
  email: string;
  name: string;
  postalCode: string;
  address: string;
  phone: string;
  fax: string;
  prefecture: string;
  licenseNumber: string;
  currentPassword: string;
  newPassword: string;
}

interface AccountInfoFormProps {
  form: AccountFormState;
  loading: boolean;
  submitDisabled?: boolean;
  onSubmit: (e: FormEvent) => void;
  onChange: (field: keyof AccountFormState, value: string) => void;
  showPasswordSection?: boolean;
}

export default function AccountInfoForm({
  form,
  loading,
  submitDisabled = false,
  onSubmit,
  onChange,
  showPasswordSection = true,
}: AccountInfoFormProps) {
  return (
    <AppDataPanel>
        <form onSubmit={onSubmit}>
          <AppField
            className="mb-3"
            controlId="account-email"
            label="メールアドレス"
            type="email"
            value={form.email}
            autoComplete="email"
            onChange={(value) => onChange('email', value)}
          />

          <AppField
            className="mb-3"
            controlId="account-license-number"
            label="薬局開設許可番号"
            type="text"
            value={form.licenseNumber}
            onChange={(value) => onChange('licenseNumber', value)}
          />

          <AppField
            className="mb-3"
            controlId="account-name"
            label="薬局名"
            type="text"
            value={form.name}
            onChange={(value) => onChange('name', value)}
          />

          <Row>
            <Col md={6}>
              <AppSelect
                className="mb-3"
                controlId="account-prefecture"
                label="都道府県"
                value={form.prefecture}
                onChange={(value) => onChange('prefecture', value)}
                options={PREFECTURES.map((pref) => ({ value: pref, label: pref }))}
              />
            </Col>
            <Col md={6}>
              <AppField
                className="mb-3"
                controlId="account-postal-code"
                label="郵便番号"
                type="text"
                value={form.postalCode}
                autoComplete="postal-code"
                inputMode="numeric"
                placeholder="例: 1000001"
                onChange={(value) => onChange('postalCode', value)}
              />
            </Col>
          </Row>

          <AppField
            className="mb-3"
            controlId="account-address"
            label="住所"
            type="text"
            value={form.address}
            autoComplete="street-address"
            onChange={(value) => onChange('address', value)}
          />

          <Row>
            <Col md={6}>
              <AppField
                className="mb-3"
                controlId="account-phone"
                label="電話番号"
                type="tel"
                value={form.phone}
                autoComplete="tel"
                inputMode="tel"
                onChange={(value) => onChange('phone', value)}
              />
            </Col>
            <Col md={6}>
              <AppField
                className="mb-3"
                controlId="account-fax"
                label="FAX番号"
                type="tel"
                value={form.fax}
                inputMode="tel"
                placeholder="例: 03-1234-5678"
                onChange={(value) => onChange('fax', value)}
              />
            </Col>
          </Row>

          {showPasswordSection && (
            <>
              <hr />
              <h6>パスワード変更（変更する場合のみ入力）</h6>
              <Row>
                <Col md={6}>
                  <AppField
                    className="mb-3"
                    controlId="account-current-password"
                    label="現在のパスワード"
                    type="password"
                    value={form.currentPassword}
                    autoComplete="current-password"
                    onChange={(value) => onChange('currentPassword', value)}
                  />
                </Col>
                <Col md={6}>
                  <AppField
                    className="mb-3"
                    controlId="account-new-password"
                    label="新しいパスワード"
                    type="password"
                    value={form.newPassword}
                    autoComplete="new-password"
                    onChange={(value) => onChange('newPassword', value)}
                    minLength={8}
                  />
                </Col>
              </Row>
            </>
          )}

          <LoadingButton
            type="submit"
            variant="primary"
            loading={loading}
            loadingLabel="更新中..."
            disabled={submitDisabled}
          >
            更新
          </LoadingButton>
        </form>
    </AppDataPanel>
  );
}
