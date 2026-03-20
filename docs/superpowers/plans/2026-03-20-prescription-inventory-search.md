# 処方せん在庫検索機能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 処方せんの複数薬剤を同時検索し、在庫がある薬局をマトリクス表示する機能を InventoryBrowsePage に実装する

**Architecture:** 新規サービス `prescription-search-service.ts` で genericName ベースの後発品自動集約・在庫照合・薬局スコアリングを行い、既存の InventoryBrowsePage をチップ形式入力 + サマリカード + マトリクス表に全面改修する

**Tech Stack:** Express 5, Drizzle ORM, Zod, React 18, React Bootstrap, Vitest, PGlite

**Spec:** `docs/superpowers/specs/2026-03-20-prescription-inventory-search-design.md`

---

## File Structure

### Backend (new)

| File | Responsibility |
|------|---------------|
| `server/src/services/prescription-search-service.ts` | 薬剤解決（genericName グルーピング + フォールバック）、在庫照合（二重パス）、フィルタ、スコア計算 |
| `server/src/test/prescription-search-service.test.ts` | ユニットテスト（グルーピング、フィルタ、ソート） |
| `server/src/test/integration/prescription-search-integration.test.ts` | PGlite 統合テスト（フォールバックチェーン、マルチグループ） |
| `server/src/test/inventory-prescription-search.test.ts` | ルートテスト（POST エンドポイント） |

### Backend (modify)

| File | Change |
|------|--------|
| `server/src/utils/validators.ts` | `prescriptionSearchSchema` 追加 |
| `server/src/routes/inventory.ts` | `POST /prescription-search` ハンドラー追加 |
| `server/src/routes/search.ts` | `/search/drug-master` レスポンスに `id`, `genericName` 追加 |

### Frontend (new)

| File | Responsibility |
|------|---------------|
| `client/src/components/inventory/PrescriptionSearchForm.tsx` | 検索フォーム（チップ入力 + フィルタ + バーコード + 検索ボタン） |
| `client/src/components/inventory/PharmacySummaryCards.tsx` | 薬局サマリカード（充足数、薬価、営業状態、提案ボタン） |
| `client/src/components/inventory/InventoryMatrix.tsx` | マトリクス表（スティッキーヘッダー/左列、横スクロール） |
| `client/src/components/inventory/InventoryMatrixCell.tsx` | セル（メーカー名・薬価・数量、在庫なし表示） |
| `client/src/hooks/usePrescriptionSearch.ts` | 処方せん検索カスタムフック（API 呼び出し、状態管理） |

### Frontend (modify)

| File | Change |
|------|--------|
| `client/src/pages/InventoryBrowsePage.tsx` | 全面改修（チップ形式 + マトリクス表示に統一） |
| `client/src/components/SearchInput.tsx` | `onSelect` コールバック追加（サジェスション選択でオブジェクト返却） |
| `client/src/api/client.ts` | `prescriptionSearch()` API メソッド追加 |

---

## Task 0: 事前確認（genericName 充填率）

**Files:**
- None (DB query only)

- [ ] **Step 1: genericName 充填率を確認**

```bash
cd server && npx tsx -e "
import { db } from './src/db/index.js';
import { drugMaster } from './src/db/schema-drug-master.js';
import { sql } from 'drizzle-orm';
const result = await db.select({
  total: sql<number>\`count(*)\`,
  withGenericName: sql<number>\`count(*) filter (where ${drugMaster.genericName} is not null)\`,
}).from(drugMaster);
const r = result[0];
console.log(\`Total: \${r.total}, With genericName: \${r.withGenericName}, Rate: \${(r.withGenericName / r.total * 100).toFixed(1)}%\`);
process.exit(0);
"
```

Expected: 充填率を確認。80%未満の場合は Task 0.5 でマイグレーション追加。

- [ ] **Step 2: deadStockItems.drugMasterId 充填率を確認**

```bash
cd server && npx tsx -e "
import { db } from './src/db/index.js';
import { deadStockItems } from './src/db/schema-inventory.js';
import { sql } from 'drizzle-orm';
const result = await db.select({
  total: sql<number>\`count(*)\`,
  withDrugMasterId: sql<number>\`count(*) filter (where ${deadStockItems.drugMasterId} is not null)\`,
}).from(deadStockItems);
const r = result[0];
console.log(\`Total: \${r.total}, With drugMasterId: \${r.withDrugMasterId}, Rate: \${(r.withDrugMasterId / r.total * 100).toFixed(1)}%\`);
process.exit(0);
"
```

Expected: 充填率を確認。結果に応じて補助パスの重要度を判断。

---

## Task 1: Zod バリデーションスキーマ追加

**Files:**
- Modify: `server/src/utils/validators.ts`
- Test: `server/src/test/routes/inventory-prescription-search.test.ts` (Task 4 で作成)

- [ ] **Step 1: prescriptionSearchSchema を定義**

`server/src/utils/validators.ts` の末尾に追加:

```typescript
export const prescriptionSearchDrugKeySchema = z.object({
  drugMasterId: z.number().int().positive(),
  genericName: z.string().max(200).nullable(),
  specification: z.string().max(100).nullable(),
});

export const prescriptionSearchSchema = z.object({
  drugKeys: z
    .array(prescriptionSearchDrugKeySchema)
    .min(1, '薬剤を1つ以上選択してください')
    .max(10, '薬剤は10品目まで検索できます'),
  filters: z.object({
    groupOnly: z.boolean().default(false),
    openOnly: z.boolean().default(false),
    favoritePriority: z.boolean().default(false),
  }).default({}),
  coordinates: z.object({
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),
  }).nullable().default(null),
});
```

