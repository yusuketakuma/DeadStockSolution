import { Col, Row } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import AppDataPanel from '../ui/AppDataPanel';
import AppDropdownMenu from '../ui/AppDropdownMenu';

export interface ProposalNavigationLinkItem {
  to: string;
  label: string;
  className?: string;
}

export interface ProposalNavigationLinkGroup {
  title: string;
  description?: string;
  links: readonly ProposalNavigationLinkItem[];
}

interface Props {
  groups: readonly ProposalNavigationLinkGroup[];
  title?: string;
  className?: string;
}

export default function ProposalNavigationLinks({
  groups,
  title = '次に見る画面',
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
              {group.description ? <div className="small text-muted mb-2">{group.description}</div> : null}
              <div className="dl-action-row mobile-stack">
                {group.links.slice(0, 1).map((link) => (
                  <Link
                    key={link.to}
                    to={link.to}
                    className={link.className ?? 'btn btn-primary btn-sm'}
                  >
                    {link.label}
                  </Link>
                ))}
                {group.links.length > 1 && (
                  <AppDropdownMenu
                    label="関連画面"
                    variant="outline-secondary"
                    items={group.links.slice(1).map((link) => ({
                      key: link.to,
                      to: link.to,
                      label: link.label,
                    }))}
                  />
                )}
              </div>
            </div>
          </Col>
        ))}
      </Row>
    </AppDataPanel>
  );
}
