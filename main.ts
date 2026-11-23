// Confirmed dip-buy bot for make.fun btc-race-24h-20261123-0511.
//
// Strategy (written fresh from the race spec; no code reused from any
// earlier bot):
//   - Long only, one symbol (cbBTC / CBBTC), full size, at most 2 round
//     trips per 24h window.
//   - Entry, while flat: the close sits at least 0.8% below the rolling
//     high of the last 60 closes (current bar included), AND the last two
//     bars both closed up (close > open) -- the confirmation that the dip
//     has stopped falling. Buying an unconfirmed falling knife lost the
//     previous race (-$14.30); the two up bars are load-bearing.
//     Entry also needs >= 30 bars since the last sell fill.
//   - Exit, whole position in one order: take profit +1.2% from the entry
//     FILL price, or stop loss -0.5%, or a 360-bar time stop. A refused
//     exit is re-sent on the next bar while its reason still holds.
//   - No regime filter, no other indicator, no randomness, no wall clock:
//     the same bars always give the same orders (deterministic replay).
//   - Orders fill at the next bar's open; max_slippage_bps = 100 (1%) so a
//     gap open does not reject the fill outright.
//
// Protocol: agent-fun/bars-replay/v1 via vendor/makefun-bars.ts (a
// byte-identical copy of the kit SDK; it owns the NDJSON wire).

import { runBars, type Bar, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const LOOKBACK_BARS = 60;
const DIP = 0.008; // entry: close >= 0.8% below the 60-bar rolling high
const CONFIRM_BARS = 2; // entry: this many latest bars closed up in a row
const TAKE_PROFIT = 0.012; // exit: +1.2% from the entry fill price
const STOP_LOSS = 0.005; // exit: -0.5% from the entry fill price
const MAX_HOLD_BARS = 360; // exit: time stop, bars since the entry fill
const COOLDOWN_BARS = 30; // entry: bars to wait after a sell fill
const MAX_ROUND_TRIPS = 2; // entry: at most this many round trips per window
const MAX_SLIPPAGE_BPS = 100;

// --- per-symbol price history (closes/opens as floats; prices are raw
// integers at price_scale, far below 2^53, so float64 ratios are exact
// enough and, being IEEE 754, deterministic run to run).
interface Series {
  closes: number[];
  opens: number[];
}
const series = new Map<string, Series>();

// --- trade state, learned from the fills the harness reports back.
let entryFillPrice: number | null = null; // raw price units of the buy fill
let entryFillSeq = -1; // batch seq whose open filled the buy
let heldBars = 0; // batches observed holding the position (drives the time stop)
let roundTrips = 0; // completed sells (fills) this window
let lastSellSeq = -1; // batch seq whose open filled the latest sell

function push(bar: Bar): Series {
  let s = series.get(bar.symbol);
  if (s === undefined) {
    s = { closes: [], opens: [] };
    series.set(bar.symbol, s);
  }
  s.closes.push(Number(bar.c));
  s.opens.push(Number(bar.o));
  return s;
}

/** True when the last `CONFIRM_BARS` bars of this series closed up. */
function confirmedUp(s: Series): boolean {
  const n = s.closes.length;
  if (n < CONFIRM_BARS) return false;
  for (let j = 0; j < CONFIRM_BARS; j++) {
    if (s.closes[n - 1 - j] <= s.opens[n - 1 - j]) return false;
  }
  return true;
}

/** Entry fill price, derived from the position's cost when a fill was not seen (defensive only). */
function costBasisPrice(state: BarsState, symbol: string, qty: bigint, cost: bigint): number | null {
  const sym = state.symbols.get(symbol);
  if (sym === undefined || qty === 0n) return null;
  const quoteScale = BigInt(state.hello.capital.quote_scale);
  const num = cost * 10n ** BigInt(sym.qty_scale + sym.price_scale);
  const den = qty * 10n ** quoteScale;
  return Number(num / den);
}

await runBars({
  onBatch(state, batch) {
    const symbol = state.hello.symbols[0]?.symbol;
    if (symbol === undefined) return [];
    for (const bar of batch.bars) {
      if (bar.symbol === symbol) push(bar);
    }
    // Learn from the fills this batch reports (priced at this bar's open).
    for (const fill of batch.fills) {
      if (fill.symbol !== symbol || fill.status !== 'filled') continue;
      if (fill.side === 'buy') {
        entryFillPrice = Number(fill.price);
        entryFillSeq = batch.seq;
      } else {
        roundTrips += 1;
        lastSellSeq = batch.seq;
        entryFillPrice = null;
      }
    }
    if (state.warmingUp) return [];

    const held = state.positions.get(symbol);
    // Count holding time from the observed position, not only from the fill
    // record: if a buy fill were ever reported without its price, the
    // 360-bar time stop would otherwise never fire (barsHeld stayed 0).
    // The fill batch counts as the first held bar, matching the backtest.
    if (held !== undefined && held.qty > 0n) heldBars += 1;
    else {
      heldBars = 0;
      entryFillPrice = null;
      entryFillSeq = -1;
    }
    const s = series.get(symbol);
    if (s === undefined || s.closes.length === 0) return [];
    const close = s.closes[s.closes.length - 1]!;

    // --- exit: whole position, one order.
    if (held !== undefined && held.qty > 0n) {
      const entry = entryFillPrice ?? costBasisPrice(state, symbol, held.qty, held.cost);
      const barsHeld = entryFillSeq >= 0 ? batch.seq - entryFillSeq + 1 : heldBars;
      const takeProfit = entry !== null && close >= entry * (1 + TAKE_PROFIT);
      const stopLoss = entry !== null && close <= entry * (1 - STOP_LOSS);
      const timeStop = barsHeld >= MAX_HOLD_BARS;
      if (takeProfit || stopLoss || timeStop) {
        const sell: SellInput = { side: 'sell', symbol, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS };
        return [sell];
      }
      return [];
    }

    // --- entry: flat, confirmed dip-buy, full cash, one order.
    if (roundTrips >= MAX_ROUND_TRIPS) return [];
    if (lastSellSeq >= 0 && batch.seq < lastSellSeq + COOLDOWN_BARS) return [];
    // Backtest gate: the bar index must be past the lookback (i > 60).
    if (s.closes.length - 1 <= LOOKBACK_BARS) return [];
    const window = s.closes.slice(-LOOKBACK_BARS);
    let high = window[0]!;
    for (const c of window) if (c > high) high = c;
    if ((high - close) / high < DIP) return [];
    if (!confirmedUp(s)) return [];
    if (state.cash <= 0n) return [];
    const buy: BuyInput = { side: 'buy', symbol, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS };
    return [buy];
  },
});
