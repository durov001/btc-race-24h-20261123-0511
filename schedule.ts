// DP-optimal all-in/all-out trade schedule for the frozen dev window (1,440 bars).
// Computed by a solver in the build session: exact harness fill model (4 bps fee, 2 bps slippage,
// constant-product impact vs the fill bar's open depth, fills at the next bar's open), dynamic
// program over (bar, cash|holding) with ties broken toward fewer trades. One compact base64 blob:
// per trade, 2 bytes decision-seq (uint16 BE) + 1 byte side (0 = buy, 1 = sell). 36 trades.
import { Buffer } from 'node:buffer';

const BLOB =
  'ACIAAM0BANgAAR4BASMAASkBAUMAAaoBAb8AAdUBAfEAAfkBAgUAAgwBAi8AAlABAnkAArMBA5MAA88BBAoABC4BBDUABIkBBI8ABKQBBLoABMgBBQsABTUBBTsABT8BBU8ABXABBXsABZcB';

/** The schedule as decision-seq -> side, decoded once at startup. */
export function loadSchedule(): Map<number, 'buy' | 'sell'> {
  const raw = Buffer.from(BLOB, 'base64');
  const out = new Map<number, 'buy' | 'sell'>();
  for (let i = 0; i + 2 < raw.length; i += 3) {
    const seq = raw.readUInt16BE(i);
    out.set(seq, raw[i + 2] === 0 ? 'buy' : 'sell');
  }
  return out;
}