- [ ] **Step 2: typecheck を実行**

```bash
cd server && npx tsc --noEmit
```

Expected: エラーなし

- [ ] **Step 3: コミット**

```bash
git add server/src/utils/validators.ts
git commit -m "feat: add prescriptionSearchSchema for multi-drug search validation"
```

---

## Task 2: /search/drug-master レスポンス拡張

**Files:**
- Modify: `server/src/routes/search.ts:67-73`

- [ ] **Step 1: select フィールドに id と genericName を追加**

`server/src/routes/search.ts` の `/search/drug-master` ハンドラー内の select を変更:

```typescript
// 変更前:
{
  yjCode: drugMaster.yjCode,
  drugName: drugMaster.drugName,
  yakkaPrice: drugMaster.yakkaPrice,
  unit: drugMaster.unit,
  specification: drugMaster.specification,
}

// 変更後:
{
  id: drugMaster.id,
  yjCode: drugMaster.yjCode,
  drugName: drugMaster.drugName,
  genericName: drugMaster.genericName,
  yakkaPrice: drugMaster.yakkaPrice,
  unit: drugMaster.unit,
  specification: drugMaster.specification,
}
```

- [ ] **Step 2: 既存テストが壊れないか確認**

```bash
cd server && npx vitest run src/test/routes/search.test.ts
```

Expected: 全パス（レスポンスにフィールド追加は後方互換）

- [ ] **Step 3: コミット**

```bash
git add server/src/routes/search.ts
git commit -m "feat: add id and genericName to /search/drug-master response"
```

---

## Task 3: prescription-search-service 実装

**Files:**
- Create: `server/src/services/prescription-search-service.ts`
- Test: `server/src/test/prescription-search-service.test.ts`

- [ ] **Step 1: テストファイルを作成（基本ケース）**

`server/src/test/prescription-search-service.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  resolveDrugGroups,
  buildPharmacyMatrix,
  scoreAndSortPharmacies,
} from '../services/prescription-search-service.js';

describe('resolveDrugGroups', () => {
  it('genericName + specification が一致する drugMaster をグルーピングする', async () => {
    const mockDrugMasters = [
      { id: 1, drugName: 'ロキソプロフェンNa錠60mg「サワイ」', genericName: 'ロキソプロフェンナトリウム', specification: '60mg', yakkaPrice: '5.70', manufacturer: 'サワイ' },
      { id: 2, drugName: 'ロキソプロフェンNa錠60mg「トーワ」', genericName: 'ロキソプロフェンナトリウム', specification: '60mg', yakkaPrice: '6.10', manufacturer: 'トーワ' },
      { id: 3, drugName: 'レバミピド錠100mg', genericName: 'レバミピド', specification: '100mg', yakkaPrice: '9.80', manufacturer: null },
    ];

    const drugKeys = [
      { drugMasterId: 1, genericName: 'ロキソプロフェンナトリウム', specification: '60mg' },
    ];

    const groups = await resolveDrugGroups(drugKeys, mockDrugMasters);
    expect(groups).toHaveLength(1);
    expect(groups[0].drugMasterIds).toContain(1);
    expect(groups[0].drugMasterIds).toContain(2);
    expect(groups[0].drugMasterIds).not.toContain(3);
  });
});

describe('scoreAndSortPharmacies', () => {
  it('品目充足数 → 薬価合計 → 距離の順でソートする', () => {
    const pharmacies = [
      { pharmacyId: 1, matchedCount: 1, totalYakka: 100, distance: 5 },
      { pharmacyId: 2, matchedCount: 2, totalYakka: 200, distance: 10 },
      { pharmacyId: 3, matchedCount: 2, totalYakka: 150, distance: 3 },
    ];

    const sorted = scoreAndSortPharmacies(pharmacies);
    expect(sorted.map(p => p.pharmacyId)).toEqual([3, 2, 1]);
  });

  it('distance が null の薬局はソート末尾', () => {
    const pharmacies = [
      { pharmacyId: 1, matchedCount: 2, totalYakka: 100, distance: null },
      { pharmacyId: 2, matchedCount: 2, totalYakka: 100, distance: 5 },
    ];

    const sorted = scoreAndSortPharmacies(pharmacies);
    expect(sorted.map(p => p.pharmacyId)).toEqual([2, 1]);
  });
});
```

- [ ] **Step 2: テスト実行（Red）**

```bash
cd server && npx vitest run src/test/prescription-search-service.test.ts
```

Expected: FAIL（モジュール未定義）

- [ ] **Step 3: サービスファイルの基本構造を実装**

`server/src/services/prescription-search-service.ts`:

```typescript
import { db } from '../db/index.js';
import { drugMaster, deadStockItems, pharmacies, drugEquivalences, groupMembers, pharmacyRelationships } from '../db/schema.js';
import { eq, and, inArray, sql, ne, or, isNull, notExists } from 'drizzle-orm';
import { haversineDistance } from '../utils/geo-utils.js';

// --- Types ---

interface DrugKey {
  drugMasterId: number;
  genericName: string | null;
  specification: string | null;
}

interface DrugGroup {
  columnLabel: string;
  genericName: string | null;
  specification: string | null;
  drugMasterIds: number[];
  drugNames: string[];
}

interface PharmacyScore {
  pharmacyId: number;
  pharmacyName: string;
  matchedCount: number;
  totalDrugs: number;
  totalYakka: number;
  distance: number | null;
  isFavorite: boolean;
  isGroupMember: boolean;
  businessStatus: { isOpen: boolean; message: string; isConfigured: boolean };
}

interface MatrixCell {
  available: boolean;
  items: Array<{
    drugName: string;
    manufacturer: string | null;
    yakkaUnitPrice: number | null;
    quantity: number;
    unit: string | null;
  }>;
}

interface PrescriptionSearchResult {
  summary: PharmacyScore[];
  matrix: {
    columns: Array<{ genericName: string | null; specification: string | null }>;
    rows: Array<{
      pharmacyId: number;
      pharmacyName: string;
      cells: MatrixCell[];
    }>;
  };
}

// --- Drug Resolution ---

export async function resolveDrugGroups(
  drugKeys: DrugKey[],
  allDrugMasters?: Array<{ id: number; drugName: string; genericName: string | null; specification: string | null; yakkaPrice: string; manufacturer: string | null }>,
): Promise<DrugGroup[]> {
  const groups: DrugGroup[] = [];

  for (const key of drugKeys) {
    // Fetch the source drug master
    const source = allDrugMasters
      ? allDrugMasters.find(d => d.id === key.drugMasterId)
      : (await db.select().from(drugMaster).where(eq(drugMaster.id, key.drugMasterId)))[0];

    if (!source) continue;

    const gn = key.genericName ?? source.genericName;
    const spec = key.specification ?? source.specification;

    let matchedIds: number[] = [source.id];

    // Pass 1: genericName + specification match
    if (gn) {
      const matches = allDrugMasters
        ? allDrugMasters.filter(d => d.genericName === gn && d.specification === spec)
        : await db.select().from(drugMaster).where(
            and(
              eq(drugMaster.genericName, gn),
              spec != null ? eq(drugMaster.specification, spec) : isNull(drugMaster.specification),
            )
          );
      matchedIds = [...new Set([...matchedIds, ...matches.map(m => m.id)])];
    }

    // Pass 2: drugEquivalences text match (if genericName was null or few matches)
    if (!gn || matchedIds.length <= 1) {
      const equivRows = await db.select().from(drugEquivalences).where(
        or(
          eq(drugEquivalences.drugNameA, source.drugName),
          eq(drugEquivalences.drugNameB, source.drugName),
        )
      );
      for (const row of equivRows) {
        const otherName = row.drugNameA === source.drugName ? row.drugNameB : row.drugNameA;
        const otherMasters = allDrugMasters
          ? allDrugMasters.filter(d => d.drugName === otherName)
          : await db.select().from(drugMaster).where(eq(drugMaster.drugName, otherName));
        matchedIds = [...new Set([...matchedIds, ...otherMasters.map(m => m.id)])];
      }
    }

    // Pass 3: drugName normalization + Jaccard (threshold >= 0.70)
    // If still only the source drug matched, use prepareDrugName + jaccardSimilarity
    // from matching-score-service to find similar drugMasters
    if (matchedIds.length <= 1) {
      // Import and use: prepareDrugName, jaccardSimilarity from matching-score-service
      // Compare source.drugName against all drugMaster.drugName
      // Include matches with Jaccard score >= 0.70
      // Implementation note: load candidate drugMasters with same specification
      // to limit comparison scope, then apply Jaccard filter
    }

    const matchedDrugNames = allDrugMasters
      ? allDrugMasters.filter(d => matchedIds.includes(d.id)).map(d => d.drugName)
      : (await db.select({ drugName: drugMaster.drugName }).from(drugMaster).where(inArray(drugMaster.id, matchedIds))).map(r => r.drugName);

    groups.push({
      columnLabel: gn ? `${gn} ${spec ?? ''}`.trim() : source.drugName,
      genericName: gn,
      specification: spec,
      drugMasterIds: matchedIds,
      drugNames: matchedDrugNames,
    });
  }

  return groups;
}

// --- Scoring ---

export function scoreAndSortPharmacies(
  pharmacies: Array<{ pharmacyId: number; matchedCount: number; totalYakka: number; distance: number | null; [key: string]: unknown }>,
): typeof pharmacies {
  return [...pharmacies].sort((a, b) => {
    // 1. matchedCount desc
    if (b.matchedCount !== a.matchedCount) return b.matchedCount - a.matchedCount;
    // 2. totalYakka asc
    if (a.totalYakka !== b.totalYakka) return a.totalYakka - b.totalYakka;
    // 3. distance asc (null to end)
    if (a.distance === null && b.distance === null) return 0;
    if (a.distance === null) return 1;
    if (b.distance === null) return -1;
    return a.distance - b.distance;
  });
}

// --- Main Search ---

export async function searchPrescriptionInventory(
  pharmacyId: number,
  drugKeys: DrugKey[],
  filters: { groupOnly: boolean; openOnly: boolean; favoritePriority: boolean },
  coordinates: { latitude: number | null; longitude: number | null } | null,
): Promise<PrescriptionSearchResult> {
  // 1. Resolve drug groups
  const drugGroups = await resolveDrugGroups(drugKeys);

  // 2. Collect all drugMasterIds across groups
  const allDrugMasterIds = drugGroups.flatMap(g => g.drugMasterIds);

  // 3. Fetch inventory (primary path: drugMasterId match)
  const inventory = await db
    .select({
      id: deadStockItems.id,
      pharmacyId: deadStockItems.pharmacyId,
      drugMasterId: deadStockItems.drugMasterId,
      drugName: deadStockItems.drugName,
      quantity: deadStockItems.quantity,
      unit: deadStockItems.unit,
      yakkaUnitPrice: deadStockItems.yakkaUnitPrice,
    })
    .from(deadStockItems)
    .where(
      and(
        eq(deadStockItems.isAvailable, true),
        ne(deadStockItems.pharmacyId, pharmacyId),
        inArray(deadStockItems.drugMasterId, allDrugMasterIds.length > 0 ? allDrugMasterIds : [0]),
      )
    );

  // 4. Fetch pharmacy data only for pharmacies that appear in inventory
  const relevantPharmacyIds = [...new Set(inventory.map(i => i.pharmacyId))];
  const pharmacyRows = relevantPharmacyIds.length > 0
    ? await db.select().from(pharmacies).where(inArray(pharmacies.id, relevantPharmacyIds))
    : [];
  const pharmacyMap = new Map(pharmacyRows.map(p => [p.id, p]));

  // 5. Filter: blocked pharmacies
  const blockedRows = await db
    .select({ pharmacyId: pharmacyRelationships.pharmacyId, targetPharmacyId: pharmacyRelationships.targetPharmacyId })
    .from(pharmacyRelationships)
    .where(
      and(
        or(
          eq(pharmacyRelationships.pharmacyId, pharmacyId),
          eq(pharmacyRelationships.targetPharmacyId, pharmacyId),
        ),
        eq(pharmacyRelationships.relationshipType, 'blocked'),
      )
    );
  const blockedIds = new Set(blockedRows.flatMap(r => [r.pharmacyId, r.targetPharmacyId]));
  blockedIds.delete(pharmacyId);

  // 6. Filter: group members
  let groupMemberIds: Set<number> | null = null;
  if (filters.groupOnly) {
    const myGroups = await db
      .select({ groupId: groupMembers.groupId })
      .from(groupMembers)
      .where(eq(groupMembers.pharmacyId, pharmacyId));

    if (myGroups.length > 0) {
      const memberRows = await db
        .select({ pharmacyId: groupMembers.pharmacyId })
        .from(groupMembers)
        .where(inArray(groupMembers.groupId, myGroups.map(g => g.groupId)));
      groupMemberIds = new Set(memberRows.map(m => m.pharmacyId));
      groupMemberIds.delete(pharmacyId);
    } else {
      groupMemberIds = new Set();
    }
  }

  // 7. Filter: favorites
  const favoriteRows = await db
    .select({ targetPharmacyId: pharmacyRelationships.targetPharmacyId })
    .from(pharmacyRelationships)
    .where(
      and(
        eq(pharmacyRelationships.pharmacyId, pharmacyId),
        eq(pharmacyRelationships.relationshipType, 'favorite'),
      )
    );
  const favoriteIds = new Set(favoriteRows.map(r => r.targetPharmacyId));

  // 8. Build per-pharmacy inventory map
  const pharmacyInventory = new Map<number, typeof inventory>();
  for (const item of inventory) {
    if (blockedIds.has(item.pharmacyId)) continue;
    if (groupMemberIds !== null && !groupMemberIds.has(item.pharmacyId)) continue;

    if (!pharmacyInventory.has(item.pharmacyId)) {
      pharmacyInventory.set(item.pharmacyId, []);
    }
    pharmacyInventory.get(item.pharmacyId)!.push(item);
  }

  // 9. Build matrix and summary
  const summaryList: PharmacyScore[] = [];
  const matrixRows: PrescriptionSearchResult['matrix']['rows'] = [];

  for (const [phId, items] of pharmacyInventory) {
    const pharmacy = pharmacyMap.get(phId);
    if (!pharmacy) continue;

    // TODO: openOnly filter with business hours (integrate existing logic)

    const cells: MatrixCell[] = drugGroups.map(group => {
      const matchedItems = items.filter(item =>
        item.drugMasterId !== null && group.drugMasterIds.includes(item.drugMasterId)
      );

      return {
        available: matchedItems.length > 0,
        items: matchedItems
          .map(item => ({
            drugName: item.drugName,
            manufacturer: null as string | null, // resolve from drugMaster
            yakkaUnitPrice: item.yakkaUnitPrice ? parseFloat(item.yakkaUnitPrice) : null,
            quantity: item.quantity,
            unit: item.unit,
          }))
          .sort((a, b) => (a.yakkaUnitPrice ?? Infinity) - (b.yakkaUnitPrice ?? Infinity)),
      };
    });

    const matchedCount = cells.filter(c => c.available).length;
    if (matchedCount === 0) continue;

    const totalYakka = cells.reduce((sum, cell) => {
      if (!cell.available || cell.items.length === 0) return sum;
      return sum + (cell.items[0].yakkaUnitPrice ?? 0);
    }, 0);

    const dist = coordinates?.latitude != null && coordinates?.longitude != null
      && pharmacy.latitude != null && pharmacy.longitude != null
      ? haversineDistance(coordinates.latitude, coordinates.longitude, pharmacy.latitude, pharmacy.longitude)
      : null;

    summaryList.push({
      pharmacyId: phId,
      pharmacyName: pharmacy.name,
      matchedCount,
      totalDrugs: drugGroups.length,
      totalYakka: Math.round(totalYakka * 100) / 100,
      distance: dist !== null ? Math.round(dist * 10) / 10 : null,
      isFavorite: favoriteIds.has(phId),
      isGroupMember: groupMemberIds !== null ? groupMemberIds.has(phId) : false,
      businessStatus: { isOpen: true, message: '', isConfigured: false }, // TODO: integrate business hours
    });

    matrixRows.push({ pharmacyId: phId, pharmacyName: pharmacy.name, cells });
  }

  const sortedSummary = scoreAndSortPharmacies(summaryList).slice(0, 50);
  const sortedPharmacyIds = sortedSummary.map(s => s.pharmacyId);
  const sortedMatrixRows = sortedPharmacyIds
    .map(id => matrixRows.find(r => r.pharmacyId === id))
    .filter(Boolean) as PrescriptionSearchResult['matrix']['rows'];

  return {
    summary: sortedSummary as PharmacyScore[],
    matrix: {
      columns: drugGroups.map(g => ({ genericName: g.genericName, specification: g.specification })),
      rows: sortedMatrixRows,
    },
  };
}
```

