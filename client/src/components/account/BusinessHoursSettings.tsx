import { memo, useMemo } from 'react';
import AppTable from '../ui/AppTable';
import AppButton from '../ui/AppButton';
import AppAlert from '../ui/AppAlert';
import { Form } from 'react-bootstrap';
import InlineLoader from '../ui/InlineLoader';
import AppSelect from '../ui/AppSelect';
import LoadingButton from '../ui/LoadingButton';
import AppDataPanel from '../ui/AppDataPanel';
import AppControl from '../ui/AppControl';
import AppMobileDataCard from '../ui/AppMobileDataCard';
import AppResponsiveSwitch from '../ui/AppResponsiveSwitch';
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
  hoursEditable?: boolean;
  hoursSaving: boolean;
  hoursMessage: string;
  hoursError: string;
  onRetryLoad?: () => void;
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

function BusinessHoursSettings({
  businessHours,
  specialHours,
  hoursLoaded,
  hoursEditing,
  hoursEditable = true,
  hoursSaving,
  hoursMessage,
  hoursError,
  onRetryLoad,
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
  const orderedBusinessHours = useMemo(
    () => [...businessHours].sort((a, b) => a.dayOfWeek - b.dayOfWeek),
    [businessHours],
  );
  const specialTypeOptions = useMemo(
    () => Object.entries(SPECIAL_TYPE_LABELS).map(([value, label]) => ({ value, label })),
    [],
  );
  const canEditHours = hoursEditable && orderedBusinessHours.length > 0;

  return (
    <AppDataPanel title="営業時間設定" className="mt-3">
        {hoursMessage && (
          <AppAlert variant="success" onClose={() => onHoursMessage('')} dismissible>
            {hoursMessage}
          </AppAlert>
        )}
        {hoursError && (
          <AppAlert variant="danger" onClose={() => onHoursError('')} dismissible>
            {hoursError}
          </AppAlert>
        )}
        {hoursLoaded && !hoursEditable && (
          <AppAlert variant="warning" className="d-flex flex-wrap justify-content-between align-items-center gap-2">
            <span>営業時間データを取得できていないため、編集は無効です。</span>
            {onRetryLoad && (
              <AppButton size="sm" variant="outline-warning" onClick={onRetryLoad}>
                再読み込み
              </AppButton>
            )}
          </AppAlert>
        )}

        <p className="small text-muted mb-3">
          営業時間を設定すると、マッチングや在庫検索で他の薬局に表示されます。
        </p>
        <p className="small text-muted mb-3">
          特例営業時間（祝日・大型連休・臨時休業）は通常営業時間より優先されます。
        </p>

        {!hoursLoaded && (
          <InlineLoader text="営業時間を読み込み中..." className="text-muted small" />
        )}

        {hoursLoaded && (
          <>
            <AppResponsiveSwitch
              desktop={() => (
                <div className="table-responsive">
                  <AppTable size="sm" className="mb-3">
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
                      {orderedBusinessHours.length === 0 && (
                        <tr>
                          <td colSpan={hoursEditing ? 5 : 2} className="text-muted small">
                            営業時間データがありません。{onRetryLoad ? '再読み込みしてください。' : ''}
                          </td>
                        </tr>
                      )}
                      {orderedBusinessHours.map((h) => (
                        <tr key={h.dayOfWeek}>
                          <td className="align-middle fw-medium">{DAY_NAMES[h.dayOfWeek]}</td>
                          {hoursEditing ? (
                            <>
                              <td>
                                <Form.Check
                                  type="checkbox"
                                  checked={h.isClosed}
                                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => onClosedChange(h.dayOfWeek, e.target.checked)}
                                  disabled={h.is24Hours}
                                  aria-label={`${DAY_NAMES[h.dayOfWeek]} 定休日`}
                                />
                              </td>
                              <td>
                                <Form.Check
                                  type="checkbox"
                                  checked={h.is24Hours}
                                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => on24HoursChange(h.dayOfWeek, e.target.checked)}
                                  disabled={h.isClosed}
                                  aria-label={`${DAY_NAMES[h.dayOfWeek]} 24時間営業`}
                                />
                              </td>
                              <td>
                                <AppControl
                                  type="time"
                                  size="sm"
                                  value={h.openTime || ''}
                                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => onHoursChange(h.dayOfWeek, 'openTime', e.target.value)}
                                  disabled={h.isClosed || h.is24Hours}
                                  className="time-input"
                                  aria-label={`${DAY_NAMES[h.dayOfWeek]} 開店時間`}
                                />
                              </td>
                              <td>
                                <AppControl
                                  type="time"
                                  size="sm"
                                  value={h.closeTime || ''}
                                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => onHoursChange(h.dayOfWeek, 'closeTime', e.target.value)}
                                  disabled={h.isClosed || h.is24Hours}
                                  className="time-input"
                                  aria-label={`${DAY_NAMES[h.dayOfWeek]} 閉店時間`}
                                />
                              </td>
                            </>
                          ) : (
                            <td className="align-middle">{formatHours(h)}</td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </AppTable>
                </div>
              )}
              mobile={() => (
                <div className="dl-mobile-data-list mb-3">
                  {orderedBusinessHours.length === 0 ? (
                    <div className="text-muted small d-flex flex-wrap justify-content-between align-items-center gap-2">
                      <span>営業時間データがありません。</span>
                      {onRetryLoad && (
                        <AppButton size="sm" variant="outline-secondary" onClick={onRetryLoad}>
                          再読み込み
                        </AppButton>
                      )}
                    </div>
                  ) : (
                    orderedBusinessHours.map((h) => (
                      <AppMobileDataCard
                        key={h.dayOfWeek}
                        title={DAY_NAMES[h.dayOfWeek]}
                        fields={hoursEditing ? [
                          {
                            label: '定休日',
                            value: (
                              <Form.Check
                                type="checkbox"
                                checked={h.isClosed}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => onClosedChange(h.dayOfWeek, e.target.checked)}
                                disabled={h.is24Hours}
                                aria-label={`${DAY_NAMES[h.dayOfWeek]} 定休日`}
                              />
                            ),
                          },
                          {
                            label: '24時間',
                            value: (
                              <Form.Check
                                type="checkbox"
                                checked={h.is24Hours}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => on24HoursChange(h.dayOfWeek, e.target.checked)}
                                disabled={h.isClosed}
                                aria-label={`${DAY_NAMES[h.dayOfWeek]} 24時間営業`}
                              />
                            ),
                          },
                          {
                            label: '開店時間',
                            value: (
                              <AppControl
                                type="time"
                                size="sm"
                                value={h.openTime || ''}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => onHoursChange(h.dayOfWeek, 'openTime', e.target.value)}
                                disabled={h.isClosed || h.is24Hours}
                                className="time-input"
                                aria-label={`${DAY_NAMES[h.dayOfWeek]} 開店時間`}
                              />
                            ),
                          },
                          {
                            label: '閉店時間',
                            value: (
                              <AppControl
                                type="time"
                                size="sm"
                                value={h.closeTime || ''}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => onHoursChange(h.dayOfWeek, 'closeTime', e.target.value)}
                                disabled={h.isClosed || h.is24Hours}
                                className="time-input"
                                aria-label={`${DAY_NAMES[h.dayOfWeek]} 閉店時間`}
                              />
                            ),
                          },
                        ] : [
                          { label: '営業時間', value: formatHours(h) },
                        ]}
                      />
                    ))
                  )}
                </div>
              )}
            />

            <hr className="my-3" />

            <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-2">
              <h6 className="mb-0">特例営業時間（祝日・大型連休・臨時休業）</h6>
              {hoursEditing && (
                <AppButton variant="outline-primary" size="sm" onClick={onAddSpecialHour}>
                  特例を追加
                </AppButton>
              )}
            </div>

            <AppResponsiveSwitch
              desktop={() => (
                <div className="table-responsive">
                  <AppTable size="sm" className="mb-3">
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
                        <tr key={entry.id ?? entry.clientId ?? `new-${index}`}>
                          <td className="align-middle">
                            {hoursEditing ? (
                              <AppSelect
                                size="sm"
                                value={entry.specialType}
                                ariaLabel={`特例営業時間 ${index + 1} 種別`}
                                onChange={(value) => onSpecialTypeChange(index, value as SpecialType)}
                                options={specialTypeOptions}
                              />
                            ) : (
                              SPECIAL_TYPE_LABELS[entry.specialType]
                            )}
                          </td>
                          <td className="align-middle">
                            {hoursEditing ? (
                              <div className="d-flex flex-column gap-1">
                                <AppControl
                                  type="date"
                                  size="sm"
                                  value={entry.startDate}
                                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => onSpecialDateChange(index, 'startDate', e.target.value)}
                                  aria-label={`特例営業時間 ${index + 1} 開始日`}
                                />
                                <AppControl
                                  type="date"
                                  size="sm"
                                  value={entry.endDate}
                                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => onSpecialDateChange(index, 'endDate', e.target.value)}
                                  aria-label={`特例営業時間 ${index + 1} 終了日`}
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
                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => onSpecialClosedChange(index, e.target.checked)}
                                    disabled={entry.is24Hours}
                                    aria-label={`特例営業時間 ${index + 1} 休業`}
                                  />
                                  <Form.Check
                                    type="checkbox"
                                    label="24時間"
                                    checked={entry.is24Hours}
                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => onSpecial24HoursChange(index, e.target.checked)}
                                    disabled={entry.isClosed}
                                    aria-label={`特例営業時間 ${index + 1} 24時間`}
                                  />
                                </div>
                                <div className="d-flex gap-2">
                                  <AppControl
                                    type="time"
                                    size="sm"
                                    value={entry.openTime || ''}
                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => onSpecialHoursChange(index, 'openTime', e.target.value)}
                                    disabled={entry.isClosed || entry.is24Hours}
                                    className="time-input"
                                    aria-label={`特例営業時間 ${index + 1} 開店時間`}
                                  />
                                  <AppControl
                                    type="time"
                                    size="sm"
                                    value={entry.closeTime || ''}
                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => onSpecialHoursChange(index, 'closeTime', e.target.value)}
                                    disabled={entry.isClosed || entry.is24Hours}
                                    className="time-input"
                                    aria-label={`特例営業時間 ${index + 1} 閉店時間`}
                                  />
                                </div>
                              </div>
                            )}
                          </td>
                          <td className="align-middle">
                            {hoursEditing ? (
                              <AppControl
                                size="sm"
                                placeholder="任意メモ"
                                value={entry.note || ''}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => onSpecialNoteChange(index, e.target.value)}
                                maxLength={200}
                                aria-label={`特例営業時間 ${index + 1} メモ`}
                              />
                            ) : (
                              <span className="small">{entry.note || '-'}</span>
                            )}
                          </td>
                          {hoursEditing && (
                            <td className="align-middle">
                              <AppButton
                                variant="outline-danger"
                                size="sm"
                                onClick={() => onRemoveSpecialHour(index)}
                              >
                                削除
                              </AppButton>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </AppTable>
                </div>
              )}
              mobile={() => (
                <div className="dl-mobile-data-list mb-3">
                  {specialHours.length === 0 ? (
                    <div className="text-muted small">特例営業時間は未登録です。</div>
                  ) : (
                    specialHours.map((entry, index) => (
                      <AppMobileDataCard
                        key={entry.id ?? entry.clientId ?? `new-mobile-${index}`}
                        title={`特例 ${index + 1}`}
                        subtitle={SPECIAL_TYPE_LABELS[entry.specialType]}
                        fields={[
                          {
                            label: '種別',
                            value: hoursEditing ? (
                              <AppSelect
                                size="sm"
                                value={entry.specialType}
                                ariaLabel={`特例営業時間 ${index + 1} 種別`}
                                onChange={(value) => onSpecialTypeChange(index, value as SpecialType)}
                                options={Object.entries(SPECIAL_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
                              />
                            ) : (
                              SPECIAL_TYPE_LABELS[entry.specialType]
                            ),
                          },
                          {
                            label: '期間',
                            value: hoursEditing ? (
                              <div className="d-flex flex-column gap-1">
                                <AppControl
                                  type="date"
                                  size="sm"
                                  value={entry.startDate}
                                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => onSpecialDateChange(index, 'startDate', e.target.value)}
                                  aria-label={`特例営業時間 ${index + 1} 開始日`}
                                />
                                <AppControl
                                  type="date"
                                  size="sm"
                                  value={entry.endDate}
                                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => onSpecialDateChange(index, 'endDate', e.target.value)}
                                  aria-label={`特例営業時間 ${index + 1} 終了日`}
                                />
                              </div>
                            ) : (
                              entry.startDate === entry.endDate
                                ? entry.startDate
                                : `${entry.startDate} 〜 ${entry.endDate}`
                            ),
                          },
                          {
                            label: '営業時間',
                            value: !hoursEditing ? (
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
                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => onSpecialClosedChange(index, e.target.checked)}
                                    disabled={entry.is24Hours}
                                    aria-label={`特例営業時間 ${index + 1} 休業`}
                                  />
                                  <Form.Check
                                    type="checkbox"
                                    label="24時間"
                                    checked={entry.is24Hours}
                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => onSpecial24HoursChange(index, e.target.checked)}
                                    disabled={entry.isClosed}
                                    aria-label={`特例営業時間 ${index + 1} 24時間`}
                                  />
                                </div>
                                <div className="d-flex gap-2">
                                  <AppControl
                                    type="time"
                                    size="sm"
                                    value={entry.openTime || ''}
                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => onSpecialHoursChange(index, 'openTime', e.target.value)}
                                    disabled={entry.isClosed || entry.is24Hours}
                                    className="time-input"
                                    aria-label={`特例営業時間 ${index + 1} 開店時間`}
                                  />
                                  <AppControl
                                    type="time"
                                    size="sm"
                                    value={entry.closeTime || ''}
                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => onSpecialHoursChange(index, 'closeTime', e.target.value)}
                                    disabled={entry.isClosed || entry.is24Hours}
                                    className="time-input"
                                    aria-label={`特例営業時間 ${index + 1} 閉店時間`}
                                  />
                                </div>
                              </div>
                            ),
                          },
                          {
                            label: 'メモ',
                            value: hoursEditing ? (
                              <AppControl
                                size="sm"
                                placeholder="任意メモ"
                                value={entry.note || ''}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => onSpecialNoteChange(index, e.target.value)}
                                maxLength={200}
                                aria-label={`特例営業時間 ${index + 1} メモ`}
                              />
                            ) : (
                              <span className="small">{entry.note || '-'}</span>
                            ),
                          },
                        ]}
                        actions={hoursEditing ? (
                          <AppButton
                            variant="outline-danger"
                            size="sm"
                            onClick={() => onRemoveSpecialHour(index)}
                          >
                            削除
                          </AppButton>
                        ) : undefined}
                      />
                    ))
                  )}
                </div>
              )}
            />

            {!hoursEditing ? (
              <AppButton variant="outline-primary" onClick={onHoursEditStart} disabled={!canEditHours}>
                営業時間を編集
              </AppButton>
            ) : (
              <div className="d-flex gap-2 flex-wrap mobile-stack">
                <LoadingButton
                  variant="primary"
                  onClick={onHoursSave}
                  loading={hoursSaving}
                  loadingLabel="保存中..."
                  disabled={!hoursEditable}
                >
                  営業時間を保存
                </LoadingButton>
                <AppButton variant="outline-secondary" onClick={onHoursEditCancel} disabled={hoursSaving}>
                  キャンセル
                </AppButton>
              </div>
            )}
          </>
        )}
    </AppDataPanel>
  );
}

export default memo(BusinessHoursSettings);
