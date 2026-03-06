import { memo, useMemo } from 'react';
import AppButton from '../ui/AppButton';
import AppAlert from '../ui/AppAlert';
import InlineLoader from '../ui/InlineLoader';
import LoadingButton from '../ui/LoadingButton';
import AppDataPanel from '../ui/AppDataPanel';
import RegularHoursSection from './RegularHoursSection';
import SpecialHoursSection from './SpecialHoursSection';
import {
  BusinessHourEntry,
  SPECIAL_TYPE_LABELS,
  SpecialHourEntry,
  SpecialType,
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
            <RegularHoursSection
              orderedBusinessHours={orderedBusinessHours}
              hoursEditing={hoursEditing}
              onHoursChange={onHoursChange}
              onClosedChange={onClosedChange}
              on24HoursChange={on24HoursChange}
              onRetryLoad={onRetryLoad}
            />

            <hr className="my-3" />

            <SpecialHoursSection
              specialHours={specialHours}
              hoursEditing={hoursEditing}
              specialTypeOptions={specialTypeOptions}
              onAddSpecialHour={onAddSpecialHour}
              onRemoveSpecialHour={onRemoveSpecialHour}
              onSpecialTypeChange={onSpecialTypeChange}
              onSpecialDateChange={onSpecialDateChange}
              onSpecialNoteChange={onSpecialNoteChange}
              onSpecialHoursChange={onSpecialHoursChange}
              onSpecialClosedChange={onSpecialClosedChange}
              onSpecial24HoursChange={onSpecial24HoursChange}
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
