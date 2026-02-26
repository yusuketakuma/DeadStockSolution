import { useEffect, useState, type ReactNode } from 'react';

export const APP_RESPONSIVE_MOBILE_QUERY = '(max-width: 991.98px)';

interface AppResponsiveSwitchProps {
  desktop: ReactNode | (() => ReactNode);
  mobile: ReactNode | (() => ReactNode);
  desktopClassName?: string;
  mobileClassName?: string;
}

function joinClassNames(base: string, extra?: string) {
  return extra ? `${base} ${extra}` : base;
}

function resolveContent(content: ReactNode | (() => ReactNode)) {
  return typeof content === 'function' ? content() : content;
}

export default function AppResponsiveSwitch({
  desktop,
  mobile,
  desktopClassName,
  mobileClassName,
}: AppResponsiveSwitchProps) {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia(APP_RESPONSIVE_MOBILE_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const mediaQuery = window.matchMedia(APP_RESPONSIVE_MOBILE_QUERY);
    setIsMobile(mediaQuery.matches);

    const onChange = (event: MediaQueryListEvent) => {
      setIsMobile(event.matches);
    };

    if (typeof mediaQuery.addEventListener === 'function' && typeof mediaQuery.removeEventListener === 'function') {
      mediaQuery.addEventListener('change', onChange);
      return () => mediaQuery.removeEventListener('change', onChange);
    }

    if (typeof mediaQuery.addListener === 'function' && typeof mediaQuery.removeListener === 'function') {
      mediaQuery.addListener(onChange);
      return () => mediaQuery.removeListener(onChange);
    }

    return;
  }, []);

  if (isMobile) {
    return <div className={joinClassNames('dl-mobile-only', mobileClassName)}>{resolveContent(mobile)}</div>;
  }

  return <div className={joinClassNames('dl-desktop-only', desktopClassName)}>{resolveContent(desktop)}</div>;
}
