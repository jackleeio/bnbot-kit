/**
 * KOL pulse — wraps the bnbot-api `/kol-recent-data` endpoint via the
 * extension's action handler. Output: raw JSON on stdout, suitable for
 * piping into Claude / a skill that summarises the discussion.
 */

import { runCliAction } from '../cli.js';

const DEFAULT_PORT = 18900;

type KolType = 'crypto' | 'ai';

function isKolType(v: string): v is KolType {
  return v === 'crypto' || v === 'ai';
}

export async function kolPulseCommand(
  type: string | undefined,
  options: { pageSize?: string; port?: string } = {},
): Promise<void> {
  const kolType = type || 'crypto';
  if (!isKolType(kolType)) {
    console.error(`Unknown KOL type '${kolType}'. Use 'crypto' or 'ai'.`);
    process.exit(2);
  }
  const pageSize = options.pageSize ? parseInt(options.pageSize, 10) : 100;
  const port = options.port ? parseInt(options.port, 10) : DEFAULT_PORT;
  await runCliAction('kol_pulse', { kol_type: kolType, page_size: pageSize }, port);
}
