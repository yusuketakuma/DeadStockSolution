import { desc, eq, and, SQL } from 'drizzle-orm';
import { db } from '../config/database';
import { pharmacyRelationshipTypeEnum, pharmacyRelationships, pharmacies } from '../db/schema';
import { rowCount } from '../utils/db-utils';

export interface RelationshipListParams {
  page: number;
  limit: number;
  offset: number;
  relationshipType?: string;
  pharmacyId?: number;
}

export async function listRelationships(params: RelationshipListParams) {
  const conditions: SQL[] = [];
  if (params.relationshipType) {
    conditions.push(eq(
      pharmacyRelationships.relationshipType,
      params.relationshipType as (typeof pharmacyRelationshipTypeEnum.enumValues)[number],
    ));
  }
  if (params.pharmacyId) {
    conditions.push(eq(pharmacyRelationships.pharmacyId, params.pharmacyId));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const sourcePharmacy = db.select({ id: pharmacies.id, name: pharmacies.name }).from(pharmacies).as('sp');
  const targetPharmacy = db.select({ id: pharmacies.id, name: pharmacies.name }).from(pharmacies).as('tp');

  const [data, [totalRow]] = await Promise.all([
    db.select({
      id: pharmacyRelationships.id,
      pharmacyId: pharmacyRelationships.pharmacyId,
      pharmacyName: sourcePharmacy.name,
      targetPharmacyId: pharmacyRelationships.targetPharmacyId,
      targetPharmacyName: targetPharmacy.name,
      relationshipType: pharmacyRelationships.relationshipType,
      createdAt: pharmacyRelationships.createdAt,
    })
      .from(pharmacyRelationships)
      .leftJoin(sourcePharmacy, eq(pharmacyRelationships.pharmacyId, sourcePharmacy.id))
      .leftJoin(targetPharmacy, eq(pharmacyRelationships.targetPharmacyId, targetPharmacy.id))
      .where(where)
      .orderBy(desc(pharmacyRelationships.createdAt))
      .limit(params.limit)
      .offset(params.offset),
    db.select({ count: rowCount }).from(pharmacyRelationships).where(where),
  ]);

  return { data, total: totalRow.count };
}
