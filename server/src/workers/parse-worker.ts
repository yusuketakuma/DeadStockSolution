import { parentPort, workerData } from 'worker_threads';
import { decodeCsvBuffer, parseCsvContent } from '../services/drug-master-parser-service';
import { parseExcelBuffer } from '../services/upload-service';

type ParseFormat = 'xlsx' | 'csv';

interface ParseOptions {
  format: ParseFormat;
}

interface WorkerPayload {
  buffer: Uint8Array;
  options: ParseOptions;
}

async function parseBuffer(buffer: Buffer, options: ParseOptions): Promise<unknown[][]> {
  if (options.format === 'csv') {
    return parseCsvContent(decodeCsvBuffer(buffer));
  }
  return parseExcelBuffer(buffer);
}

async function run(): Promise<void> {
  if (!parentPort) {
    throw new Error('Worker port is not available');
  }

  const payload = workerData as WorkerPayload;
  const buffer = Buffer.from(payload.buffer);

  try {
    const rows = await parseBuffer(buffer, payload.options);
    parentPort.postMessage({ ok: true, rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    parentPort.postMessage({ ok: false, error: message });
  }
}

void run();
