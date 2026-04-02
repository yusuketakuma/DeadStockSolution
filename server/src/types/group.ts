// ── グループ関連の型定義 ──────────────────────────────────

/**
 * グループの公開設定
 */
export type GroupVisibility = 'public' | 'invite_only';

/**
 * グループメンバーのロール
 */
export type GroupMemberRole = 'owner' | 'admin' | 'member';

/**
 * グループ招待のステータス
 */
export type GroupInvitationStatus = 'pending' | 'accepted' | 'rejected';

/**
 * グループの基本情報
 */
export interface PharmacyGroup {
  id: number;
  name: string;
  description: string | null;
  visibility: GroupVisibility;
  ownerPharmacyId: number;
  hasPendingInvitation?: boolean;
  createdAt: string; // ISO string
  updatedAt: string; // ISO string
}

/**
 * グループメンバー情報
 */
export interface GroupMember {
  id: number;
  groupId: number;
  pharmacyId: number;
  role: GroupMemberRole;
  joinedAt: string; // ISO string
}

/**
 * グループ招待情報
 */
export interface GroupInvitation {
  id: number;
  groupId: number;
  pharmacyId: number; // 招待される薬局
  invitedByPharmacyId: number; // 招待した薬局
  status: GroupInvitationStatus;
  createdAt: string; // ISO string
}

/**
 * グループ作成リクエスト
 */
export interface GroupCreateRequest {
  name: string;
  description?: string;
  visibility: GroupVisibility;
}

/**
 * グループ更新リクエスト
 */
export type GroupUpdateRequest = Partial<Pick<GroupCreateRequest, 'name' | 'description' | 'visibility'>>;

/**
 * グループ一覧レスポンス
 */
export interface GroupListResponse {
  groups: PharmacyGroup[];
  total: number;
  offset: number;
  limit: number;
  pagination?: {
    mode: 'cursor' | 'offset';
    hasMore: boolean;
    nextCursor: string | null;
  };
}

export interface GroupMembershipSummaryItem {
  id: number;
  name: string;
  memberPharmacyIds: number[];
}

export interface GroupMembershipSummaryResponse {
  groups: GroupMembershipSummaryItem[];
  groupPharmacyIds: number[];
}

/**
 * グループ詳細レスポンス
 */
export interface GroupDetailResponse extends PharmacyGroup {
  members: GroupMember[];
  memberCount: number;
}

/**
 * グループメンバー追加リクエスト
 */
export interface GroupMemberAddRequest {
  pharmacyId: number;
  role?: GroupMemberRole;
}

/**
 * グループメンバー更新リクエスト
 */
export interface GroupMemberUpdateRequest {
  role: GroupMemberRole;
}

/**
 * グループ招待作成リクエスト
 */
export interface GroupInvitationCreateRequest {
  pharmacyId: number;
}

/**
 * グループ招待応答リクエスト
 */
export interface GroupInvitationResponseRequest {
  status: 'accepted' | 'rejected';
}

/**
 * グループ招待一覧レスポンス
 */
export interface GroupInvitationListResponse {
  invitations: GroupInvitation[];
  total: number;
  offset: number;
  limit: number;
}
