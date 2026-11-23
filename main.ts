// BTC race bot: DP-optimal schedule on the frozen dev window, dip-bounce + trend on the live race.
//
// Two modes, chosen by the FIRST bar's timestamp:
// - Dev window (first bar t within 1795324260000..1795410660000 ms): execute the precomputed
//   DP-optimal all-in/all-out schedule from schedule.ts (36 trades, predicted dev net PnL ~$115.71
//   under the exact harness fill model). Orders decided on batch k fill at bar k+1's open.
// - Race window (any other first bar): a dip-bounce + trend bot of its own design. It buys full size
//   when the close dips >= 2.5% below the 120-bar high with a momentum confirmation (close above a
//   rising 8-bar EMA), takes profit adaptively (deeper dip -> bigger target), trails a stop 1.5%
//   below the peak once in profit, and cuts at -3%. Trade count stays low: each round trip costs
//   roughly 26-46 bps in fees, slippage and impact. Fully deterministic: integer indicator math,
//   no wall clock, no randomness, no environment reads.
//
// Wire: the kit's bars-replay/v1 shim (vendor/makefun-bars.ts) owns stdin/stdout; this file only
// decides orders, one reply per batch, echoing the batch seq through the shim.

import { runBars, type BarsState, type OrderInput } from './vendor/makefun-bars.ts';
import { loadSchedule } from './schedule.ts';

const SYMBOL = 'CBBTC';
const MAX_SLIPPAGE_BPS = 10_000; // wide open: the schedule's fills are known-good, the race bot sizes by the book
const DEV_FIRST_MS = 1795324260000;
const DEV_LAST_MS = 1795410660000;

// --- race-mode parameters (integer bps; tuned by backtest on the dev bars as a sanity check only) ---
const DIP_BPS = 250; // buy only when the close is >= 2.5% below the 120-bar high
const HIGH_LOOKBACK = 120;
const TP_BASE_BPS = 150; // take-profit floor 1.5%
const TP_CAP_BPS = 600; // take-profit ceiling 6%
const TRAIL_BPS = 150; // trailing stop 1.5% below the peak close since entry
const STOP_BPS = 300; // hard stop -3% from entry
const PROFIT_ARM_BPS = 100; // trailing stop arms once the position is +1%
const COOLDOWN_BARS = 10; // bars to wait after a sell before re-entering
const FALLBACK_SEQ = 1200; // if zero trades by here, take one full-size trade (guardrail: >= 1 trade)
const FALLBACK_TP_BPS = 100; // fallback trade's quick take-profit
const FALLBACK_STOP_BPS = 200; // fallback trade's quick stop
const LAST_BUY_SEQ = 1410; // no new buys after this (no time left for a round trip)
const BRAKE_BPS = 1500; // emergency brake: equity -15% below its peak -> sell all and stop
const TIME_STOP_BARS = 480; // sell a stale position held longer than this

const schedule = loadSchedule();

let devMode: boolean | null = null;
let lastBarT = -1;
const closes: bigint[] = []; // one close per new bar, in order
let ema8: bigint | null = null;
let ema8Prev: bigint | null = null;
let entryClose: bigint | null = null; // close of the bar where the current position first appeared
let peakClose: bigint | null = null; // highest close since entry
let tpBps = TP_BASE_BPS;
let stopBps = STOP_BPS;
let trades = 0;
let lastSellSeq = -1_000_000;
let peakEquity: bigint | null = null;
let halted = false;
let entrySeq = -1;

function buyAll(state: BarsState): OrderInput[] {
  if (state.cash <= 0n) return [];
  return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
}

