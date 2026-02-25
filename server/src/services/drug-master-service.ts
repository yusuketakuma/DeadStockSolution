// ファサード: 後方互換のため、分割した各サービスを re-export する
export type { ParsedDrugRow, ParsedPackageRow } from './drug-master-parser-service';
export {
  parseYjCode,
  parseMhlwExcelData,
  decodeCsvBuffer,
  parseMhlwCsvData,
  parsePackageCsvData,
  parsePackageXmlData,
  parsePackageZipData,
  parsePackageExcelData,
} from './drug-master-parser-service';

export type { SyncResult } from './drug-master-sync-service';
export {
  syncDrugMaster,
  syncPackageData,
  createSyncLog,
  completeSyncLog,
} from './drug-master-sync-service';

export type { DrugMasterStats } from './drug-master-lookup-service';
export {
  searchDrugMaster,
  lookupByCode,
  getDrugMasterStats,
  getDrugDetail,
  getSyncLogs,
  updateDrugMasterItem,
} from './drug-master-lookup-service';
