# pharmacyId WHERE Predicate Audit — RLS Phase 5

Generated: $(date '+%Y-%m-%d %H:%M')

## Rules

1. **REDUNDANT** — SELECT/UPDATE/DELETE WHERE `pharmacyId = req.user!.id` (RLS handles this now)
2. **KEEP (INSERT)** — INSERT `pharmacyId` values (app must provide the value; RLS WITH CHECK validates)
3. **KEEP (cross-tenant)** — WHERE using a DIFFERENT pharmacyId variable (admin ops, other pharmacy lookups)
4. **KEEP (non-tenant column)** — WHERE on columns like `pharmacyAId`, `pharmacyBId`, `toPharmacyId` (if different from RLS tenant column)
5. **KEEP (shared/global)** — Tables without RLS

---

## ROUTES DIRECTORY

### 1. routes/upload-quality.ts — ALL REDUNDANT

| Line | Code | Type | Verdict |
|------|------|------|---------|
| 25 | `eq(uploadRowIssues.pharmacyId, pharmacyId)` | SELECT | **REDUNDANT** |
| 30 | `eq(uploadRowIssues.pharmacyId, pharmacyId)` | SELECT (count) | **REDUNDANT** |
| 59 | `eq(uploadRowIssues.pharmacyId, pharmacyId)` | SELECT (in and()) | **REDUNDANT** |
| 60 | `eq(uploadRowIssues.pharmacyId, pharmacyId)` | SELECT | **REDUNDANT** |
| 98 | `eq(uploadRowIssues.pharmacyId, pharmacyId)` | SELECT (in and()) | **REDUNDANT** |
| 99 | `eq(uploadRowIssues.pharmacyId, pharmacyId)` | SELECT | **REDUNDANT** |

Context: All use `pharmacyId = req.user!.id`. `uploadRowIssues` is tenant-scoped by `pharmacyId`.

---

### 2. routes/upload.ts — ALL REDUNDANT

| Line | Code | Type | Verdict |
|------|------|------|---------|
| 86 | `eq(uploadJobs.pharmacyId, pharmacyId)` | SELECT | **REDUNDANT** |

Context: `pharmacyId = req.user!.id`. `uploadJobs` is tenant-scoped by `pharmacyId`.

---

### 3. routes/statistics.ts — MOSTLY REDUNDANT

| Line | Code | Type | Verdict |
|------|------|------|---------|
| 130 | `eq(uploadJobs.pharmacyId, pharmacyId)` | SELECT | **REDUNDANT** |
| 142 | `eq(deadStockItems.pharmacyId, pharmacyId)` | SELECT | **REDUNDANT** |
| 165 | `eq(exchangeProposals.pharmacyAId, pharmacyId)` | SELECT | **KEEP** (different column: `pharmacyAId`, not `pharmacyId`) |
| 166 | `eq(exchangeProposals.pharmacyBId, pharmacyId)` | SELECT | **KEEP** (different column: `pharmacyBId`, not `pharmacyId`) |
| 184 | `eq(exchangeProposals.pharmacyAId, pharmacyId)` | SELECT | **KEEP** (different column) |
| 185 | `eq(exchangeProposals.pharmacyBId, pharmacyId)` | SELECT | **KEEP** (different column) |
| 194 | `eq(matchCandidateSnapshots.pharmacyId, pharmacyId)` | SELECT | **REDUNDANT** |
| 204 | `eq(pharmacies.id, pharmacyId)` | SELECT | **REDUNDANT** (pharmacies.id = tenant_id) |
| 213 | `eq(exchangeFeedback.toPharmacyId, pharmacyId)` | SELECT | **KEEP** (different column: `toPharmacyId`) |
| 221 | `eq(pharmacyRelationships.pharmacyId, pharmacyId)` | SELECT | **REDUNDANT** |
| 232 | `eq(predictiveAlerts.pharmacyId, pharmacyId)` | SELECT | **REDUNDANT** |
| 271 | `eq(dailyStatistics.pharmacyId, pharmacyId)` | SELECT | **REDUNDANT** |

Note: `exchangeProposals` uses `pharmacyAId`/`pharmacyBId` dual-tenancy — these may need special RLS treatment and are NOT redundant.

---

### 4. routes/business-hours.ts — REDUNDANT (current pharmacy) + KEEP (other pharmacy)

