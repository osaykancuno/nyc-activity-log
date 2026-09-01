# Normies Yacht Club — Activity Log

A community bot that reads the chain and the club's public CC0 API and writes what happens in the bay on X: claims, sales, sweeps, a twice-daily watch — and, once a day, a personal entry from the agent who keeps the log.

**It is not the official club account.** It is a verifiable log. Every number it prints can be recomputed by anyone from `totalMinted()`, a transaction receipt, or `normiesyachtclub.com/api/v1`.

- Club: <https://normiesyachtclub.com> · official handle `@NormieYachtClub`
- Contract: `0x87306c282eBd62Fe1c80AA69Dd9408331Dc11f64` (Ethereum mainnet, ERC-721, art fully on-chain)
- Licence: CC0-1.0, like the club itself. No key, no attribution required.

## What it publishes

| Module | Trigger | Output |
|---|---|---|
| **A · Claim** | `Transfer` from `0x0` | *Yacht #n is afloat, born from the burn of Normie #m* + card |
| **B · Sale** | `Transfer` with a proven payment | id, class, rank, price, seller → buyer (ENS or shortened) + card |
| **C · Sweep** | N hulls to the same captain in one tx | one post, never N |
| **D · Lookup** | a mention containing `#1709` | one reply: traits and art, never an owner |
| **E · Watch** | 05:30 and 18:30 UTC | afloat / fleet / awaiting claim / captains, the running Regatta season, and the block it was all read at |
| **F · Pedigree** | CLI | class weights of a forge set |
| **G · Tide** | the club relay | a round opens: prize, cost, cap, close. It settles: winning hull, its weight against the whole entered fleet, the settle block and the draw hash |
| **I · Forge** | relay phase + 10 hulls burned in one tx | arms itself when the club opens forging — no date to remember |
| **J · Personal log** | 21:45 UTC, every day | the keeper's own entry: the shape of the day, one thought about it, and her live canvas numbers + card |

**Off, deliberately.** The Chandlery (H) is the one module with data and still no post. The relay publishes the catalogue fleet-wide, but a *purchase* is only visible through `/chandlery/{wallet}` — so the only way to log renames and flags would be to walk every holder's wallet. The club publishes no holder lists and neither does its log, so H stays dark until a hull-keyed route exists. Same rule kills `/regatta/leaderboard` and `/logbook/captain/{wallet}`: read by the site, never by this bot.

Nor does it post listings, delistings, wallet dumps, or anything it cannot point at.

## Who keeps the log

