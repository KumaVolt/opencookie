// Downloads the latest Open Cookie Database into ./data (or $DATA_DIR).
import { downloadCookieDb } from '../src/server/data.ts';

const n = await downloadCookieDb();
console.log(`Open Cookie Database updated: ${n} entries.`);