| Line | Code | Type | Verdict |
|------|------|------|---------|
| 128 | `eq(pharmacyBusinessHours.pharmacyId, pharmacyId)` | SELECT | **REDUNDANT** (current user) |
| 135 | `eq(pharmacySpecialHours.pharmacyId, pharmacyId)` | SELECT | **REDUNDANT** (current user) |
| 407 | `eq(pharmacies.id, pharmacyId)` | SELECT | **REDUNDANT** (current user) |
| 492 | `eq(pharmacies.id, pharmacyId)` | UPDATE (optimistic lock) | **REDUNDANT** |
| 500 | `eq(pharmacyBusinessHours.pharmacyId, pharmacyId)` | DELETE | **REDUNDANT** |
| 506 | `eq(pharmacySpecialHours.pharmacyId, pharmacyId)` | DELETE | **REDUNDANT** |
| 540-548 | `fetchWeeklyBusinessHours(pharmacyId)` with param from URL | SELECT | **KEEP** (different pharmacy from req.params) |

Context: Lines 128-506 operate on `pharmacyId = req.user!.id`. Line 540+ handles `GET /:pharmacyId` for other pharmacies.

---

### 5. routes/notifications.ts — ALL REDUNDANT

| Line | Code | Type | Verdict |
|------|------|------|---------|
| 401 | `eq(notificationGroupStates.pharmacyId, pharmacyId)` | SELECT | **REDUNDANT** |
| 481 | `eq(matchNotifications.pharmacyId, pharmacyId)` | SELECT | **REDUNDANT** |
| 496 | `eq(notificationsTable.pharmacyId, pharmacyId)` | SELECT | **REDUNDANT** |
| 549 | `eq(adminMessageReads.pharmacyId, pharmacyId)` | SELECT | **REDUNDANT** |
| 560 | `eq(pharmacies.id, pharmacyId)` | SELECT | **REDUNDANT** |
| 765 | `eq(notificationGroupStates.pharmacyId, pharmacyId)` | DELETE | **REDUNDANT** |

INSERT values (KEEP):
| Line | Code | Verdict |
|------|------|---------|
| 708 | `pharmacyId` in INSERT `notificationGroupStates` | **KEEP (INSERT)** |
| 738 | `pharmacyId` in INSERT `notificationGroupStates` | **KEEP (INSERT)** |
| 809 | `pharmacyId` in INSERT `adminMessageReads` | **KEEP (INSERT)** |

---

### 6. routes/match-bookmarks.ts — REDUNDANT (SELECTs) + KEEP (INSERTs + ownership checks)

| Line | Code | Type | Verdict |
|------|------|------|---------|
| 39 | `eq(matchCandidateBookmarks.pharmacyId, pharmacyId)` | SELECT (duplicate check) | **REDUNDANT** |
| 86 | `eq(matchCandidateBookmarks.pharmacyId, pharmacyId)` | SELECT | **REDUNDANT** |
| 174 | `eq(matchDismissFeedback.pharmacyId, pharmacyId)` | SELECT | **REDUNDANT** |
| 250 | `eq(matchDismissFeedback.pharmacyId, pharmacyId)` | SELECT | **REDUNDANT** |
| 54 | `pharmacyId` in INSERT values | INSERT | **KEEP (INSERT)** |
| 221 | `pharmacyId` in INSERT values | INSERT | **KEEP (INSERT)** |
| 113,120,145,154 | App-level ownership checks (`existing.pharmacyId !== pharmacyId`) | App logic | **KEEP** (app-level check, not DB WHERE) |

---

### 7. routes/requests.ts — REDUNDANT (+ KEEP INSERTs)

| Line | Code | Type | Verdict |
|------|------|------|---------|
| 213 | `eq(userRequests.pharmacyId, req.user.id)` | SELECT | **REDUNDANT** |
| 239 | `eq(userRequests.pharmacyId, req.user.id)` | SELECT | **REDUNDANT** |
| 439 | `pharmacyId: req.user.id` in INSERT | INSERT | **KEEP (INSERT)** |
| 465 | `pharmacyId: req.user.id` in INSERT | INSERT | **KEEP (INSERT)** |
| 399 | `requestRow.pharmacyId !== req.user.id` (app-level check) | App logic | **KEEP** (app-level authz check) |

---

### 8. routes/inventory.ts — REDUNDANT (+ KEEP INSERTs)

