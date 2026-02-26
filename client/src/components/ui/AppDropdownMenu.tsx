import { Dropdown } from 'react-bootstrap';
import type { ReactNode } from 'react';

export interface AppDropdownItem {
  key: string;
  label: string;
  onClick?: () => void;
  href?: string;
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
  icon?: ReactNode;
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
  return (
    <Dropdown align={align} className={className}>
      <Dropdown.Toggle variant={variant} size={size} className="dl-dropdown-toggle">
        {icon && <span className="me-1">{icon}</span>}
        {label}
      </Dropdown.Toggle>
      <Dropdown.Menu className="dl-dropdown-menu">
        {items.map((item) => (
          <Dropdown.Item
            key={item.key}
            onClick={item.onClick}
            href={item.href}
            disabled={item.disabled}
            className={item.danger ? 'text-danger' : undefined}
          >
            {item.label}
          </Dropdown.Item>
        ))}
      </Dropdown.Menu>
    </Dropdown>
  );
}
