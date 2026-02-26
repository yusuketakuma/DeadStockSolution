import AppScreen from './AppScreen';

interface PageLoaderProps {
  fullHeight?: boolean;
  minHeightClassName?: string;
  label?: string;
}

export default function PageLoader({
  fullHeight = false,
  minHeightClassName,
  label = '読み込み中...',
}: PageLoaderProps) {
  const wrapperClass = fullHeight ? 'dl-loader-wrap dl-loader-wrap-full' : 'dl-loader-wrap';
  const sizeClass = minHeightClassName ? `${wrapperClass} ${minHeightClassName}` : wrapperClass;

  return (
    <div className="app-theme">
      <AppScreen>
        <div className={sizeClass}>
          <div className="spinner-border text-primary" role="status" aria-live="polite" aria-label={label}>
            <span className="visually-hidden">{label}</span>
          </div>
        </div>
      </AppScreen>
    </div>
  );
}
