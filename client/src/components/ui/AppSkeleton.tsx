import '../../styles/components/skeleton.css';

export type SkeletonVariant = 'text' | 'card' | 'table' | 'circle';

interface BaseProps {
  variant: SkeletonVariant;
  /** カスタム幅 (例: '100%', '120px') */
  width?: string | number;
  /** カスタム高さ (例: '80px', 40) */
  height?: string | number;
  className?: string;
  /** aria-label (スクリーンリーダー向け。省略時は非表示) */
  label?: string;
}

interface TextProps extends BaseProps {
  variant: 'text';
  /** テキスト行数 (デフォルト: 3) */
  lines?: number;
}

interface CardProps extends BaseProps {
  variant: 'card';
}

interface CircleProps extends BaseProps {
  variant: 'circle';
}

interface TableProps extends BaseProps {
  variant: 'table';
  /** テーブル行数 (デフォルト: 5) */
  rows?: number;
  /** テーブル列数 (デフォルト: 4) */
  cols?: number;
}

export type AppSkeletonProps = TextProps | CardProps | CircleProps | TableProps;

/** 数値を受け取り px 単位文字列に変換。文字列はそのまま返す。 */
function toCssValue(value: string | number): string {
  return typeof value === 'number' ? `${value}px` : value;
}

function buildStyle(
  width?: string | number,
  height?: string | number,
): React.CSSProperties | undefined {
  if (width == null && height == null) return undefined;
  return {
    ...(width != null ? { width: toCssValue(width) } : {}),
    ...(height != null ? { height: toCssValue(height) } : {}),
  };
}

/** テキストバリアント */
function TextSkeleton({ lines = 3, width, height, className, label }: TextProps) {
  return (
    <div
      role="status"
      aria-label={label ?? '読み込み中'}
      aria-busy="true"
      className={className}
    >
      <span className="visually-hidden">{label ?? '読み込み中'}</span>
      {Array.from({ length: lines }, (_, i) => (
        <span
          key={i}
          className="dl-skeleton dl-skeleton-text"
          style={buildStyle(
            i === lines - 1 ? (width ?? '70%') : width,
            height,
          )}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

/** カードバリアント */
function CardSkeleton({ width, height, className, label }: CardProps) {
  return (
    <div
      role="status"
      aria-label={label ?? '読み込み中'}
      aria-busy="true"
      className={['dl-skeleton-card', className].filter(Boolean).join(' ')}
      style={buildStyle(width, height)}
    >
      <span className="visually-hidden">{label ?? '読み込み中'}</span>
      <span className="dl-skeleton dl-skeleton-card-header" aria-hidden="true" />
      <span className="dl-skeleton dl-skeleton-card-body" aria-hidden="true" />
      <span className="dl-skeleton dl-skeleton-card-body" aria-hidden="true" />
      <span className="dl-skeleton dl-skeleton-card-body" aria-hidden="true" />
    </div>
  );
}

/** サークルバリアント */
function CircleSkeleton({ width = 40, height, className, label }: CircleProps) {
  const size = toCssValue(width);
  return (
    <span
      role="status"
      aria-label={label ?? '読み込み中'}
      aria-busy="true"
      className={['dl-skeleton dl-skeleton-circle', className].filter(Boolean).join(' ')}
      style={{ width: size, height: toCssValue(height ?? width) }}
      aria-hidden={label == null ? 'true' : undefined}
    >
      {label && <span className="visually-hidden">{label}</span>}
    </span>
  );
}

/** テーブルバリアント */
function TableSkeleton({ rows = 5, cols = 4, width, height, className, label }: TableProps) {
  return (
    <table
      role="status"
      aria-label={label ?? '読み込み中'}
      aria-busy="true"
      className={['dl-skeleton-table', className].filter(Boolean).join(' ')}
      style={buildStyle(width, height)}
    >
      <caption className="visually-hidden">{label ?? '読み込み中'}</caption>
      <thead>
        <tr>
          {Array.from({ length: cols }, (_, i) => (
            <th key={i} scope="col" aria-hidden="true">
              <span className="dl-skeleton dl-skeleton-th" />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: rows }, (_, rowIdx) => (
          <tr key={rowIdx} aria-hidden="true">
            {Array.from({ length: cols }, (_, colIdx) => (
              <td key={colIdx}>
                <span
                  className="dl-skeleton dl-skeleton-td-inner"
                  style={colIdx === 0 ? { width: '60%' } : undefined}
                />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * AppSkeleton — ローディング中のプレースホルダー UI。
 *
 * @example
 * // テキスト (3行)
 * <AppSkeleton variant="text" />
 *
 * // カード
 * <AppSkeleton variant="card" width="100%" height={120} />
 *
 * // テーブル (5行 × 4列)
 * <AppSkeleton variant="table" rows={5} cols={4} />
 *
 * // アバター
 * <AppSkeleton variant="circle" width={48} />
 */
export default function AppSkeleton(props: AppSkeletonProps) {
  switch (props.variant) {
    case 'text':
      return <TextSkeleton {...props} />;
    case 'card':
      return <CardSkeleton {...props} />;
    case 'circle':
      return <CircleSkeleton {...props} />;
    case 'table':
      return <TableSkeleton {...props} />;
  }
}
