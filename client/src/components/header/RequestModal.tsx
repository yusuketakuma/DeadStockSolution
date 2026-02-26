import { FormEvent, useId } from 'react';
import AppButton from '../ui/AppButton';
import AppAlert from '../ui/AppAlert';
import { Form } from 'react-bootstrap';
import LoadingButton from '../ui/LoadingButton';
import AppModalShell from '../ui/AppModalShell';
import AppField from '../ui/AppField';

interface RequestModalProps {
  show: boolean;
  requestText: string;
  requestError: string;
  requestSubmitting: boolean;
  onHide: () => void;
  onTextChange: (text: string) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
}

export default function RequestModal({
  show,
  requestText,
  requestError,
  requestSubmitting,
  onHide,
  onTextChange,
  onSubmit,
}: RequestModalProps) {
  const formId = `request-modal-form-${useId().replace(/:/g, '')}`;

  const footer = (
    <>
      <AppButton variant="secondary" type="button" onClick={onHide} disabled={requestSubmitting}>
        閉じる
      </AppButton>
      <LoadingButton
        variant="primary"
        type="submit"
        form={formId}
        loading={requestSubmitting}
        loadingLabel="送信中..."
      >
        送信する
      </LoadingButton>
    </>
  );

  return (
    <AppModalShell show={show} onHide={onHide} title="要望をあげる" footer={footer}>
      <Form id={formId} onSubmit={onSubmit}>
        {requestError && <AppAlert variant="danger">{requestError}</AppAlert>}
        <AppField
          controlId="request-message"
          label="要望内容"
          as="textarea"
          rows={5}
          maxLength={2000}
          value={requestText}
          onChange={(value) => onTextChange(value)}
          placeholder="改善してほしい点、困っていることを入力してください"
          required
          helpText={`${requestText.length}/2000 文字`}
        />
      </Form>
    </AppModalShell>
  );
}
