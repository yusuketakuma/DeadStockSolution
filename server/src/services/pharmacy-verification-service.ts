export type VerificationStatus = 'unverified' | 'pending_verification' | 'verified' | 'rejected';

export function isVerified(status: VerificationStatus): boolean {
  return status === 'verified';
}

export function isPendingVerification(status: VerificationStatus): boolean {
  return status === 'pending_verification';
}

export function canLogin(status: VerificationStatus, isActive: boolean): boolean {
  if (!isActive) return false;
  // unverified = legacy accounts (pre-verification feature), allow login
  return status === 'verified' || status === 'unverified';
}
