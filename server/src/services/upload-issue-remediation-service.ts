import { eq } from 'drizzle-orm';
import { db } from '../config/database';
import { uploadIssueRemediations, uploadIssueRemediationHistory } from '../db/schema';

const DEFAULT_REMEDIATIONS: Record<string, { cause: string; fix: string; verify: string }> = {
  MISSING_EXPIRY: {
    cause: '使用期限列が空か、Excel 内で日付として解釈できていません。',
    fix: '対象行の使用期限を YYYY-MM-DD 形式または Excel の日付セルで埋めて再アップロードしてください。',
    verify: '再取込前に raw row を確認し、期限セルに値が入っていることを確認します。',
  },
  INVALID_PRICE: {
    cause: '薬価列に文字列や記号が含まれており、数値化に失敗しています。',
    fix: '薬価列を半角数字のみへ修正し、通貨記号やカンマを除去してください。',
    verify: 'CSV 出力した問題行で price 列が数値だけになっているか確認します。',
  },
};

export async function listUploadIssueRemediations() {
  try {
    const rows = await db.select()
      .from(uploadIssueRemediations);
    const merged = { ...DEFAULT_REMEDIATIONS };
    for (const row of rows) {
      merged[row.issueCode] = {
        cause: row.cause,
        fix: row.fix,
        verify: row.verify,
      };
    }
    return merged;
  } catch {
    return DEFAULT_REMEDIATIONS;
  }
}

export async function upsertUploadIssueRemediation(input: {
  issueCode: string;
  cause: string;
  fix: string;
  verify: string;
  updatedByAdminId?: number | null;
}) {
  const existing = await db.select({ id: uploadIssueRemediations.id })
    .from(uploadIssueRemediations)
    .where(eq(uploadIssueRemediations.issueCode, input.issueCode))
    .limit(1);

  if (existing.length > 0) {
    const [updated] = await db.update(uploadIssueRemediations)
      .set({
        cause: input.cause,
        fix: input.fix,
        verify: input.verify,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(uploadIssueRemediations.issueCode, input.issueCode))
      .returning();
    await db.insert(uploadIssueRemediationHistory).values({
      issueCode: input.issueCode,
      cause: input.cause,
      fix: input.fix,
      verify: input.verify,
      updatedByAdminId: input.updatedByAdminId ?? null,
    });
    return updated;
  }

  const [created] = await db.insert(uploadIssueRemediations)
    .values({
      issueCode: input.issueCode,
      cause: input.cause,
      fix: input.fix,
      verify: input.verify,
    })
    .returning();
  await db.insert(uploadIssueRemediationHistory).values({
    issueCode: input.issueCode,
    cause: input.cause,
    fix: input.fix,
    verify: input.verify,
    updatedByAdminId: input.updatedByAdminId ?? null,
  });
  return created;
}

export async function listUploadIssueRemediationHistory(issueCode: string) {
  return db.select()
    .from(uploadIssueRemediationHistory)
    .where(eq(uploadIssueRemediationHistory.issueCode, issueCode))
    .orderBy(uploadIssueRemediationHistory.createdAt);
}
