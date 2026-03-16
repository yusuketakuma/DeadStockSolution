import { desc, eq } from 'drizzle-orm';
import { db } from '../config/database';
import { openclawCommandWhitelist } from '../db/schema';

export interface CreateOpenClawCommandInput {
  commandName: string;
  category: string;
  descriptionJa?: string;
  isEnabled?: boolean;
  parametersSchema?: string;
}

export interface UpdateOpenClawCommandInput {
  commandName?: string;
  category?: string;
  descriptionJa?: string | null;
  isEnabled?: boolean;
  parametersSchema?: string | null;
}

export async function listOpenClawCommands(options: { limit?: number; offset?: number } = {}) {
  return db.select()
    .from(openclawCommandWhitelist)
    .orderBy(desc(openclawCommandWhitelist.createdAt))
    .limit(options.limit ?? 100)
    .offset(options.offset ?? 0);
}

export async function getOpenClawCommandById(id: number) {
  const [row] = await db.select()
    .from(openclawCommandWhitelist)
    .where(eq(openclawCommandWhitelist.id, id))
    .limit(1);
  return row ?? null;
}

export async function createOpenClawCommand(input: CreateOpenClawCommandInput) {
  const now = new Date().toISOString();
  const [row] = await db.insert(openclawCommandWhitelist).values({
    commandName: input.commandName,
    category: input.category,
    descriptionJa: input.descriptionJa ?? null,
    isEnabled: input.isEnabled ?? true,
    parametersSchema: input.parametersSchema ?? null,
    createdAt: now,
    updatedAt: now,
  }).returning();
  return row;
}

export async function updateOpenClawCommand(id: number, input: UpdateOpenClawCommandInput) {
  const now = new Date().toISOString();
  const [row] = await db.update(openclawCommandWhitelist)
    .set({ ...input, updatedAt: now })
    .where(eq(openclawCommandWhitelist.id, id))
    .returning();
  return row ?? null;
}

export async function deleteOpenClawCommand(id: number): Promise<boolean> {
  const result = await db.delete(openclawCommandWhitelist)
    .where(eq(openclawCommandWhitelist.id, id));
  return (result.rowCount ?? 0) > 0;
}
