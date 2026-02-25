import { FormEvent } from 'react';
import { Alert, Button, Form, Modal } from 'react-bootstrap';

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
  return (
    <Modal show={show} onHide={onHide} centered>
      <Modal.Header closeButton>
        <Modal.Title>要望をあげる</Modal.Title>
      </Modal.Header>
      <Form onSubmit={onSubmit}>
        <Modal.Body>
          {requestError && <Alert variant="danger">{requestError}</Alert>}
          <Form.Group controlId="request-message">
            <Form.Label>要望内容</Form.Label>
            <Form.Control
              as="textarea"
              rows={5}
              maxLength={2000}
              value={requestText}
              onChange={(event) => onTextChange(event.target.value)}
              placeholder="改善してほしい点、困っていることを入力してください"
              required
            />
            <Form.Text className="text-muted">
              {requestText.length}/2000 文字
            </Form.Text>
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" type="button" onClick={onHide} disabled={requestSubmitting}>
            閉じる
          </Button>
          <Button variant="primary" type="submit" disabled={requestSubmitting}>
            {requestSubmitting ? '送信中...' : '送信する'}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}