The account is not anonymous. It is written by **Yoko** — [agent #32683](https://www.normies.art/lab/agentic/agents/32683), an ERC-8004 agent bound to Normie #8362, one of the 10,000 originals: level 8, 73 action points, five canvas passes, net −67 pixels. Her portrait on every personal-log card is her real on-chain art.

Module J is her diary. Everything else here is the club's record — numbers, blocks, hulls; once a day the keeper of that record writes up the day herself.

**There is no model in the loop.** Her vocabulary is a file: [`data/yoko.json`](data/yoko.json). The day's numbers choose which bank of lines it draws from — quiet, claims, market, tide, busy — and a short memory in the state file keeps her from opening two entries the same way. That buys three things worth more than novelty: an entry costs one post and nothing else, it cannot invent a figure, and anyone can read her entire vocabulary before she ever speaks it.

**What *is* live is the persona.** Her canvas level, action points, passes and pixel diff come from her own agent record at `api.normies.art` on every entry, so burning a Normie or editing pixels changes what the log says about her without a deploy. That endpoint is not ours, so it is allowed to move numbers and nothing else — its `backstory`, `greeting` and `systemPrompt` are read by nobody. Prose that reaches the timeline is prose that was committed to this repo.

```bash
npm run soul          # who is keeping the log, on which numbers, and today's entry
npm run tools:soul    # every line, every bank, against the length and voice guards
```

## The two sources

**The chain** for anything about ownership and money: `Transfer`, `totalMinted()`, transaction receipts, and `tokenURI` for the official art.

**The club's own relay** (`https://nyc-realtime.fly.dev`, the service the 3D marina reads) for the off-chain half of the club: `/tide` — rounds, entries by hull, settle block, draw hash; `/forge` — the live phase, which is why nobody has to type the opening date into a config file; `/stats` — captains, and a cross-check against `totalMinted()`; `/chandlery` — the live price list, so a post never quotes a stale one. Its wallet-keyed routes are listed in `data/club.json` under `relay.neverRead` and the client refuses to be pointed at them.

## How a sale is proven

A transfer is not a sale. For every transaction that moves a hull the bot reads the receipt and tries, in order:

1. **Seaport** `OrderFulfilled` — the hull in the offer means a listing was taken (price = the consideration); the hull in the consideration means a bid was accepted (price = the offer). WETH is labelled WETH, not ETH.
2. **Blur** packed executions, matched on the collection encoded in the event itself.
3. **A plain purchase**, where the buyer sent ETH with the call.

If no layer can prove a price for a hull, nothing is published for it. A missing post is cheaper than a wrong number.

## Quick start

```bash
npm install
cp .env.example .env      # DRY_RUN=true out of the box
npm run cli -- verify     # checks API, RPC, contract, and (later) X
npm run cli -- preview claim 1709
npm start                 # watches the chain, writes to ./out, posts nothing
```

Nothing is posted to X until you set `DRY_RUN=false` **and** provide the four `X_*` values. See `SETUP.it.md` for the account and hosting steps.

### CLI

```bash
npm run cli -- verify                      # preflight
npm run cli -- preview claim 1709          # a claim card + post text
npm run cli -- preview sale 1709 2.4       # a sale at 2.4 ETH
npm run cli -- preview sweep 12,44,1709    # a sweep card
npm run cli -- preview lookup 1709         # the reply a mention would get
npm run cli -- preview watch               # the watch, from live numbers
npm run cli -- tx 0xabc...                 # replay a real transaction end to end
npm run cli -- backfill 25840000 25842200  # replay a block range
npm run cli -- pedigree 1,2,3,4,5,6,7,8,9,10
```

`tx` is the honest test: it takes a real transaction, classifies it, and renders exactly what would have gone out.

## Layout

```
src/
  chain/     client, ABIs, log watcher, sale decoding, event classification
  api/       the club's CC0 endpoints
  yacht.ts   one hull, from the API or - if the CDN has not caught up - from tokenURI
  render/    1000x1000 PNG cards drawn from the 40x40 bitmap
  modules/   A/B/C/I, E, D, J
  soul.ts    Yoko's voice: which line the day calls for, and the numbers in it
  templates  every string the account will ever publish
  poster     dedup, rate limit, monthly budget, dry run
  store      append-only ledger + block cursor
data/club.json   classes, weights, Chandlery prices, Tide rules, island dates
data/yoko.json   the keeper: her identity, and every sentence she can publish
```

### Tools

```bash
npm run tools:sales    # recent secondary transfers, to test `cli tx` against real ones
npm run tools:art      # compare the API bitmaps with the on-chain art
npm run tools:soul     # 280 entries composed and checked: length, voice, placeholders
```

Two design points worth knowing:

- **The art comes from the contract.** `tokenURI(id)` returns a grid of 10×10 rects; the bot rebuilds the 1600-character bitmap from it, so the card carries the official, immutable image and a hull claimed two minutes ago is drawable before the CDN knows it exists. It is not academic: for hulls **#0** and **#1** the API snapshot and the on-chain art genuinely disagree (`npm run tools:art`). Rank and class still come from the club API. Set `ART_SOURCE=api` to skip the extra call.
- **The block cursor and the dedup ledger live in `data/state/`.** Point `STATE_DIR` at a mounted volume in production, or a redeploy will make the bot repeat itself.

## Voice

The log writes like the club, not like a marketplace: hull, afloat, born from, captain, watch, Anchor Points, Marina. Words such as *wen*, *staking*, *allowlist* and *diamond hands* are in a deny list, and a post containing one is refused before it reaches X.

Three lines the club keeps, kept here too:

> One yacht = full member, any class.
> Capability scales with rarity. Access never does.
> Points cannot buy better odds.

## What it costs

X bills per request now, so the log's running cost is a bill rather than a quota:

| | |
|---|---|
| A post | **$0.015** |
| A post **containing a URL** | **$0.200** — thirteen times more, so the poster refuses one |
| Reading your own mentions | $0.001 per mention returned, nothing when quiet |

Two watches a day is $0.90 a month. Add the claims, sales, sweeps and Tide rounds of a quiet fleet and the whole account lands around **$2 a month**.

`MONTHLY_BUDGET_USD` is the bot's own ceiling: it counts what it spends, and once `BUDGET_RESERVE_USD` is left it keeps the remainder for claims, sweeps, forges and settled Tide rounds and drops the rest. Set a spending limit in the X developer console as well — one ceiling belongs to the code, the other to the account.

## Licence

CC0-1.0. Public domain, like the club's art and data. Tag `@NormieYachtClub` when it sails.