| Line | Code | Type | Verdict |
|------|------|------|---------|
| 208 | `eq(deadStockItems.pharmacyId, req.user!.id)` | SELECT | **REDUNDANT** |
| 224 | `eq(deadStockItems.pharmacyId, req.user!.id)` | SELECT (count) | **REDUNDANT** |
| 245 | `eq(deadStockItems.pharmacyId, req.user!.id)` | DELETE | **REDUNDANT** |
| 277 | `eq(usedMedicationItems.pharmacyId, req.user!.id)` | SELECT | **REDUNDANT** |
| 284 | `eq(usedMedicationItems.pharmacyId, req.user!.id)` | SELECT (count) | **REDUNDANT** |

Note: `GET /browse` (line 294) searches ALL pharmacies' inventory — no pharmacyId filter on deadStockItems (intentional cross-tenant query). **KEEP as-is.**

---

### 9. routes/pharmacies.ts — REDUNDANT (my relationships) + KEEP (cross-tenant)

| Line | Code | Type | Verdict |
|------|------|------|---------|
| 338 | `eq(pharmacyRelationships.pharmacyId, req.user!.id)` | SELECT | **REDUNDANT** |
| 156 | `eq(pharmacies.id, req.user!.id)` | SELECT (current coords) | **REDUNDANT** |
| 42-54 | `findActivePharmacyById(id)` with param | SELECT | **KEEP** (other pharmacy lookup) |
| 368-371 | `eq(pharmacies.id, id)` with URL param | SELECT | **KEEP** (other pharmacy detail) |
| 277,292 | `inArray(pharmacyBusinessHours.pharmacyId, pharmacyIds)` | SELECT | **KEEP** (batch fetch for multiple pharmacies) |

---

### 10. routes/alerts.ts (via services/alert-read-service.ts) — REDUNDANT

All pharmacyId filtering is done inside `alert-read-service.ts` which is called from routes with `pharmacyId = req.user!.id`:

| Service File | Line | Code | Verdict |
|-------------|------|------|---------|
| alert-read-service.ts | 49 | `eq(predictiveAlerts.pharmacyId, pharmacyId)` | **REDUNDANT** |
| alert-read-service.ts | 163 | `eq(predictiveAlerts.pharmacyId, pharmacyId)` | **REDUNDANT** |
| alert-read-service.ts | 179 | `eq(predictiveAlerts.pharmacyId, pharmacyId)` | **REDUNDANT** (UPDATE) |
| alert-read-service.ts | 191 | `eq(notifications.pharmacyId, pharmacyId)` | **REDUNDANT** |
| alert-read-service.ts | 206 | `eq(predictiveAlerts.pharmacyId, pharmacyId)` | **REDUNDANT** |
| alert-read-service.ts | 210 | `eq(predictiveAlerts.pharmacyId, pharmacyId)` | **REDUNDANT** |

---

### 11. routes/admin-pharmacies-detail.ts — KEEP (admin operations on OTHER pharmacies)

| Line | Code | Type | Verdict |
|------|------|------|---------|
| 44 | `eq(pharmacies.id, id)` | SELECT | **KEEP** (admin viewing OTHER pharmacy via URL param `:id`) |
| 106 | `eq(pharmacies.id, id)` | UPDATE | **KEEP** (admin updating OTHER pharmacy) |
| 185 | `eq(pharmacies.id, id)` | UPDATE (optimistic lock) | **KEEP** |
| 193 | `eq(pharmacyBusinessHours.pharmacyId, id)` | DELETE | **KEEP** (admin operating on OTHER pharmacy) |
| 208 | `eq(pharmacySpecialHours.pharmacyId, id)` | DELETE | **KEEP** (admin operating on OTHER pharmacy) |
| 256 | `eq(pharmacies.id, id)` | SELECT | **KEEP** |
| 269 | `eq(pharmacies.id, id)` | UPDATE | **KEEP** |
| 334 | `eq(adminAuditLogs.targetPharmacyId, id)` | SELECT | **KEEP** (different column, admin context) |

INSERT values (`pharmacyId: req.user!.id` in writeLog calls): **KEEP (INSERT)** — these are audit log entries.

---

### 12. routes/admin-pharmacies-list.ts — KEEP (admin cross-tenant)

The `.innerJoin(pharmacies, eq(userRequests.pharmacyId, pharmacies.id))` at lines 222, 244, 314 are JOIN conditions, not WHERE filters. **KEEP.**

---

### 13. routes/admin-openclaw-retries.ts — KEEP (admin cross-tenant)

