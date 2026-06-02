import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

interface AppDropdownItem {
  key?: string;
  label: string;
  onClick?: () => void;
  to?: string;
  state?: unknown;
  href?: string;
  target?: string;
  rel?: string;
  download?: boolean | string;
  disabled?: boolean;
  danger?: boolean;
}

interface AppDropdownMenuProps {
  label: string;
  variant?: string;
  size?: 'sm' | 'lg';
  items: AppDropdownItem[];
  align?: 'start' | 'end';
  className?: string;
  icon?: React.ReactNode;
}

export default function AppDropdownMenu({
  label,
  variant = 'outline-primary',
  size = 'sm',
  items,
  align = 'end',
  className = '',
  icon,
}: AppDropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
    };
  }, [open]);

  const handleItemClick = (item: AppDropdownItem) => {
    if (item.disabled) return;
    item.onClick?.();
    setOpen(false);
  };

  return (
    <div ref={menuRef} className={`dropdown ${className}`}>
      <button
        type="button"
        className={`btn btn-${variant}${size ? ` btn-${size}` : ''} dropdown-toggle dl-dropdown-toggle`}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {icon && <span className="me-1">{icon}</span>}
        {label}
      </button>
      {open && (
      <div className={`dropdown-menu dl-dropdown-menu show${align === 'end' ? ' dropdown-menu-end' : ''}`}>
        {items.map((item, index) => {
          const itemKey = item.key ?? item.to ?? item.href ?? `${item.label}-${index}`;
          const itemClassName = item.danger ? 'text-danger' : undefined;
          const classNames = itemClassName ? `dropdown-item ${itemClassName}` : 'dropdown-item';
          if (item.to) {
            return (
              <Link
                key={itemKey}
                to={item.to}
                state={item.state}
                target={item.target}
                rel={item.rel}
                className={item.disabled ? `${classNames} disabled` : classNames}
                aria-disabled={item.disabled || undefined}
                onClick={(event) => {
                  if (item.disabled) {
                    event.preventDefault();
                    return;
                  }
                  handleItemClick(item);
                }}
              >
                {item.label}
              </Link>
            );
          }
          if (item.href) {
            return (
              <a
                key={itemKey}
                href={item.disabled ? undefined : item.href}
                target={item.target}
                rel={item.rel}
                download={item.download}
                className={item.disabled ? `${classNames} disabled` : classNames}
                aria-disabled={item.disabled || undefined}
                onClick={(event) => {
                  if (item.disabled) {
                    event.preventDefault();
                    return;
                  }
                  handleItemClick(item);
                }}
              >
                {item.label}
              </a>
            );
          }
          return (
            <button
              type="button"
              key={itemKey}
              disabled={item.disabled}
              className={classNames}
              onClick={() => handleItemClick(item)}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      )}
    </div>
  );
}
