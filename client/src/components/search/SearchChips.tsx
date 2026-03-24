import { Alert, Badge } from 'react-bootstrap';

interface SearchChipsProps {
  tokens: string[];
  onRemove: (token: string) => void;
  maxTokenWarning?: boolean;
}

export default function SearchChips({ tokens, onRemove, maxTokenWarning }: SearchChipsProps) {
  if (tokens.length === 0) return null;

  return (
    <>
      {maxTokenWarning && (
        <Alert variant="warning" className="py-1 px-2 mb-1 small">
          最大5キーワードまで検索できます
        </Alert>
      )}
      <div className="d-flex flex-wrap gap-1">
        {tokens.map((token) => (
          <Badge key={token} bg="secondary" className="d-flex align-items-center gap-1">
            {token}
            <button
              type="button"
              className="btn-close btn-close-white ms-1"
              style={{ fontSize: '0.5rem' }}
              aria-label={`${token}を削除`}
              onClick={() => onRemove(token)}
            />
          </Badge>
        ))}
      </div>
    </>
  );
}
