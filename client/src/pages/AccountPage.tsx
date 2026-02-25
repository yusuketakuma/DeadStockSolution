import { useState, useEffect, FormEvent } from 'react';
import { Card, Form, Button, Alert, Row, Col, Table, Spinner } from 'react-bootstrap';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../api/client';
import { useNavigate } from 'react-router-dom';
import ConfirmActionModal from '../components/ConfirmActionModal';

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
  is24Hours: boolean;
}

type SpecialType = 'holiday_closed' | 'long_holiday_closed' | 'temporary_closed' | 'special_open';

interface SpecialHourEntry {
  id?: number;
  specialType: SpecialType;
  startDate: string;
  endDate: string;
  openTime: string | null;
  closeTime: string | null;
  isClosed: boolean;
  is24Hours: boolean;
  note: string | null;
}

interface BusinessHourSettingsResponse {
  hours: BusinessHourEntry[];
  specialHours: SpecialHourEntry[];
}

const SPECIAL_TYPE_LABELS: Record<SpecialType, string> = {
  holiday_closed: '祝日休業',
  long_holiday_closed: '大型連休休業',
  temporary_closed: '臨時休業',
  special_open: '特別営業時間',
};

function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function createDefaultSpecialHour(): SpecialHourEntry {
  const today = toDateInputValue(new Date());
  return {
    specialType: 'holiday_closed',
    startDate: today,
    endDate: today,
    openTime: null,
    closeTime: null,
    isClosed: true,
    is24Hours: false,
    note: null,
  };
}

function createDefaultHours(): BusinessHourEntry[] {
  return Array.from({ length: 7 }, (_, i) => ({
    dayOfWeek: i,
    openTime: i === 0 ? null : '09:00', // Sunday closed by default
    closeTime: i === 0 ? null : '18:00',
    isClosed: i === 0,
    is24Hours: false,
  }));
}

function normalizeBusinessHours(hours: BusinessHourEntry[]): BusinessHourEntry[] {
  const defaults = createDefaultHours();
  const byDay = new Map(
    hours
      .filter((h) => Number.isInteger(h.dayOfWeek) && h.dayOfWeek >= 0 && h.dayOfWeek <= 6)
      .map((h) => [h.dayOfWeek, h] as const)
  );

  return defaults.map((def) => {
    const found = byDay.get(def.dayOfWeek);
    if (!found) return def;

    const isClosed = Boolean(found.isClosed);
    const is24Hours = !isClosed && Boolean(found.is24Hours);
    return {
      dayOfWeek: def.dayOfWeek,
      isClosed,
      is24Hours,
      openTime: isClosed || is24Hours ? null : found.openTime ?? def.openTime,
      closeTime: isClosed || is24Hours ? null : found.closeTime ?? def.closeTime,
    };
  });
}

function formatHours(entry: BusinessHourEntry): string {
  if (entry.isClosed) return '定休日';
  if (entry.is24Hours) return '24時間営業';
  if (entry.openTime && entry.closeTime) return `${entry.openTime} - ${entry.closeTime}`;
  return '未設定';
}

function normalizeSpecialHours(entries: SpecialHourEntry[]): SpecialHourEntry[] {
  const validTypes: SpecialType[] = ['holiday_closed', 'long_holiday_closed', 'temporary_closed', 'special_open'];
  return [...entries]
    .filter((entry) =>
      entry
      && typeof entry.startDate === 'string'
      && typeof entry.endDate === 'string'
      && validTypes.includes(entry.specialType))
    .map((entry) => {
      const isClosed = entry.specialType === 'special_open' ? Boolean(entry.isClosed) : true;
      const is24Hours = entry.specialType === 'special_open' && !isClosed && Boolean(entry.is24Hours);
      return {
        id: entry.id,
        specialType: entry.specialType,
        startDate: entry.startDate,
        endDate: entry.endDate,
        openTime: isClosed || is24Hours ? null : entry.openTime ?? '09:00',
        closeTime: isClosed || is24Hours ? null : entry.closeTime ?? '18:00',
        isClosed,
        is24Hours,
        note: entry.note ?? null,
      };
    })
    .sort((a, b) => {
      if (a.startDate !== b.startDate) return a.startDate.localeCompare(b.startDate);
      if (a.endDate !== b.endDate) return a.endDate.localeCompare(b.endDate);
      return (a.id ?? 0) - (b.id ?? 0);
    });
}