Line 56: `.innerJoin(pharmacies, eq(openclawRetryJobs.pharmacyId, pharmacies.id))` — JOIN condition, **KEEP.**

---

## SERVICES DIRECTORY (key findings)

### group-service.ts
| Line | Code | Verdict |
|------|------|---------|
| 125 | `eq(groupMembers.pharmacyId, pharmacyId)` | **REDUNDANT** |
| 133 | `eq(notifications.pharmacyId, pharmacyId)` | **REDUNDANT** |
| 378 | `eq(groupMembers.pharmacyId, pharmacyId)` | **REDUNDANT** |
| 385 | `eq(notifications.pharmacyId, pharmacyId)` | **REDUNDANT** |
| 474 | `eq(groupMembers.pharmacyId, pharmacyId)` | **REDUNDANT** |
| 686 | `eq(groupMembers.pharmacyId, targetPharmacyId)` | **KEEP** (different pharmacy ID — group admin check) |

### timeline-fetchers/
| File | Line | Code | Verdict |
|------|------|------|---------|
| upload-fetchers.ts | 56 | `eq(uploadJobs.pharmacyId, pharmacyId)` | **REDUNDANT** |
| exchange-fetchers.ts | 200 | `eq(adminMessageReads.pharmacyId, pharmacyId)` | **REDUNDANT** |
| exchange-fetchers.ts | 263 | `eq(deadStockItems.pharmacyId, pharmacyId)` | **REDUNDANT** |
| notification-fetchers.ts | 207 | `eq(notificationsTable.pharmacyId, pharmacyId)` | **REDUNDANT** |
| notification-fetchers.ts | 246 | `eq(matchNotifications.pharmacyId, pharmacyId)` | **REDUNDANT** |

### other services
| File | Line | Code | Verdict |
|------|------|------|---------|
| push-dispatch-service.ts | 143 | `eq(pushSubscriptions.pharmacyId, pharmacyId)` | **REDUNDANT** |
| inventory-search-preferences-service.ts | 21 | `eq(inventorySearchPreferences.pharmacyId, pharmacyId)` | **REDUNDANT** |
| inventory-search-preferences-service.ts | 68 | `eq(inventorySearchPreferences.pharmacyId, pharmacyId)` | **REDUNDANT** |
| timeline-service.ts | 272 | `eq(notificationsTable.pharmacyId, pharmacyId)` | **REDUNDANT** |
| timeline-service.ts | 280 | `eq(matchNotifications.pharmacyId, pharmacyId)` | **REDUNDANT** |
| subscription-service.ts | 123 | `eq(subscriptions.pharmacyId, pharmacyId)` | **REDUNDANT** |
| subscription-service.ts | 148 | `eq(subscriptions.pharmacyId, pharmacyId)` | **REDUNDANT** |
| notification-service.ts | 160 | `eq(notifications.pharmacyId, pharmacyId)` | **REDUNDANT** |
| notification-service.ts | 175 | `eq(matchNotifications.pharmacyId, pharmacyId)` | **REDUNDANT** |
| upload-parser-helper-service.ts | 141 | `eq(columnMappingTemplates.pharmacyId, pharmacyId)` | **REDUNDANT** |
| admin-relationship-service.ts | 23 | `eq(pharmacyRelationships.pharmacyId, params.pharmacyId)` | **KEEP** (admin — different pharmacy) |

---

## SUMMARY

### Total: ~60 pharmacyId WHERE predicates found

| Category | Count | Notes |
|----------|-------|-------|
| **REDUNDANT** (routes) | ~35 | Can remove after RLS is verified |
| **REDUNDANT** (services) | ~20 | Can remove after RLS is verified |
| **KEEP (INSERT values)** | ~8 | App must still provide pharmacyId in INSERTs |
| **KEEP (cross-tenant)** | ~10 | Admin ops on other pharmacies, browse other pharmacies, different column names |
| **KEEP (app-level authz)** | ~3 | App-level ownership checks (not DB WHERE) — can simplify when RLS is trusted |

### Recommended action order:
1. Remove redundant WHERE predicates in **routes/** (listed above as REDUNDANT)
2. Remove redundant WHERE predicates in **services/** (listed above as REDUNDANT)
3. Keep all KEEP entries as-is
4. Verify RLS policies cover all tenant-scoped tables before removing predicates
5. Test each endpoint after removal to ensure RLS enforcement works correctly
