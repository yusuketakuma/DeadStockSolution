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

interface SearchInputProps {
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  onSearch: (value: string) => void;
  suggestUrl: string;
  trailingIcon?: ReactNode;
  onSelectItem?: (item: DrugMasterSuggestion) => void;
  suggestObjectUrl?: string;
}

const DEBOUNCE_MS = 300;

export default function SearchInput({
  placeholder = '薬品名 メーカー名で検索（スペース区切りで絞り込み）',
  value,
  onChange,
  onSearch,
  suggestUrl,
  trailingIcon,
  onSelectItem,
  suggestObjectUrl,
}: SearchInputProps) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [objectSuggestions, setObjectSuggestions] = useState<DrugMasterSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const requestAbortRef = useRef<AbortController | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const isObjectMode = Boolean(suggestObjectUrl);
  const activeSuggestions = isObjectMode ? objectSuggestions : suggestions;

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    setSuggestions([]);
    setObjectSuggestions([]);
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
        if (isObjectMode && suggestObjectUrl) {
          const results = await api.get<DrugMasterSuggestion[]>(
            `${suggestObjectUrl}?q=${encodeURIComponent(value)}`,
            { signal: controller.signal },
          );
          if (!cancelled) {
            setObjectSuggestions(results);
            setShowSuggestions(results.length > 0);
            setSelectedIndex(-1);
          }
        } else {
          const results = await api.get<string[]>(
            `${suggestUrl}?q=${encodeURIComponent(value)}`,
            { signal: controller.signal },
          );
          if (!cancelled) {
            setSuggestions(results);
            setShowSuggestions(results.length > 0);
            setSelectedIndex(-1);
          }
        }
      } catch {
        if (controller.signal.aborted) return;
        if (!cancelled) {
          setSuggestions([]);
          setObjectSuggestions([]);
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
  }, [value, suggestUrl, suggestObjectUrl, isObjectMode]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectStringSuggestion = (suggestion: string) => {
    onChange(suggestion);
    onSearch(suggestion);
    setShowSuggestions(false);
  };

  const selectObjectSuggestion = (item: DrugMasterSuggestion) => {
    onSelectItem?.(item);
    onChange('');
    setShowSuggestions(false);
    setObjectSuggestions([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions || activeSuggestions.length === 0) {
      if (e.key === 'Enter') {
        e.preventDefault();
        onSearch(value);
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, activeSuggestions.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, -1));
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0) {
          if (isObjectMode) {
            selectObjectSuggestion(objectSuggestions[selectedIndex]);
          } else {
            selectStringSuggestion(suggestions[selectedIndex]);
          }
        } else {
          onSearch(value);
          setShowSuggestions(false);
        }
        break;
      case 'Escape':
        setShowSuggestions(false);
        break;
    }
  };

  const isExpanded = showSuggestions && activeSuggestions.length > 0;

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <AppControl
        placeholder={placeholder}
        value={value}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          if (activeSuggestions.length > 0) setShowSuggestions(true);
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
          {isObjectMode
            ? objectSuggestions.map((item, idx) => (
                <ListGroup.Item
                  key={`${idx}-${item.id}`}
                  id={`${listboxId}-${idx}`}
                  action
                  active={idx === selectedIndex}
                  onClick={() => selectObjectSuggestion(item)}
                  role="option"
                  aria-selected={idx === selectedIndex}
                  style={{ cursor: 'pointer', fontSize: '0.9rem' }}
                >
                  {item.drugName}
                </ListGroup.Item>
              ))
            : suggestions.map((s, idx) => (
                <ListGroup.Item
                  key={`${idx}-${s}`}
                  id={`${listboxId}-${idx}`}
                  action
                  active={idx === selectedIndex}
                  onClick={() => selectStringSuggestion(s)}
                  role="option"
                  aria-selected={idx === selectedIndex}
                  style={{ cursor: 'pointer', fontSize: '0.9rem' }}
                >
                  {s}
                </ListGroup.Item>
              ))}
        </ListGroup>
      )}
    </div>
  );
}
