import { memo } from 'react';
import { Form } from 'react-bootstrap';
import AppTable from '../ui/AppTable';
import AppButton from '../ui/AppButton';
import AppSelect from '../ui/AppSelect';
import AppControl from '../ui/AppControl';
import AppMobileDataCard from '../ui/AppMobileDataCard';
import AppResponsiveSwitch from '../ui/AppResponsiveSwitch';
import {
  SpecialHourEntry,
  SpecialType,
  SPECIAL_TYPE_LABELS,
  formatSpecialHours,
} from './types';

export interface SpecialHoursSectionProps {
  specialHours: SpecialHourEntry[];
  hoursEditing: boolean;
  specialTypeOptions: { value: string; label: string }[];
  onAddSpecialHour: () => void;
  onRemoveSpecialHour: (index: number) => void;
  onSpecialTypeChange: (index: number, specialType: SpecialType) => void;
  onSpecialDateChange: (index: number, field: 'startDate' | 'endDate', value: string) => void;
  onSpecialNoteChange: (index: number, value: string) => void;
  onSpecialHoursChange: (index: number, field: 'openTime' | 'closeTime', value: string) => void;
  onSpecialClosedChange: (index: number, isClosed: boolean) => void;
  onSpecial24HoursChange: (index: number, is24Hours: boolean) => void;
}

function SpecialHoursSection({
  specialHours,
  hoursEditing,
  specialTypeOptions,
  onAddSpecialHour,
  onRemoveSpecialHour,
  onSpecialTypeChange,
  onSpecialDateChange,
  onSpecialNoteChange,
  onSpecialHoursChange,
  onSpecialClosedChange,
  onSpecial24HoursChange,
}: SpecialHoursSectionProps) {
  return (
    <>
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
                          options={specialTypeOptions}
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
    </>
  );
}

export default memo(SpecialHoursSection);
