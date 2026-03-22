import { useState, useEffect, useRef, useId, type ReactNode } from 'react';
import { ListGroup } from 'react-bootstrap';
import { api } from '../api/client';
import AppControl from './ui/AppControl';

export interface DrugMasterSuggestion {
  id: number;
  drugName: string;
  genericName: string | null;
  specification: string | null;
  yakkaPrice: string;
  unit: string | null;
}

export interface SearchInputProps<T = string> {
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  onSearch?: (value: string) => void;
  suggestUrl: string;
  trailingIcon?: ReactNode;
  onSelect?: (item: T) => void;
  renderItem?: (item: T) => string;
  clearOnSelect?: boolean;
}

const DEBOUNCE_MS = 300;

export default function SearchInput<T = string>({
  placeholder = '薬品名 メーカー名で検索（スペース区切りで絞り込み）',
  value,
  onChange,
  onSearch,
  suggestUrl,
  trailingIcon,
  onSelect,
  renderItem,
  clearOnSelect = false,
}: SearchInputProps<T>) {
  const [suggestions, setSuggestions] = useState<T[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const requestAbortRef = useRef<AbortController | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    setSuggestions([]);
    setShowSuggestions(false);

    if (!value.trim()) {
      requestAbortRef.current?.abort();
      requestAbortRef.current = null;
      return;
    }

    let cancelled = false;

    debounceRef.current = setTimeout(async () => {
      requestAbortRef.current?.abort();
      const controller = new AbortController();
      requestAbortRef.current = controller;
      try {
        const results = await api.get<T[]>(
          `${suggestUrl}?q=${encodeURIComponent(value)}`,
          { signal: controller.signal },
        );
        if (!cancelled) {
          setSuggestions(results);
          setShowSuggestions(results.length > 0);
          setSelectedIndex(-1);
        }
      } catch {
        if (controller.signal.aborted) return;
        if (!cancelled) {
          setSuggestions([]);
        }
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      requestAbortRef.current?.abort();
      requestAbortRef.current = null;
    };
  }, [value, suggestUrl]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const getDisplayText = (item: T): string => {
    return renderItem ? renderItem(item) : String(item);
  };

  const handleSelect = (item: T) => {
    onSelect?.(item);
    if (clearOnSelect) {
      onChange('');
      setSuggestions([]);
    } else {
      const text = getDisplayText(item);
      onChange(text);
      onSearch?.(text);
    }
    setShowSuggestions(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions || suggestions.length === 0) {
      if (e.key === 'Enter') {
        e.preventDefault();
        onSearch?.(value);
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, suggestions.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, -1));
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0) {
          handleSelect(suggestions[selectedIndex]);
        } else {
          onSearch?.(value);
          setShowSuggestions(false);
        }
        break;
      case 'Escape':
        setShowSuggestions(false);
        break;
    }
  };

  useEffect(() => {
    if (selectedIndex >= 0) {
      document.getElementById(`${listboxId}-${selectedIndex}`)
        ?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex, listboxId]);

  const isExpanded = showSuggestions && suggestions.length > 0;

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <AppControl
        placeholder={placeholder}
        value={value}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          if (suggestions.length > 0) setShowSuggestions(true);
        }}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={isExpanded}
        aria-controls={isExpanded ? listboxId : undefined}
        aria-activedescendant={isExpanded && selectedIndex >= 0 ? `${listboxId}-${selectedIndex}` : undefined}
      />
      {trailingIcon}
      {isExpanded && (
        <ListGroup
          id={listboxId}
          role="listbox"
          aria-label="検索候補"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 1050,
            maxHeight: '240px',
            overflowY: 'auto',
            boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
          }}
        >
          {suggestions.map((item, idx) => (
            <ListGroup.Item
              key={idx}
              id={`${listboxId}-${idx}`}
              action
              active={idx === selectedIndex}
              onClick={() => handleSelect(item)}
              role="option"
              aria-selected={idx === selectedIndex}
              style={{ cursor: 'pointer', fontSize: '0.9rem' }}
            >
              {getDisplayText(item)}
            </ListGroup.Item>
          ))}
        </ListGroup>
      )}
    </div>
  );
}
