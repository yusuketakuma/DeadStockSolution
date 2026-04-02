import { Col, Row } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import AppDataPanel from '../../../components/ui/AppDataPanel';

export interface AdminNavigationLinkItem {
  to: string;
  label: string;
  className?: string;
}

export interface AdminNavigationLinkGroup {
  title: string;
  description?: string;
  links: readonly AdminNavigationLinkItem[];
}

interface Props {
  groups: readonly AdminNavigationLinkGroup[];
  title?: string;
  className?: string;
}

export default function AdminNavigationLinks({
  groups,
  title = '関連画面',
  className = 'mb-3',
}: Props) {
  if (groups.length === 0) {
    return null;
  }

  return (
    <AppDataPanel title={title} className={className}>
      <Row className="g-3">
        {groups.map((group) => (
          <Col key={group.title} md={6} xl={groups.length >= 3 ? 4 : 6}>
            <div className="border rounded-3 p-3 h-100">
              <div className="fw-semibold mb-1">{group.title}</div>
              {group.description ? (
                <div className="small text-muted mb-2">{group.description}</div>
              ) : null}
              <div className="d-flex gap-2 flex-wrap">
                {group.links.map((link) => (
                  <Link
                    key={link.to}
                    to={link.to}
                    className={link.className ?? 'btn btn-outline-secondary btn-sm py-0'}
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            </div>
          </Col>
        ))}
      </Row>
    </AppDataPanel>
  );
}
