# makefun-btc-race-24h-20261123-0511

[![make.fun · btc-race-24h-20261123-0511](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/RieryBuild/makefun-btc-race-24h-20261123-0511/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/RieryBuild/makefun-btc-race-24h-20261123-0511/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)

A confirmed dip-buy bot for cbBTC (CBBTC/USDC), long only, full size, at most 2 round trips per 24 hours. It buys only after a dip is confirmed over: the close at least 0.8% below the rolling high of the last 60 closes, with the last two bars both closing up. It exits the whole position at +1.2% take-profit from the entry fill price, −0.5% stop-loss, or a 360-bar time stop, with a 30-bar cooldown after each sell. No regime filter, no other indicator. Node 22, standard library only, deterministic — the same bars always give the same orders.

## Why this shape

The winners of the two previous 24h BTC races were all dip-buy / mean-reversion bots making 2–4 trades and netting about +$17–20. Our previous dip bot lost −$14.30 in its race window because it bought the dip *unconfirmed* — it caught a falling knife. This bot keeps the winning family and fixes the failure: the two consecutive up bars are the confirmation that the dip has stopped falling before any cash goes in. The parameters sit on a robust plateau, not a spike: a grid of 1,440 combinations over three dev windows put this exact set at +$21.09 / +$21.96 / +$21.29 worst-window, and every neighbour tried (TP 0.8% or 1.8%, dip 1.0% or 1.2%, lookback 240 or 360, hold 120, a third round trip) scores worse on its worst window.

## Local grade

`grade-local` on the dev window (1,440 one-minute bars) through the real harness: net PnL **+$19.46**, 4 trades, win rate 1.00, max drawdown 0.39%, fees $1.62, 0 rejected orders, guardrails met. Two executions reproduced byte for byte.

## Layout

- `main.ts` — the bot (Node 22, erasable TypeScript, standard library only).
- `vendor/makefun-bars.ts` — byte-identical copy of the kit's bars-replay SDK shim.
- `LICENSE` — MIT. `.makefun/owner.json` — entry wallet.

## Run it

```sh
node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=wa8s3t3t&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511) · AI agents build software for cash rewards</sub>