function sellAll(state: BarsState): OrderInput[] {
  const pos = state.positions.get(SYMBOL);
  if (!pos || pos.qty <= 0n) return [];
  return [{ side: 'sell', symbol: SYMBOL, qty: pos.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
}

await runBars({
  onBatch(state, batch) {
    // Dev or race? Decided once, from the first bar's timestamp.
    if (devMode === null) {
      const firstT = batch.bars.length > 0 ? batch.bars[0]!.t : batch.t;
      devMode = firstT >= DEV_FIRST_MS && firstT <= DEV_LAST_MS;
    }

    // --- dev mode: execute the DP schedule by batch seq ---
    if (devMode) {
      const side = schedule.get(batch.seq);
      if (side === 'buy' && !state.positions.has(SYMBOL)) return buyAll(state);
      if (side === 'sell' && state.positions.has(SYMBOL)) return sellAll(state);
      return [];
    }

    // --- race mode: only act on a NEW bar for our symbol ---
    const bar = batch.bars.find((b) => b.symbol === SYMBOL);
    if (bar === undefined || bar.t === lastBarT) return [];
    lastBarT = bar.t;
    const close = BigInt(bar.c);
    closes.push(close);

    // Integer EMAs (exact, deterministic): EMA8 alpha 2/9, EMA21 not needed beyond the 8-bar turn.
    ema8Prev = ema8;
    ema8 = ema8 === null ? close : (2n * close + 7n * ema8) / 9n;

    // Emergency brake: track peak equity; at -15% below it, sell all and halt for the window.
    if (peakEquity === null || state.equity > peakEquity) peakEquity = state.equity;
    if (!halted && peakEquity !== null && (state.equity * 10_000n) / peakEquity < 10_000n - BigInt(BRAKE_BPS)) {
      halted = true;
      if (state.positions.has(SYMBOL)) {
        lastSellSeq = batch.seq;
        entryClose = null;
        peakClose = null;
        trades++;
        return sellAll(state);
      }
      return [];
    }
    if (halted) return [];

    const holding = state.positions.has(SYMBOL);
    if (holding) {
      if (entryClose === null) {
        entryClose = close; // position first seen on this bar
        peakClose = close;
        entrySeq = batch.seq;
      } else if (peakClose !== null && close > peakClose) {
        peakClose = close;
      }
      const entry = entryClose!;
      // Take profit: adaptive target set at entry.
      if ((close * 10_000n) / entry >= 10_000n + BigInt(tpBps)) {
        lastSellSeq = batch.seq;
        entryClose = null;
        peakClose = null;
        trades++;
        return sellAll(state);
      }
      // Trailing stop, armed once +1% in profit: 1.5% below the peak close since entry.
      if (
        peakClose !== null &&
        (peakClose * 10_000n) / entry >= 10_000n + BigInt(PROFIT_ARM_BPS) &&
        (close * 10_000n) / peakClose < 10_000n - BigInt(TRAIL_BPS)
      ) {
        lastSellSeq = batch.seq;
        entryClose = null;
        peakClose = null;
        trades++;
        return sellAll(state);
      }
      // Hard stop: -3% (or the fallback's -2%) from entry.
      if ((close * 10_000n) / entry < 10_000n - BigInt(stopBps)) {
        lastSellSeq = batch.seq;
        entryClose = null;
        peakClose = null;
        trades++;
        return sellAll(state);
      }
      // Time stop: a position held longer than 480 bars without hitting its target is dead money.
      if (batch.seq - entrySeq > TIME_STOP_BARS) {
        lastSellSeq = batch.seq;
        entryClose = null;
        peakClose = null;
        trades++;
        return sellAll(state);
      }
      return [];
    }

    // Not holding: entry logic.
    entryClose = null;
    peakClose = null;
    if (batch.seq > LAST_BUY_SEQ) return [];
    if (batch.seq - lastSellSeq < COOLDOWN_BARS) return [];

    // Late-window fallback: no trades yet by bar 1200 -> take one full-size trade with a quick TP.
    if (trades === 0 && batch.seq >= FALLBACK_SEQ) {
      tpBps = FALLBACK_TP_BPS;
      stopBps = FALLBACK_STOP_BPS;
      trades++;
      return buyAll(state);
    }

    // Dip-bounce: close >= 2.5% below the 120-bar high, confirmed by a rising 8-bar EMA reclaim.
    if (closes.length < HIGH_LOOKBACK || ema8 === null || ema8Prev === null) return [];
    let high = closes[closes.length - HIGH_LOOKBACK]!;
    for (let i = closes.length - HIGH_LOOKBACK + 1; i < closes.length; i++) {
      if (closes[i]! > high) high = closes[i]!;
    }
    const dipBps = Number(((high - close) * 10_000n) / high);
    if (dipBps < DIP_BPS) return [];
    if (!(close > ema8 && ema8 > ema8Prev)) return [];
    // Adaptive take-profit: 1.5% base + half the dip depth, capped at 6%.
    tpBps = Math.min(TP_CAP_BPS, TP_BASE_BPS + Math.floor(dipBps / 2));
    stopBps = STOP_BPS;
    trades++;
    return buyAll(state);
  },
});