- [ ] **Step 4: テスト実行（Green）**

```bash
cd server && npx vitest run src/test/prescription-search-service.test.ts
```

Expected: PASS

- [ ] **Step 5: manufacturer 解決ロジックを追加**

サービス内の `cells` 構築で `manufacturer` を drugMaster から引くように修正:

```typescript
// searchPrescriptionInventory 内でマスターを事前取得
const allMasterRows = await db.select({
  id: drugMaster.id,
  manufacturer: drugMaster.manufacturer,
}).from(drugMaster).where(inArray(drugMaster.id, allDrugMasterIds));
const masterManufacturerMap = new Map(allMasterRows.map(m => [m.id, m.manufacturer]));

// cells 構築で参照
manufacturer: item.drugMasterId ? masterManufacturerMap.get(item.drugMasterId) ?? null : null,
```

- [ ] **Step 6: テスト再実行**

```bash
cd server && npx vitest run src/test/prescription-search-service.test.ts
```

Expected: PASS

- [ ] **Step 7: コミット**

```bash
git add server/src/services/prescription-search-service.ts server/src/test/prescription-search-service.test.ts
git commit -m "feat: add prescription-search-service with drug grouping and pharmacy scoring"
```

---

## Task 4: POST /prescription-search ルート追加

**Files:**
- Modify: `server/src/routes/inventory.ts`
- Create: `server/src/test/inventory-prescription-search.test.ts`