function formatSpecialHours(entry: SpecialHourEntry): string {
  if (entry.isClosed) return '休業';
  if (entry.is24Hours) return '24時間営業';
  if (entry.openTime && entry.closeTime) return `${entry.openTime} - ${entry.closeTime}`;
  return '未設定';
}

export default function AccountPage() {
  const { refreshUser, logout } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: '', postalCode: '', address: '', phone: '', fax: '', prefecture: '',
    currentPassword: '', newPassword: '',
  });
  const [account, setAccount] = useState<AccountData | null>(null);
  const [accountLoaded, setAccountLoaded] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawPassword, setWithdrawPassword] = useState('');
  const [showWithdrawConfirm, setShowWithdrawConfirm] = useState(false);

  // Business hours state
  const [businessHours, setBusinessHours] = useState<BusinessHourEntry[]>(createDefaultHours());
  const [savedBusinessHours, setSavedBusinessHours] = useState<BusinessHourEntry[]>(createDefaultHours());
  const [specialHours, setSpecialHours] = useState<SpecialHourEntry[]>([]);
  const [savedSpecialHours, setSavedSpecialHours] = useState<SpecialHourEntry[]>([]);
  const [hoursLoaded, setHoursLoaded] = useState(false);
  const [hoursEditing, setHoursEditing] = useState(false);
  const [hoursSaving, setHoursSaving] = useState(false);
  const [hoursMessage, setHoursMessage] = useState('');
  const [hoursError, setHoursError] = useState('');

  useEffect(() => {
    let mounted = true;

    const loadAccount = async () => {
      try {
        const data = await api.get<AccountData>('/account');
        if (!mounted) return;
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
      } catch {
        if (!mounted) return;
        setError('アカウント情報の取得に失敗しました');
      } finally {
        if (!mounted) return;
        setAccountLoaded(true);
      }
    };

    const loadBusinessHours = async () => {
      try {
        const data = await api.get<BusinessHourSettingsResponse>('/business-hours/settings');
        if (!mounted) return;
        const normalizedWeekly = normalizeBusinessHours(data.hours ?? []);
        const normalizedSpecial = normalizeSpecialHours(data.specialHours ?? []);
        setBusinessHours(normalizedWeekly);
        setSavedBusinessHours(normalizedWeekly);
        setSpecialHours(normalizedSpecial);
        setSavedSpecialHours(normalizedSpecial);
      } catch (err) {
        if (!mounted) return;
        const defaults = createDefaultHours();
        setBusinessHours(defaults);
        setSavedBusinessHours(defaults);
        setSpecialHours([]);
        setSavedSpecialHours([]);
        setHoursError(err instanceof Error ? err.message : '営業時間の取得に失敗しました');
      } finally {
        if (!mounted) return;
        setHoursLoaded(true);
      }
    };

    void loadAccount();
    void loadBusinessHours();

    return () => {
      mounted = false;
    };
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
        ? { ...h, isClosed, is24Hours: false, openTime: isClosed ? null : (h.openTime || '09:00'), closeTime: isClosed ? null : (h.closeTime || '18:00') }
        : h
      )
    );
  };

  const handle24HoursChange = (dayOfWeek: number, is24Hours: boolean) => {
    setBusinessHours((prev) =>
      prev.map((h) => h.dayOfWeek === dayOfWeek
        ? { ...h, is24Hours, isClosed: false, openTime: is24Hours ? null : (h.openTime || '09:00'), closeTime: is24Hours ? null : (h.closeTime || '18:00') }
        : h
      )
    );
  };

  const handleHoursSave = async () => {
    setHoursError('');
    setHoursMessage('');

    const invalidDateRange = specialHours.find((entry) => entry.startDate > entry.endDate);
    if (invalidDateRange) {
      setHoursError('特例営業時間の開始日と終了日の順序が不正です');
      return;
    }

    const invalidSpecialHours = specialHours.find((entry) =>
      entry.specialType === 'special_open'
      && !entry.isClosed
      && !entry.is24Hours
      && (!entry.openTime || !entry.closeTime || entry.openTime === entry.closeTime));
    if (invalidSpecialHours) {
      setHoursError('特別営業時間の開店時間・閉店時間を正しく入力してください');
      return;
    }

    setHoursSaving(true);
    try {
      const payloadSpecialHours = specialHours.map((entry) => ({
        specialType: entry.specialType,
        startDate: entry.startDate,
        endDate: entry.endDate,
        openTime: entry.isClosed || entry.is24Hours ? null : entry.openTime,
        closeTime: entry.isClosed || entry.is24Hours ? null : entry.closeTime,
        isClosed: entry.isClosed,
        is24Hours: entry.is24Hours,
        note: entry.note?.trim() || null,
      }));
      await api.put('/business-hours', { hours: businessHours, specialHours: payloadSpecialHours });
      const normalizedSpecial = normalizeSpecialHours(specialHours);
      setSpecialHours(normalizedSpecial);
      setSavedBusinessHours(businessHours);
      setSavedSpecialHours(normalizedSpecial);
      setHoursEditing(false);
      setHoursMessage('営業時間を更新しました');
    } catch (err) {
      setHoursError(err instanceof Error ? err.message : '営業時間の更新に失敗しました');
    } finally {
      setHoursSaving(false);
    }
  };

  const handleHoursEditStart = () => {
    setHoursError('');
    setHoursMessage('');
    setHoursEditing(true);
  };

  const handleHoursEditCancel = () => {
    setBusinessHours(savedBusinessHours);
    setSpecialHours(savedSpecialHours);
    setHoursError('');
    setHoursMessage('');
    setHoursEditing(false);
  };

  const handleAddSpecialHour = () => {
    setSpecialHours((prev) => [...prev, createDefaultSpecialHour()]);
  };

  const handleRemoveSpecialHour = (index: number) => {
    setSpecialHours((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSpecialTypeChange = (index: number, specialType: SpecialType) => {
    setSpecialHours((prev) =>
      prev.map((entry, i) => {
        if (i !== index) return entry;
        if (specialType !== 'special_open') {
          return {
            ...entry,
            specialType,
            isClosed: true,
            is24Hours: false,
            openTime: null,
            closeTime: null,
          };
        }
        return {
          ...entry,
          specialType,
          isClosed: false,
          is24Hours: false,
          openTime: entry.openTime || '09:00',
          closeTime: entry.closeTime || '18:00',
        };
      }),
    );
  };

  const handleSpecialDateChange = (index: number, field: 'startDate' | 'endDate', value: string) => {
    setSpecialHours((prev) =>
      prev.map((entry, i) => (i === index ? { ...entry, [field]: value } : entry)),
    );
  };

  const handleSpecialNoteChange = (index: number, value: string) => {
    setSpecialHours((prev) =>
      prev.map((entry, i) => (i === index ? { ...entry, note: value || null } : entry)),
    );
  };

  const handleSpecialHoursChange = (index: number, field: 'openTime' | 'closeTime', value: string) => {
    setSpecialHours((prev) =>
      prev.map((entry, i) => (i === index ? { ...entry, [field]: value } : entry)),
    );
  };

  const handleSpecialClosedChange = (index: number, isClosed: boolean) => {
    setSpecialHours((prev) =>
      prev.map((entry, i) => {
        if (i !== index) return entry;
        return {
          ...entry,
          isClosed,
          is24Hours: false,
          openTime: isClosed ? null : (entry.openTime || '09:00'),
          closeTime: isClosed ? null : (entry.closeTime || '18:00'),
        };
      }),
    );
  };

  const handleSpecial24HoursChange = (index: number, is24Hours: boolean) => {
    setSpecialHours((prev) =>
      prev.map((entry, i) => {
        if (i !== index) return entry;
        return {
          ...entry,
          is24Hours,
          isClosed: false,
          openTime: is24Hours ? null : (entry.openTime || '09:00'),
          closeTime: is24Hours ? null : (entry.closeTime || '18:00'),
        };
      }),
    );
  };

  const handleWithdraw = () => {
    if (!withdrawPassword) {
      setError('退会には現在のパスワードが必要です');
      return;
    }
    setShowWithdrawConfirm(true);
  };

  const handleWithdrawConfirmed = async () => {
    setShowWithdrawConfirm(false);
    setWithdrawing(true);
    setError('');
    setMessage('');
    try {
      await api.delete<{ message: string }>('/account', { currentPassword: withdrawPassword });
      setWithdrawPassword('');
      await logout();
      navigate('/login');
    } catch (err) {
      setError(err instanceof Error ? err.message : '退会処理に失敗しました');
    } finally {
      setWithdrawing(false);
    }
  };

  if (!accountLoaded) {
    return (
      <div className="d-flex align-items-center gap-2 text-muted small">
        <Spinner size="sm" />
        アカウント情報を読み込み中...
      </div>
    );
  }

  if (!account) {
    return (
      <div>
        <h4 className="page-title mb-3">薬局登録情報の編集</h4>
        {error && <Alert variant="danger">{error}</Alert>}
        <Button variant="outline-secondary" onClick={() => window.location.reload()}>
          再読み込み
        </Button>
      </div>
    );
  }

  const orderedBusinessHours = [...businessHours].sort((a, b) => a.dayOfWeek - b.dayOfWeek);

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
          <p className="small text-muted mb-3">
            特例営業時間（祝日・大型連休・臨時休業）は通常営業時間より優先されます。
          </p>

          {!hoursLoaded && (
            <div className="d-flex align-items-center gap-2 text-muted small">
              <Spinner size="sm" />
              営業時間を読み込み中...
            </div>
          )}

          {hoursLoaded && (
            <>
              <div className="table-responsive">
                <Table size="sm" className="mb-3">
                  <thead className="table-light">
                    <tr>
                      <th>曜日</th>
                      {hoursEditing ? (
                        <>
                          <th>定休日</th>
                          <th>24時間</th>
                          <th>開店時間</th>
                          <th>閉店時間</th>
                        </>
                      ) : (
                        <th>営業時間</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {orderedBusinessHours.map((h) => (
                        <tr key={h.dayOfWeek}>
                          <td className="align-middle fw-medium">{DAY_NAMES[h.dayOfWeek]}</td>
                          {hoursEditing ? (
                            <>
                              <td>
                                <Form.Check
                                  type="checkbox"
                                  checked={h.isClosed}
                                  onChange={(e) => handleClosedChange(h.dayOfWeek, e.target.checked)}
                                  disabled={h.is24Hours}
                                />
                              </td>
                              <td>
                                <Form.Check
                                  type="checkbox"
                                  checked={h.is24Hours}
                                  onChange={(e) => handle24HoursChange(h.dayOfWeek, e.target.checked)}
                                  disabled={h.isClosed}
                                />
                              </td>
                              <td>
                                <Form.Control
                                  type="time"
                                  size="sm"
                                  value={h.openTime || ''}
                                  onChange={(e) => handleHoursChange(h.dayOfWeek, 'openTime', e.target.value)}
                                  disabled={h.isClosed || h.is24Hours}
                                  className="time-input"
                                />
                              </td>
                              <td>
                                <Form.Control
                                  type="time"
                                  size="sm"
                                  value={h.closeTime || ''}
                                  onChange={(e) => handleHoursChange(h.dayOfWeek, 'closeTime', e.target.value)}
                                  disabled={h.isClosed || h.is24Hours}
                                  className="time-input"
                                />
                              </td>
                            </>
                          ) : (
                            <td className="align-middle">{formatHours(h)}</td>
                          )}
                        </tr>
                      ))}
                  </tbody>
                </Table>
              </div>

              <hr className="my-3" />

              <div className="d-flex justify-content-between align-items-center mb-2">
                <h6 className="mb-0">特例営業時間（祝日・大型連休・臨時休業）</h6>
                {hoursEditing && (
                  <Button variant="outline-primary" size="sm" onClick={handleAddSpecialHour}>
                    特例を追加
                  </Button>
                )}
              </div>

              <div className="table-responsive">
                <Table size="sm" className="mb-3">
                  <thead className="table-light">
                    <tr>
                      <th>種別</th>
                      <th>期間</th>
                      <th>営業時間</th>
                      <th>メモ</th>
                      {hoursEditing && <th>操作</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {specialHours.length === 0 && (
                      <tr>
                        <td colSpan={hoursEditing ? 5 : 4} className="text-muted small">
                          特例営業時間は未登録です。
                        </td>
                      </tr>
                    )}

                    {specialHours.map((entry, index) => (
                      <tr key={`${entry.id ?? 'new'}-${index}`}>
                        <td className="align-middle">
                          {hoursEditing ? (
                            <Form.Select
                              size="sm"
                              value={entry.specialType}
                              onChange={(e) => handleSpecialTypeChange(index, e.target.value as SpecialType)}
                            >
                              {Object.entries(SPECIAL_TYPE_LABELS).map(([value, label]) => (
                                <option key={value} value={value}>{label}</option>
                              ))}
                            </Form.Select>
                          ) : (
                            SPECIAL_TYPE_LABELS[entry.specialType]
                          )}
                        </td>
                        <td className="align-middle">
                          {hoursEditing ? (
                            <div className="d-flex flex-column gap-1">
                              <Form.Control
                                type="date"
                                size="sm"
                                value={entry.startDate}
                                onChange={(e) => handleSpecialDateChange(index, 'startDate', e.target.value)}
                              />
                              <Form.Control
                                type="date"
                                size="sm"
                                value={entry.endDate}
                                onChange={(e) => handleSpecialDateChange(index, 'endDate', e.target.value)}
                              />
                            </div>
                          ) : (
                            entry.startDate === entry.endDate
                              ? entry.startDate
                              : `${entry.startDate} 〜 ${entry.endDate}`
                          )}
                        </td>
                        <td className="align-middle">
                          {!hoursEditing ? (
                            formatSpecialHours(entry)
                          ) : entry.specialType !== 'special_open' ? (
                            <span className="text-muted small">休業</span>
                          ) : (
                            <div className="d-flex flex-column gap-1">
                              <div className="d-flex gap-3">
                                <Form.Check
                                  type="checkbox"
                                  label="休業"
                                  checked={entry.isClosed}
                                  onChange={(e) => handleSpecialClosedChange(index, e.target.checked)}
                                  disabled={entry.is24Hours}
                                />
                                <Form.Check
                                  type="checkbox"
                                  label="24時間"
                                  checked={entry.is24Hours}
                                  onChange={(e) => handleSpecial24HoursChange(index, e.target.checked)}
                                  disabled={entry.isClosed}
                                />
                              </div>
                              <div className="d-flex gap-2">
                                <Form.Control
                                  type="time"
                                  size="sm"
                                  value={entry.openTime || ''}
                                  onChange={(e) => handleSpecialHoursChange(index, 'openTime', e.target.value)}
                                  disabled={entry.isClosed || entry.is24Hours}
                                  className="time-input"
                                />
                                <Form.Control
                                  type="time"
                                  size="sm"
                                  value={entry.closeTime || ''}
                                  onChange={(e) => handleSpecialHoursChange(index, 'closeTime', e.target.value)}
                                  disabled={entry.isClosed || entry.is24Hours}
                                  className="time-input"
                                />
                              </div>
                            </div>
                          )}
                        </td>
                        <td className="align-middle">
                          {hoursEditing ? (
                            <Form.Control
                              size="sm"
                              placeholder="任意メモ"
                              value={entry.note || ''}
                              onChange={(e) => handleSpecialNoteChange(index, e.target.value)}
                              maxLength={200}
                            />
                          ) : (
                            <span className="small">{entry.note || '-'}</span>
                          )}
                        </td>
                        {hoursEditing && (
                          <td className="align-middle">
                            <Button
                              variant="outline-danger"
                              size="sm"
                              onClick={() => handleRemoveSpecialHour(index)}
                            >
                              削除
                            </Button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>

              {!hoursEditing ? (
                <Button variant="outline-primary" onClick={handleHoursEditStart}>
                  営業時間を編集
                </Button>
              ) : (
                <div className="d-flex gap-2">
                  <Button variant="primary" onClick={handleHoursSave} disabled={hoursSaving}>
                    {hoursSaving ? '保存中...' : '営業時間を保存'}
                  </Button>
                  <Button variant="outline-secondary" onClick={handleHoursEditCancel} disabled={hoursSaving}>
                    キャンセル
                  </Button>
                </div>
              )}
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
          <Form.Group className="mb-3 form-max-360">
            <Form.Label>現在のパスワード</Form.Label>
            <Form.Control
              type="password"
              value={withdrawPassword}
              onChange={(e) => setWithdrawPassword(e.target.value)}
              autoComplete="current-password"
            />
            <Form.Text className="text-muted">本人確認のため必須です</Form.Text>
          </Form.Group>
          <Button
            variant="outline-danger"
            onClick={handleWithdraw}
            disabled={withdrawing || !withdrawPassword}
          >
            {withdrawing ? '処理中...' : '退会する'}
          </Button>
        </Card.Body>
      </Card>

      <ConfirmActionModal
        show={showWithdrawConfirm}
        title="退会の確認"
        body="退会するとアカウントは無効化され、現在のセッションは終了します。実行してよろしいですか？"
        confirmLabel="退会する"
        confirmVariant="danger"
        onCancel={() => setShowWithdrawConfirm(false)}
        onConfirm={handleWithdrawConfirmed}
        pending={withdrawing}
      />
    </div>
  );
}
