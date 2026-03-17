import { pgTable, serial, text, integer, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import {
  groupMemberRoleEnum,
  pharmacyGroupVisibilityEnum,
} from './schema-common';
import { pharmacies } from './schema-pharmacy';

export const pharmacyGroups = pgTable('pharmacy_groups', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  visibility: pharmacyGroupVisibilityEnum('visibility').notNull().default('invite_only'),
  ownerPharmacyId: integer('owner_pharmacy_id').notNull().references(() => pharmacies.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
}, (table) => ([
  index('idx_pharmacy_groups_owner').on(table.ownerPharmacyId),
  index('idx_pharmacy_groups_visibility').on(table.visibility),
]));

export const groupMembers = pgTable('group_members', {
  id: serial('id').primaryKey(),
  groupId: integer('group_id').notNull().references(() => pharmacyGroups.id, { onDelete: 'cascade' }),
  pharmacyId: integer('pharmacy_id').notNull().references(() => pharmacies.id, { onDelete: 'cascade' }),
  role: groupMemberRoleEnum('role').notNull().default('member'),
  joinedAt: timestamp('joined_at', { mode: 'string' }).defaultNow(),
}, (table) => ([
  uniqueIndex('idx_group_members_unique').on(table.groupId, table.pharmacyId),
  index('idx_group_members_group').on(table.groupId),
  index('idx_group_members_pharmacy').on(table.pharmacyId),
]));
