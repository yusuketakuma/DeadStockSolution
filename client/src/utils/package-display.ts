export interface PackageDisplayItem {
  quantity: number | null | undefined;
  unit?: string | null;
  packageLabel?: string | null;
  packageQuantity?: number | null;
  packageUnit?: string | null;
  packageForm?: string | null;
  isLoosePackage?: boolean | null;
  boxCount?: number | null;
}

export interface PackageDisplaySummary {
  boxCount: number | null;
  boxCountLabel: string;
  packageSizeLabel: string;
  totalQuantityLabel: string;
  packageLabel: string;
  isLoosePackage: boolean;
}

export function formatPackageNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

export function isLoosePackage(item: PackageDisplayItem): boolean {
  return item.isLoosePackage === true || item.packageForm === 'loose';
}

export function resolvePackageQuantity(item: PackageDisplayItem): number | null {
  const packageQuantity = Number(item.packageQuantity);
  return Number.isFinite(packageQuantity) && packageQuantity > 0 ? packageQuantity : null;
}

export function resolvePackageBoxCount(item: PackageDisplayItem): number | null {
  if (isLoosePackage(item)) return null;
  const packageQuantity = resolvePackageQuantity(item);
  if (!packageQuantity) {
    if (Number.isInteger(item.boxCount) && Number(item.boxCount) > 0) {
      return Number(item.boxCount);
    }
    return null;
  }
  if (item.quantity === null || item.quantity === undefined) return null;
  const boxCount = Math.floor(Number(item.quantity) / packageQuantity);
  return boxCount > 0 ? boxCount : null;
}

export function formatPackageSize(item: PackageDisplayItem): string {
  if (isLoosePackage(item)) return '対象外';
  const packageQuantity = resolvePackageQuantity(item);
  if (!packageQuantity) return '-';
  return `${formatPackageNumber(packageQuantity)}${item.packageUnit || item.unit || ''}`;
}

export function formatBoxCount(item: PackageDisplayItem): string {
  if (isLoosePackage(item)) return '対象外';
  return resolvePackageBoxCount(item)?.toString() ?? '-';
}

export function formatTotalQuantity(item: PackageDisplayItem): string {
  return `${formatPackageNumber(item.quantity)}${item.unit || item.packageUnit || ''}`;
}

export function summarizePackageDisplay(item: PackageDisplayItem): PackageDisplaySummary {
  return {
    boxCount: resolvePackageBoxCount(item),
    boxCountLabel: formatBoxCount(item),
    packageSizeLabel: formatPackageSize(item),
    totalQuantityLabel: formatTotalQuantity(item),
    packageLabel: item.packageLabel || '-',
    isLoosePackage: isLoosePackage(item),
  };
}

export function formatPackageSummary(item: PackageDisplayItem): string {
  const summary = summarizePackageDisplay(item);
  return [
    `総数量 ${summary.totalQuantityLabel}`,
    `箱数 ${summary.boxCountLabel}${summary.boxCount !== null ? '箱' : ''}`,
    `1箱入数 ${summary.packageSizeLabel}`,
    `包装 ${summary.packageLabel}`,
  ].join(' / ');
}
