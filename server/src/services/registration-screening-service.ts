export interface RegistrationScreeningInput {
  pharmacyName: string;
  prefecture: string;
  address: string;
  licenseNumber: string;
  permitLicenseNumber: string;
  permitPharmacyName: string;
  permitAddress: string;
}

export interface RegistrationScreeningResult {
  approved: boolean;
  screeningScore: number;
  reasons: string[];
  mismatches: string[];
}

function normalizeLoose(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s\u3000\-ー－().,、。]/g, '');
}

function normalizeLicense(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[\s\u3000\-ー－]/g, '');
}

function normalizeAddress(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s\u3000\-ー－]/g, '');
}

function hasBidirectionalContainment(left: string, right: string, minimumLength: number): boolean {
  if (left.length < minimumLength || right.length < minimumLength) {
    return false;
  }
  return left.includes(right) || right.includes(left);
}

export function evaluateRegistrationScreening(input: RegistrationScreeningInput): RegistrationScreeningResult {
  const reasons: string[] = [];
  const mismatches: string[] = [];

  const registeredLicense = normalizeLicense(input.licenseNumber);
  const permitLicense = normalizeLicense(input.permitLicenseNumber);
  const registeredName = normalizeLoose(input.pharmacyName);
  const permitName = normalizeLoose(input.permitPharmacyName);
  const registeredAddress = normalizeAddress(`${input.prefecture}${input.address}`);
  const permitAddress = normalizeAddress(input.permitAddress);

  let score = 0;

  const licenseMatched = registeredLicense.length > 0
    && permitLicense.length > 0
    && registeredLicense === permitLicense;
  if (licenseMatched) {
    score += 50;
    reasons.push('許可番号が一致');
  } else {
    mismatches.push('薬局開設許可番号が一致しません');
  }

  const nameMatched = hasBidirectionalContainment(registeredName, permitName, 3);
  if (nameMatched) {
    score += 30;
    reasons.push('薬局名が一致');
  } else {
    mismatches.push('薬局名が許可証記載情報と一致しません');
  }

  const addressMatched = hasBidirectionalContainment(registeredAddress, permitAddress, 8);
  if (addressMatched) {
    score += 20;
    reasons.push('所在地が一致');
  } else {
    mismatches.push('所在地が許可証記載情報と一致しません');
  }

  const approved = licenseMatched && score >= 80;
  if (approved) {
    reasons.push('自動審査で登録可と判定');
  } else {
    reasons.push('自動審査で登録不可と判定');
  }

  return {
    approved,
    screeningScore: score,
    reasons,
    mismatches,
  };
}
