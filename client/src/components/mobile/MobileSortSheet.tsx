import BaseBottomSheet from './BaseBottomSheet';

export interface SortOption<T extends string = string> {
  value: T;
  label: string;
}

export interface MobileSortSheetProps<T extends string = string> {
  isOpen: boolean;
  onClose: () => void;
  options: SortOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

export default function MobileSortSheet<T extends string = string>({
  isOpen,
  onClose,
  options,
  value,
  onChange,
}: MobileSortSheetProps<T>) {
  const handleSelect = (optionValue: T) => {
    onChange(optionValue);
    onClose();
  };

  return (
    <BaseBottomSheet isOpen={isOpen} onClose={onClose} title="並び替え">
      <div role="listbox" aria-label="並び替えオプション">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={selected}
              className="d-flex align-items-center justify-content-between w-100 border-0 bg-transparent px-3"
              style={{ minHeight: 48, cursor: 'pointer' }}
              onClick={() => handleSelect(option.value)}
            >
              <span className={selected ? 'fw-semibold' : ''}>{option.label}</span>
              {selected && (
                <span className="text-primary fw-bold" aria-hidden="true">
                  &#10003;
                </span>
              )}
            </button>
          );
        })}
      </div>
    </BaseBottomSheet>
  );
}
