import { memo } from 'react';
import { Form } from 'react-bootstrap';
import AppTable from '../ui/AppTable';
import AppButton from '../ui/AppButton';
import AppControl from '../ui/AppControl';
import AppMobileDataCard from '../ui/AppMobileDataCard';
import AppResponsiveSwitch from '../ui/AppResponsiveSwitch';
import { BusinessHourEntry, DAY_NAMES, formatHours } from './types';

export interface RegularHoursSectionProps {
  orderedBusinessHours: BusinessHourEntry[];
  hoursEditing: boolean;
  onHoursChange: (dayOfWeek: number, field: 'openTime' | 'closeTime', value: string) => void;
  onClosedChange: (dayOfWeek: number, isClosed: boolean) => void;
  on24HoursChange: (dayOfWeek: number, is24Hours: boolean) => void;
  onRetryLoad?: () => void;
}

function RegularHoursSection({
  orderedBusinessHours,
  hoursEditing,
  onHoursChange,
  onClosedChange,
  on24HoursChange,
  onRetryLoad,
}: RegularHoursSectionProps) {
  return (
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
  );
}

export default memo(RegularHoursSection);
