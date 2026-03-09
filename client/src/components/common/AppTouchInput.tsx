import { forwardRef, type ComponentProps, type ChangeEvent } from 'react';
import { Form } from 'react-bootstrap';

/**
 * モバイル最適化されたフォーム入力コンポーネント
 * - inputmode="decimal" で数値キーパッドを表示
 * - type="date" でネイティブ日付ピッカーを使用
 * - font-size: 16px 以上で iOS ズーム防止
 * - min-height: 44px でタップターゲット確保
 */
type AppTouchInputProps = Omit<ComponentProps<typeof Form.Control>, 'onChange'> & {
  inputMode?: 'decimal' | 'numeric' | 'text' | 'search' | 'email' | 'tel' | 'url';
  onChange?: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
};

const AppTouchInput = forwardRef<HTMLInputElement, AppTouchInputProps>(function AppTouchInput(
  { inputMode, className, style, ...props },
  ref
) {
  const touchStyles: React.CSSProperties = {
    fontSize: '16px', // iOS ズーム防止
    minHeight: '44px', // タップターゲット
    padding: '0 12px',
    ...style,
  };

  const combinedClassName = className ? `app-touch-input ${className}` : 'app-touch-input';

  return (
    <Form.Control
      ref={ref}
      type="text"
      inputMode={inputMode}
      className={combinedClassName}
      style={touchStyles}
      {...props}
    />
  );
});

export default AppTouchInput;
