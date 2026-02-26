import { FormEvent } from 'react';
import AppButton from '../../../components/ui/AppButton';
import { Row, Col, Form, InputGroup } from 'react-bootstrap';
import AppCard from '../../../components/ui/AppCard';
import AppSelect from '../../../components/ui/AppSelect';
import AppControl from '../../../components/ui/AppControl';

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
    <AppCard className="mb-3">
      <AppCard.Body>
        <Row className="g-2 align-items-end">
          <Col md={5}>
            <Form onSubmit={onSearch}>
              <InputGroup size="sm">
                <AppControl
                  placeholder="品名・成分名・YJコードで検索"
                  value={searchInput}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => onSearchInputChange(e.target.value)}
                />
                <AppButton type="submit" variant="outline-primary">検索</AppButton>
              </InputGroup>
            </Form>
          </Col>
          <Col md={3}>
            <AppSelect
              size="sm"
              value={statusFilter}
              ariaLabel="ステータスで絞り込み"
              onChange={onStatusFilterChange}
              options={[
                { value: '', label: '全ステータス' },
                { value: 'listed', label: '収載中' },
                { value: 'transition', label: '経過措置中' },
                { value: 'delisted', label: '削除済' },
              ]}
            />
          </Col>
          <Col md={3}>
            <AppSelect
              size="sm"
              value={categoryFilter}
              ariaLabel="区分で絞り込み"
              onChange={onCategoryFilterChange}
              options={[
                { value: '', label: '全区分' },
                ...CATEGORY_OPTIONS.map((c) => ({ value: c, label: c })),
              ]}
            />
          </Col>
          <Col md={1} className="text-end">
            <span className="small text-muted">{total.toLocaleString()}件</span>
          </Col>
        </Row>
      </AppCard.Body>
    </AppCard>
  );
}
