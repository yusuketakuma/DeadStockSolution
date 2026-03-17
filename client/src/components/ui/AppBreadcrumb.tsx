import { Breadcrumb } from 'react-bootstrap';
import { Link, useLocation } from 'react-router-dom';
import { ROUTE_META } from '../../routes/route-config';

interface BreadcrumbItem {
  path: string;
  title: string;
}

/**
 * pathPattern に対して実際の location.pathname がマッチするか判定する。
 * 動的セグメント (:id など) はワイルドカードとして扱う。
 */
function matchesPattern(pattern: string, pathname: string): boolean {
  const patternSegments = pattern.split('/');
  const pathSegments = pathname.split('/');

  if (patternSegments.length !== pathSegments.length) return false;

  return patternSegments.every((seg, i) =>
    seg.startsWith(':') || seg === pathSegments[i]
  );
}

/**
 * パスに対応する ROUTE_META エントリを返す。
 * 動的ルートにも対応。
 */
function findRouteMeta(pathname: string) {
  return ROUTE_META.find((r) => matchesPattern(r.path, pathname));
}

/**
 * ROUTE_META を parent チェーンで辿り、パンくずアイテム配列を返す。
 * 先頭がルート（ホーム）、末尾が現在ページ。
 */
function buildBreadcrumbChain(pathname: string): BreadcrumbItem[] {
  const current = findRouteMeta(pathname);
  if (!current || !current.title) return [];

  const chain: BreadcrumbItem[] = [];
  let route: typeof current | undefined = current;

  // 循環参照防止
  const visited = new Set<string>();

  while (route) {
    if (visited.has(route.path)) break;
    visited.add(route.path);

    chain.unshift({ path: route.path, title: route.title ?? route.path });

    if (!route.parent) break;

    // parent パスに対応するルートを探す
    const parentRoute = ROUTE_META.find((r) => r.path === route!.parent);
    if (parentRoute) {
      route = parentRoute;
    } else {
      // ROUTE_META に存在しない親（例: /inventory）はラベルを推定して追加
      const inferredTitle = inferTitleFromPath(route.parent);
      chain.unshift({ path: route.parent, title: inferredTitle });
      break;
    }
  }

  return chain;
}

/**
 * パス文字列からヒューリスティックでラベルを生成する。
 * ROUTE_META に登録されていない仮想的な親パス向け。
 */
function inferTitleFromPath(path: string): string {
  const staticLabels: Record<string, string> = {
    '/inventory': '在庫管理',
    '/admin': '管理者',
  };
  if (staticLabels[path]) return staticLabels[path];

  const segment = path.split('/').filter(Boolean).pop() ?? path;
  return segment.charAt(0).toUpperCase() + segment.slice(1);
}

export default function AppBreadcrumb() {
  const { pathname } = useLocation();

  // ホーム（ダッシュボード）ではパンくずを表示しない
  if (pathname === '/') return null;

  const chain = buildBreadcrumbChain(pathname);

  // チェーンが空 or 1要素（= 現在地のみ）の場合はホームを先頭に追加して表示
  // チェーンが空の場合はそもそも表示しない
  if (chain.length === 0) return null;

  const items: BreadcrumbItem[] = [
    { path: '/', title: 'ホーム' },
    ...chain,
  ];

  return (
    <Breadcrumb className="app-breadcrumb px-3 py-2 mb-0" aria-label="パンくずナビゲーション">
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        return (
          <Breadcrumb.Item
            key={item.path}
            active={isLast}
            linkAs={isLast ? undefined : Link}
            linkProps={isLast ? undefined : { to: item.path }}
          >
            {item.title}
          </Breadcrumb.Item>
        );
      })}
    </Breadcrumb>
  );
}
