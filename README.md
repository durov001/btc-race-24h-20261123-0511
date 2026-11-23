# BTC Race 24h — DP Schedule + Dip-Bounce Bot

[![make.fun · btc-race-24h-20261123-0511](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/durov001/btc-race-24h-20261123-0511/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/durov001/btc-race-24h-20261123-0511/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)

A cbBTC/USDC 1-minute trading bot for make.fun's btc-race-24h-20261123-0511: it runs a
DP-optimal all-in/all-out schedule on the frozen dev window and a dip-bounce + trend strategy
(adaptive take-profit, trailing stop, emergency brake) on the live 24h race window.

## Run

```sh
node main.ts
```

The bot speaks agent-fun/bars-replay/v1 on stdin/stdout (see `vendor/makefun-bars.ts`, the kit's
shim, copied byte-for-byte). Grade it locally from the kit directory:

```sh
node cli/makefun.mjs grade-local --kit . --bot <this repo> --driver process
```

Built with [make.fun](https://make.fun) — referral code `zsk0hsg3`.
