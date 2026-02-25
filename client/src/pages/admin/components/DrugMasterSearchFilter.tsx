import { FormEvent } from 'react';
import { Card, Row, Col, Form, Button, InputGroup } from 'react-bootstrap';

const CATEGORY_OPTIONS = ['内用薬', '外用薬', '注射薬', '歯科用薬剤'];

interface DrugMasterSearchFilterProps {
  searchInput: string;
  statusFilter: string;
  categoryFilter: string;
  total: number;
  onSearchInputChange: (value: string) => void;
  onSearch: (e: FormEvent) => void;
  onStatusFilterChange: (value: string) => void;
  onCategoryFilterChange: (value: string) => void;
}

export default function DrugMasterSearchFilter({
  searchInput,
  statusFilter,
  categoryFilter,
  total,
  onSearchInputChange,
  onSearch,
  onStatusFilterChange,
  onCategoryFilterChange,
}: DrugMasterSearchFilterProps) {
  return (
    <Card className="mb-3">
      <Card.Body>
        <Row className="g-2 align-items-end">
          <Col md={5}>
            <Form onSubmit={onSearch}>
              <InputGroup size="sm">
                <Form.Control
                  placeholder="品名・成分名・YJコードで検索"
                  value={searchInput}
                  onChange={(e) => onSearchInputChange(e.target.value)}
                />
                <Button type="submit" variant="outline-primary">検索</Button>
              </InputGroup>
            </Form>
          </Col>
          <Col md={3}>
            <Form.Select size="sm" value={statusFilter} onChange={(e) => onStatusFilterChange(e.target.value)}>
              <option value="">全ステータス</option>
              <option value="listed">収載中</option>
              <option value="transition">経過措置中</option>
              <option value="delisted">削除済</option>
            </Form.Select>
          </Col>
          <Col md={3}>
            <Form.Select size="sm" value={categoryFilter} onChange={(e) => onCategoryFilterChange(e.target.value)}>
              <option value="">全区分</option>
              {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
            </Form.Select>
          </Col>
          <Col md={1} className="text-end">
            <span className="small text-muted">{total.toLocaleString()}件</span>
          </Col>
        </Row>
      </Card.Body>
    </Card>
  );
}