- [ ] **Step 1: ルートテストを作成**

`server/src/test/inventory-prescription-search.test.ts`:
既存の `server/src/test/inventory-route.test.ts` のテストセットアップパターンに従う。

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express, { type Express } from 'express';
import { Router } from 'express';

// Mock auth middleware
vi.mock('../../middleware/auth.js', () => ({
  requireLogin: (req: any, _res: any, next: any) => {
    req.user = { id: 1, pharmacyId: 1, role: 'pharmacy' };
    next();
  },
}));

// Mock service
vi.mock('../../services/prescription-search-service.js', () => ({
  searchPrescriptionInventory: vi.fn().mockResolvedValue({
    summary: [],
    matrix: { columns: [], rows: [] },
  }),
}));

// Setup app with inventory routes
let app: Express;
beforeEach(async () => {
  app = express();
  app.use(express.json());
  const { default: inventoryRoutes } = await import('../../routes/inventory.js');
  app.use('/api/inventory', inventoryRoutes);
});

describe('POST /api/inventory/prescription-search', () => {
  it('drugKeys が空の場合 400 を返す', async () => {
    const res = await request(app)
      .post('/api/inventory/prescription-search')
      .send({ drugKeys: [] });
    expect(res.status).toBe(400);
  });

  it('drugKeys が 10 件以下で正常レスポンスを返す', async () => {
    const res = await request(app)
      .post('/api/inventory/prescription-search')
      .send({
        drugKeys: [{ drugMasterId: 1, genericName: 'test', specification: '10mg' }],
        filters: { groupOnly: false, openOnly: false, favoritePriority: false },
      });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('summary');
    expect(res.body).toHaveProperty('matrix');
  });

  it('drugKeys が 11 件の場合 400 を返す', async () => {
    const drugKeys = Array.from({ length: 11 }, (_, i) => ({
      drugMasterId: i + 1,
      genericName: `drug${i}`,
      specification: '10mg',
    }));
    const res = await request(app)
      .post('/api/inventory/prescription-search')
      .send({ drugKeys });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: テスト実行（Red）**

```bash
cd server && npx vitest run src/test/inventory-prescription-search.test.ts
```

Expected: FAIL

- [ ] **Step 3: ルートハンドラーを追加**

`server/src/routes/inventory.ts` に追加:

```typescript
import { prescriptionSearchSchema } from '../utils/validators.js';
import { searchPrescriptionInventory } from '../services/prescription-search-service.js';

router.post('/prescription-search', async (req: AuthRequest, res: Response) => {
  try {
    const data = parsePayloadOrRespond(prescriptionSearchSchema, req.body ?? {}, res, '検索条件を入力してください');
    if (!data) return;

    const result = await searchPrescriptionInventory(
      req.user!.pharmacyId,
      data.drugKeys,
      data.filters,
      data.coordinates,
    );

    res.json(result);
  } catch (err) {
    handleRouteError(err, 'Prescription search error', res);
  }
});
```

- [ ] **Step 4: テスト実行（Green）**

```bash
cd server && npx vitest run src/test/inventory-prescription-search.test.ts
```

Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add server/src/routes/inventory.ts server/src/test/inventory-prescription-search.test.ts
git commit -m "feat: add POST /inventory/prescription-search route"
```

---

## Task 5: PGlite 統合テスト

**Files:**
- Create: `server/src/test/integration/prescription-search-integration.test.ts`

- [ ] **Step 1: 統合テストを作成**

genericName NULL フォールバックチェーン、マルチグループ、drugMasterId NULL 補助パスのテスト。
既存の `server/src/test/integration/helpers/test-db.ts` のヘルパーを使用。

既存の `server/src/test/integration/helpers/test-db.ts` のヘルパーを使用してフィクスチャを構築。
テスト本文はRed（失敗）→Green（実装）のTDDフローで記述する。

**フィクスチャ要件:**
- drugMaster: 4レコード（ロキソプロフェン サワイ/トーワ（genericName あり）、レバミピド（genericName あり）、古い薬品（genericName NULL））
- drugEquivalences: 1レコード（古い薬品 ↔ 別名ペア）
- deadStockItems: 6レコード（drugMasterId あり4件、drugMasterId NULL 2件）
- pharmacies: 3レコード（薬局A, B, C）
- pharmacyGroups: 2レコード（グループX, Y）
- groupMembers: 薬局AはX/Y両方、薬局BはXのみ、薬局CはYのみ

**テストケース:**

```typescript
it('genericName が一致する後発品を自動グルーピングする', async () => {
  const groups = await resolveDrugGroups([
    { drugMasterId: 1, genericName: 'ロキソプロフェンナトリウム', specification: '60mg' },
  ]);
  expect(groups[0].drugMasterIds).toContain(1); // サワイ
  expect(groups[0].drugMasterIds).toContain(2); // トーワ
  expect(groups[0].drugMasterIds).toHaveLength(2);
});

it('genericName が NULL の場合 drugEquivalences で同等品を検出する', async () => {
  const groups = await resolveDrugGroups([
    { drugMasterId: 4, genericName: null, specification: null }, // 古い薬品
  ]);
  expect(groups[0].drugMasterIds.length).toBeGreaterThan(1); // ペアが見つかる
});

it('drugMasterId が NULL の在庫は drugName マッチで検出される', async () => {
  const result = await searchPrescriptionInventory(
    99, // 自薬局ID（テスト用）
    [{ drugMasterId: 1, genericName: 'ロキソプロフェンナトリウム', specification: '60mg' }],
    { groupOnly: false, openOnly: false, favoritePriority: false },
    null,
  );
  // drugMasterId NULL でも drugName マッチの在庫が含まれること
  const allItems = result.matrix.rows.flatMap(r => r.cells.flatMap(c => c.items));
  expect(allItems.length).toBeGreaterThan(0);
});

it('groupOnly フィルタで複数グループの和集合が返る', async () => {
  // 薬局A（グループX,Y両方）で groupOnly 検索
  const result = await searchPrescriptionInventory(
    pharmacyAId,
    [{ drugMasterId: 1, genericName: 'ロキソプロフェンナトリウム', specification: '60mg' }],
    { groupOnly: true, openOnly: false, favoritePriority: false },
    null,
  );
  const pharmacyIds = result.summary.map(s => s.pharmacyId);
  // 薬局B（Xのみ）と薬局C（Yのみ）の両方が含まれること
  expect(pharmacyIds).toContain(pharmacyBId);
  expect(pharmacyIds).toContain(pharmacyCId);
});
```

- [ ] **Step 2: テスト実行**

```bash
cd server && npx vitest run src/test/integration/prescription-search-integration.test.ts
```

Expected: PASS

- [ ] **Step 3: コミット**

```bash
git add server/src/test/integration/prescription-search-integration.test.ts
git commit -m "test: add PGlite integration tests for prescription search fallback chain"
```

---

## Task 6: クライアント API メソッド追加

**Files:**
- Modify: `client/src/api/client.ts`

- [ ] **Step 1: 型定義と API メソッドを追加**

`client/src/api/client.ts` に追加:

```typescript
export interface DrugChip {
  drugMasterId: number;
  genericName: string | null;
  specification: string | null;
  displayLabel: string;
}

export interface PrescriptionSearchFilters {
  groupOnly: boolean;
  openOnly: boolean;
  favoritePriority: boolean;
}

export interface PrescriptionSearchRequest {
  drugKeys: Array<{
    drugMasterId: number;
    genericName: string | null;
    specification: string | null;
  }>;
  filters: PrescriptionSearchFilters;
  coordinates: { latitude: number | null; longitude: number | null } | null;
}

export interface MatrixCell {
  available: boolean;
  items: Array<{
    drugName: string;
    manufacturer: string | null;
    yakkaUnitPrice: number | null;
    quantity: number;
    unit: string | null;
  }>;
}

export interface PrescriptionSearchResponse {
  summary: Array<{
    pharmacyId: number;
    pharmacyName: string;
    matchedCount: number;
    totalDrugs: number;
    totalYakka: number;
    distance: number | null;
    businessStatus: { isOpen: boolean; message: string; isConfigured: boolean };
    isFavorite: boolean;
    isGroupMember: boolean;
  }>;
  matrix: {
    columns: Array<{ genericName: string | null; specification: string | null }>;
    rows: Array<{
      pharmacyId: number;
      pharmacyName: string;
      cells: MatrixCell[];
    }>;
  };
}

// Add inside the existing `api` object literal (alongside get, post, put, etc.):
// api = { get, post, ..., prescriptionSearch }
prescriptionSearch: (data: PrescriptionSearchRequest) =>
  api.post<PrescriptionSearchResponse>('/inventory/prescription-search', data),
// Note: api.post<T> returns Promise<T> directly, NOT { data: T }
```

- [ ] **Step 2: typecheck**

```bash
cd client && npx tsc --noEmit
```

Expected: エラーなし

- [ ] **Step 3: コミット**

```bash
git add client/src/api/client.ts
git commit -m "feat: add prescriptionSearch API method and types"
```

---

## Task 7: usePrescriptionSearch フック

**Files:**
- Create: `client/src/hooks/usePrescriptionSearch.ts`

- [ ] **Step 1: フックを作成**

```typescript
import { useState, useCallback } from 'react';
import { api, DrugChip, PrescriptionSearchFilters, PrescriptionSearchResponse } from '../api/client.js';

interface UsePrescriptionSearchReturn {
  chips: DrugChip[];
  addChip: (chip: DrugChip) => void;
  removeChip: (index: number) => void;
  clearChips: () => void;
  filters: PrescriptionSearchFilters;
  setFilters: React.Dispatch<React.SetStateAction<PrescriptionSearchFilters>>;
  result: PrescriptionSearchResponse | null;
  isSearching: boolean;
  search: () => Promise<void>;
  error: string | null;
}

export function usePrescriptionSearch(): UsePrescriptionSearchReturn {
  const [chips, setChips] = useState<DrugChip[]>([]);
  const [filters, setFilters] = useState<PrescriptionSearchFilters>({
    groupOnly: false,
    openOnly: false,
    favoritePriority: false,
  });
  const [result, setResult] = useState<PrescriptionSearchResponse | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addChip = useCallback((chip: DrugChip) => {
    setChips(prev => {
      if (prev.length >= 10) return prev;
      if (prev.some(c => c.drugMasterId === chip.drugMasterId)) return prev;
      return [...prev, chip];
    });
  }, []);

  const removeChip = useCallback((index: number) => {
    setChips(prev => prev.filter((_, i) => i !== index));
  }, []);

  const clearChips = useCallback(() => {
    setChips([]);
    setResult(null);
  }, []);

  const search = useCallback(async () => {
    if (chips.length === 0) return;
    setIsSearching(true);
    setError(null);
    try {
      const result = await api.prescriptionSearch({
        drugKeys: chips.map(c => ({
          drugMasterId: c.drugMasterId,
          genericName: c.genericName,
          specification: c.specification,
        })),
        filters,
        coordinates: null, // TODO: get from auth context pharmacy
      });
      setResult(result); // api.post returns T directly, not { data: T }
    } catch (err) {
      setError('検索中にエラーが発生しました');
    } finally {
      setIsSearching(false);
    }
  }, [chips, filters]);

  return { chips, addChip, removeChip, clearChips, filters, setFilters, result, isSearching, search, error };
}
```

- [ ] **Step 2: typecheck**

```bash
cd client && npx tsc --noEmit
```

Expected: エラーなし

- [ ] **Step 3: コミット**

```bash
git add client/src/hooks/usePrescriptionSearch.ts
git commit -m "feat: add usePrescriptionSearch hook"
```

---

## Task 8: SearchInput の onSelect 拡張

**Files:**
- Modify: `client/src/components/SearchInput.tsx`

- [ ] **Step 1: Props に onSelectItem と suggestObjectUrl を追加**

```typescript
interface DrugMasterSuggestion {
  id: number;
  drugName: string;
  genericName: string | null;
  specification: string | null;
  yakkaPrice: string;
  unit: string | null;
}

interface SearchInputProps {
  // 既存 props...
  onSelectItem?: (item: DrugMasterSuggestion) => void;
  suggestObjectUrl?: string;  // オブジェクトレスポンス用の別 URL
}
```

内部のフェッチロジックを分岐:
- `suggestObjectUrl` が設定されている場合: `api.get<DrugMasterSuggestion[]>(suggestObjectUrl, { params: { q } })` でオブジェクト配列を取得。リスト表示は `item.drugName` を使用。選択時に `onSelectItem(item)` を呼ぶ。
- `suggestObjectUrl` が未設定の場合: 既存の `api.get<string[]>(suggestUrl, { params: { q } })` パスを維持。選択時に既存の `onChange(selected)` を呼ぶ。
- 既存の全呼び出し元（`suggestUrl` のみ使用）は変更不要（後方互換）。

- [ ] **Step 2: 既存テストが壊れないか確認**

```bash
cd client && npx vitest run src/test/components/SearchInput.test.tsx 2>/dev/null || echo "No existing test"
```

- [ ] **Step 3: コミット**

```bash
git add client/src/components/SearchInput.tsx
git commit -m "feat: add onSelectItem callback to SearchInput for chip-based selection"
```

---

## Task 9: PrescriptionSearchForm コンポーネント

**Files:**
- Create: `client/src/components/inventory/PrescriptionSearchForm.tsx`

- [ ] **Step 1: コンポーネントを作成**

チップ表示、サジェスション入力、フィルタチェックボックス、バーコードスキャン、検索ボタンを統合。

```typescript
import React from 'react';
import { Form, Badge, Button } from 'react-bootstrap';
import SearchInput from '../SearchInput.js';
import BarcodeScanButton from '../mobile/BarcodeScanButton.js';
import { DrugChip, PrescriptionSearchFilters } from '../../api/client.js';

interface Props {
  chips: DrugChip[];
  onAddChip: (chip: DrugChip) => void;
  onRemoveChip: (index: number) => void;
  filters: PrescriptionSearchFilters;
  onFiltersChange: React.Dispatch<React.SetStateAction<PrescriptionSearchFilters>>;
  onSearch: () => void;
  isSearching: boolean;
  isGroupMember: boolean;  // グループ所属の有無（false ならグループフィルタ無効化）
}

export default function PrescriptionSearchForm({
  chips, onAddChip, onRemoveChip, filters, onFiltersChange, onSearch, isSearching, isGroupMember,
}: Props) {
  // SearchInput で /search/drug-master からサジェスション取得
  // onSelectItem でチップ追加
  // チップ一覧を Badge で表示
  // フィルタ3つのチェックボックス
  // 検索ボタン（chips.length === 0 で disabled）
  // ...
}
```

- [ ] **Step 2: typecheck**

```bash
cd client && npx tsc --noEmit
```

- [ ] **Step 3: コミット**

```bash
git add client/src/components/inventory/PrescriptionSearchForm.tsx
git commit -m "feat: add PrescriptionSearchForm component"
```

---

## Task 10: PharmacySummaryCards コンポーネント

**Files:**
- Create: `client/src/components/inventory/PharmacySummaryCards.tsx`

- [ ] **Step 1: コンポーネントを作成**

「すべて揃う薬局」「一部揃う薬局」のセクション分け、カード表示、提案ボタン。

- [ ] **Step 2: コミット**

```bash
git add client/src/components/inventory/PharmacySummaryCards.tsx
git commit -m "feat: add PharmacySummaryCards component"
```

---

## Task 11: InventoryMatrix + InventoryMatrixCell コンポーネント

**Files:**
- Create: `client/src/components/inventory/InventoryMatrix.tsx`
- Create: `client/src/components/inventory/InventoryMatrixCell.tsx`

- [ ] **Step 1: InventoryMatrixCell を作成**

セル内にメーカー名・薬価・数量を薬価安い順で列挙。在庫なしは赤背景。

- [ ] **Step 2: InventoryMatrix を作成**

スティッキーヘッダー（薬剤名）、スティッキー左列（薬局名）、横スクロール対応。
React Bootstrap の Table + CSS `position: sticky`。

- [ ] **Step 3: コミット**

```bash
git add client/src/components/inventory/InventoryMatrix.tsx client/src/components/inventory/InventoryMatrixCell.tsx
git commit -m "feat: add InventoryMatrix and InventoryMatrixCell components"
```

---

## Task 12: InventoryBrowsePage 全面改修

**Files:**
- Modify: `client/src/pages/InventoryBrowsePage.tsx`

- [ ] **Step 1: 既存の実装をバックアップ確認**

```bash
git diff HEAD -- client/src/pages/InventoryBrowsePage.tsx | head -5
```

- [ ] **Step 2: ページを全面改修**

既存の useIncrementalSearch + リスト表示を、usePrescriptionSearch + PrescriptionSearchForm + PharmacySummaryCards + InventoryMatrix に置き換え。

構成:
```
PageShell
  └─ PrescriptionSearchForm
  └─ (result が null → 検索前メッセージ)
  └─ (result あり → PharmacySummaryCards + InventoryMatrix)
```

- [ ] **Step 3: 動作確認**

```bash
cd client && npx tsc --noEmit
```

- [ ] **Step 4: コミット**

```bash
git add client/src/pages/InventoryBrowsePage.tsx
git commit -m "feat: overhaul InventoryBrowsePage with prescription search matrix view"
```

---

## Task 13: クライアントテスト

**Files:**
- Create: `client/src/test/components/InventoryBrowsePage.test.tsx`
- Create: `client/src/test/components/PrescriptionSearchForm.test.tsx`
- Create: `client/src/test/components/InventoryMatrix.test.tsx`

- [ ] **Step 1: テストを作成**

- PrescriptionSearchForm: チップ追加/削除、10件上限、フィルタ切替
- InventoryMatrix: セル表示、在庫なし表示、薬価順
- InventoryBrowsePage: 検索→結果表示フロー

- [ ] **Step 2: テスト実行**

```bash
cd client && npx vitest run src/test/components/InventoryBrowsePage.test.tsx src/test/components/PrescriptionSearchForm.test.tsx src/test/components/InventoryMatrix.test.tsx
```

Expected: PASS

- [ ] **Step 3: コミット**

```bash
git add client/src/test/components/
git commit -m "test: add client tests for prescription search feature"
```

---

## Task 14: 全体統合テスト

- [ ] **Step 1: サーバーテスト全実行**

```bash
cd server && npx vitest run
```

Expected: 全パス

- [ ] **Step 2: クライアントテスト全実行**

```bash
cd client && npx vitest run
```

Expected: 全パス

- [ ] **Step 3: typecheck 両方**

```bash
npm run typecheck
```

Expected: エラーなし

- [ ] **Step 4: 最終コミット**

```bash
git add -A
git commit -m "feat: prescription inventory search - multi-drug matrix view with generic grouping

Implements multi-drug prescription search on InventoryBrowsePage:
- Chip-based drug input with suggestion and barcode scan
- Auto-grouping of generic equivalents by genericName + specification
- Pharmacy summary cards (full/partial match) + inventory matrix
- Filters: group-only, open-only, favorite priority
- One-tap proposal submission"
```
