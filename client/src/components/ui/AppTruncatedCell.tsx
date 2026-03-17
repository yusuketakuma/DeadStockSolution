import { useRef, useState, useEffect } from 'react';
import { OverlayTrigger, Tooltip } from 'react-bootstrap';

interface AppTruncatedCellProps {
  text: string;
  maxWidth?: number | string;
  className?: string;
}

export default function AppTruncatedCell({
  text,
  maxWidth = 200,
  className,
}: AppTruncatedCellProps) {
  const textRef = useRef<HTMLSpanElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  useEffect(() => {
    const el = textRef.current;
    if (el) {
      setIsOverflowing(el.scrollWidth > el.clientWidth);
    }
  }, [text, maxWidth]);

  const style: React.CSSProperties = {
    display: 'block',
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
    maxWidth: typeof maxWidth === 'number' ? `${maxWidth}px` : maxWidth,
  };

  if (!isOverflowing) {
    return (
      <span ref={textRef} style={style} className={className}>
        {text}
      </span>
    );
  }

  return (
    <OverlayTrigger
      placement="top"
      overlay={<Tooltip>{text}</Tooltip>}
    >
      <span ref={textRef} style={style} className={className}>
        {text}
      </span>
    </OverlayTrigger>
  );
}
