export interface DrugMasterItem {
  id: number;
  yjCode: string;
  drugName: string;
  genericName: string | null;
  specification: string | null;
  unit: string | null;
  yakkaPrice: number;
  manufacturer: string | null;
  category: string | null;
  isListed: boolean;
  transitionDeadline: string | null;
  updatedAt: string | null;
}

export interface PackageItem {
  id: number;
  gs1Code: string | null;
  janCode: string | null;
  hotCode: string | null;
  packageDescription: string | null;
  packageQuantity: number | null;
  packageUnit: string | null;
  normalizedPackageLabel?: string | null;
  packageForm?: string | null;
  isLoosePackage?: boolean;
}

export interface PriceHistoryItem {
  id: number;
  yjCode: string;
  previousPrice: number | null;
  newPrice: number | null;
  revisionDate: string;
  revisionType: string;
}

export interface DrugMasterDetail extends DrugMasterItem {
  therapeuticCategory: string | null;
  listedDate: string | null;
  deletedDate: string | null;
  packages: PackageItem[];
  priceHistory: PriceHistoryItem[];
}
