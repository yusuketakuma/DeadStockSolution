/**
 * フォームバリデーション失敗時、最初のエラーフィールドまでスクロールする。
 *
 * React Bootstrap の Form.Control は isInvalid=true のとき .is-invalid クラスを付与し、
 * aria-invalid="true" も設定される。どちらかが見つかれば scrollIntoView を呼び出す。
 *
 * @param container - 検索範囲を限定したい場合に指定（省略時は document 全体）
 */
export function scrollToFirstError(container: Document | Element = document): void {
  const element =
    container.querySelector<HTMLElement>('.is-invalid') ??
    container.querySelector<HTMLElement>('[aria-invalid="true"]');

  if (element) {
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    element.focus({ preventScroll: true });
  }
}
