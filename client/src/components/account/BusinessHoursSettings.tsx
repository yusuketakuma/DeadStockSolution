import { Alert, Button, Card, Form, Spinner, Table } from 'react-bootstrap';
import {
  BusinessHourEntry,
  DAY_NAMES,
  SPECIAL_TYPE_LABELS,
  SpecialHourEntry,
  SpecialType,
  formatHours,
  formatSpecialHours,
} from './types';

interface BusinessHoursSettingsProps {
  businessHours: BusinessHourEntry[];
  specialHours: SpecialHourEntry[];
  hoursLoaded: boolean;
  hoursEditing: boolean;
  hoursSaving: boolean;
  hoursMessage: string;
  hoursError: string;
  onHoursMessage: (msg: string) => void;
  onHoursError: (err: string) => void;
  onHoursChange: (dayOfWeek: number, field: 'openTime' | 'closeTime', value: string) => void;
  onClosedChange: (dayOfWeek: number, isClosed: boolean) => void;
  on24HoursChange: (dayOfWeek: number, is24Hours: boolean) => void;
  onHoursSave: () => void;
  onHoursEditStart: () => void;
  onHoursEditCancel: () => void;
  onAddSpecialHour: () => void;
  onRemoveSpecialHour: (index: number) => void;
  onSpecialTypeChange: (index: number, specialType: SpecialType) => void;
  onSpecialDateChange: (index: number, field: 'startDate' | 'endDate', value: string) => void;
  onSpecialNoteChange: (index: number, value: string) => void;
  onSpecialHoursChange: (index: number, field: 'openTime' | 'closeTime', value: string) => void;
  onSpecialClosedChange: (index: number, isClosed: boolean) => void;
  onSpecial24HoursChange: (index: number, is24Hours: boolean) => void;
}

export default function BusinessHoursSettings({
  businessHours,
  specialHours,
  hoursLoaded,
  hoursEditing,
  hoursSaving,
  hoursMessage,
  hoursError,
  onHoursMessage,
  onHoursError,
  onHoursChange,
  onClosedChange,
  on24HoursChange,
  onHoursSave,
  onHoursEditStart,
  onHoursEditCancel,
  onAddSpecialHour,
  onRemoveSpecialHour,
  onSpecialTypeChange,
  onSpecialDateChange,
  onSpecialNoteChange,
  onSpecialHoursChange,
  onSpecialClosedChange,
  onSpecial24HoursChange,
}: BusinessHoursSettingsProps) {
  const orderedBusinessHours = [...businessHours].sort((a, b) => a.dayOfWeek - b.dayOfWeek);

  return (
    <Card className="mt-3">
      <Card.Header>営業時間設定</Card.Header>
      <Card.Body>
        {hoursMessage && (
          <Alert variant="success" onClose={() => onHoursMessage('')} dismissible>
            {hoursMessage}
          </Alert>
        )}
        {hoursError && (
          <Alert variant="danger" onClose={() => onHoursError('')} dismissible>
            {hoursError}
          </Alert>
        )}

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
                              onChange={(e) => onClosedChange(h.dayOfWeek, e.target.checked)}
                              disabled={h.is24Hours}
                            />
                          </td>
                          <td>
                            <Form.Check
                              type="checkbox"
                              checked={h.is24Hours}
                              onChange={(e) => on24HoursChange(h.dayOfWeek, e.target.checked)}
                              disabled={h.isClosed}
                            />
                          </td>
                          <td>
                            <Form.Control
                              type="time"
                              size="sm"
                              value={h.openTime || ''}
                              onChange={(e) => onHoursChange(h.dayOfWeek, 'openTime', e.target.value)}
                              disabled={h.isClosed || h.is24Hours}
                              className="time-input"
                            />
                          </td>
                          <td>
                            <Form.Control
                              type="time"
                              size="sm"
                              value={h.closeTime || ''}
                              onChange={(e) => onHoursChange(h.dayOfWeek, 'closeTime', e.target.value)}
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
                <Button variant="outline-primary" size="sm" onClick={onAddSpecialHour}>
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
                            onChange={(e) => onSpecialTypeChange(index, e.target.value as SpecialType)}
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
                              onChange={(e) => onSpecialDateChange(index, 'startDate', e.target.value)}
                            />
                            <Form.Control
                              type="date"
                              size="sm"
                              value={entry.endDate}
                              onChange={(e) => onSpecialDateChange(index, 'endDate', e.target.value)}
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
                                onChange={(e) => onSpecialClosedChange(index, e.target.checked)}
                                disabled={entry.is24Hours}
                              />
                              <Form.Check
                                type="checkbox"
                                label="24時間"
                                checked={entry.is24Hours}
                                onChange={(e) => onSpecial24HoursChange(index, e.target.checked)}
                                disabled={entry.isClosed}
                              />
                            </div>
                            <div className="d-flex gap-2">
                              <Form.Control
                                type="time"
                                size="sm"
                                value={entry.openTime || ''}
                                onChange={(e) => onSpecialHoursChange(index, 'openTime', e.target.value)}
                                disabled={entry.isClosed || entry.is24Hours}
                                className="time-input"
                              />
                              <Form.Control
                                type="time"
                                size="sm"
                                value={entry.closeTime || ''}
                                onChange={(e) => onSpecialHoursChange(index, 'closeTime', e.target.value)}
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
                            onChange={(e) => onSpecialNoteChange(index, e.target.value)}
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
                            onClick={() => onRemoveSpecialHour(index)}
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
              <Button variant="outline-primary" onClick={onHoursEditStart}>
                営業時間を編集
              </Button>
            ) : (
              <div className="d-flex gap-2">
                <Button variant="primary" onClick={onHoursSave} disabled={hoursSaving}>
                  {hoursSaving ? '保存中...' : '営業時間を保存'}
                </Button>
                <Button variant="outline-secondary" onClick={onHoursEditCancel} disabled={hoursSaving}>
                  キャンセル
                </Button>
              </div>
            )}
          </>
        )}
      </Card.Body>
    </Card>
  );
}
