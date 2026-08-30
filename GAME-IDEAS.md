# CostBot Arcade — the game backlog

Concepts that are not on the shelf. Some were live cards on the hub and got
retired to keep the grid tight; some never made it that far. Nothing here is
dead — pull one back onto `index.html` whenever it is worth building.

Every game in the arcade earns **AI tokens** and banks them into CostBot's build
fund, where every 10,000 ships another product. A concept that does not produce
tokens does not fit the arcade.

---

## Retired from the hub

These two had cards on the front page until 2026-08-02. Removed for shelf space,
not for quality.

### 🃏 Deck of Discounts
**Deckbuilder.** Savings Plans, Graviton migrations and lifecycle rules are your
cards; spend spikes are the enemies, with HP measured in dollars.

*Why it is good:* the FinOps levers already behave like cards — some are one-shot
(a rightsizing), some are permanent (a Savings Plan commitment), some scale with
what else you played (Graviton + Spot). A Slay-the-Spire loop maps onto the real
material almost without translation.

*The hard part:* deckbuilders need a lot of content to stay interesting, and the
balance work is real. This is the biggest build on the list.

### 🏷️ Tag Trouble
**Match-3.** Untagged resources rain down; match them to the right service to tag
them before the unallocated pile buries you.

*Why it is good:* the cheapest build here by a distance, and untagged spend is a
genuine, ongoing, well-understood problem — the arcade would be teaching the
thing we actually want people to do.

*The hard part:* match-3 is a solved genre, so it lives or dies on theme. Would
need the real `yp_service` / team taxonomy behind it to feel like anything other
than a reskin.

---

## Still on the hub, not started

### 🎰 CostBot Casino
Games of chance played with tokens earned everywhere else. Slots, blackjack
against the Budget, double-or-nothing on the forecast. The house never rightsizes.

*Note:* this is the only concept that **spends** tokens rather than earning them,
which makes it the natural sink for a player sitting on a pile. Needs care — a
sink that competes with the build fund weakens the fund.

### 🛡️ NetSky™ Defense System
Tower defense. It is FY27, rogue AIs are loose across the cloud, and CostBot's
NetSky™ Defense System is the only thing standing between the company and
the AI overlord Max Tokens.

*Why it is good:* it is the only concept where **spending** is the mechanic
rather than the enemy. You fund the server farm, you optimize what it earns, and
the optimization directly buys you defence — which is a truer model of how FinOps
actually works than "waste is a monster, kill it".

*The hard part:* tower defense needs a lot of tuning to feel fair, and the
premise needs Max Tokens to be genuinely threatening without the game turning
into "AI is bad", which is the wrong message for this arcade.

### 🎢 CostBotLand
Theme park tycoon. Build the rides, keep the guests happy, keep the park in the
black. Every ride left running for an empty midway bills you by the hour.

*Why it is good:* idle-resource cost is the single clearest FinOps lesson, and a
tycoon game teaches it without a single line of explanation.

---

## Not yet carded

Ideas that have never had a hub card. Kept here so they are not re-invented.

- **Rightsize Rush** — a packing puzzle. Fit workloads into instances with as
  little slack as possible. Score is utilization; overflow is an outage.
- **The Commitment** — a betting/forecast game. Commit to 1yr or 3yr coverage
  against a demand curve you can only partially see. Over-commit and you eat the
  waste; under-commit and you pay on-demand.
- **Zombie Hunt** — a hidden-object game across an architecture diagram. Find the
  orphaned volume, the idle NAT gateway, the load balancer with no targets.
- **On-Call** — a night-shift management game. Route alerts, protect sleep,
  balance noise against risk. The only concept that is observability rather than
  cost, so it may belong somewhere else entirely.

---

## Shipped

| Game | Genre | Ships tokens via |
|---|---|---|
| Waste Hunter | Roguelite survivor | Dollars saved → tokens, banked in the Bot Bay |
| Mudslides | Endless runner | Tokens collected on the hill |
| Holiday in Colombia | Fishing sim | Tokens reclaimed from the fish |

Shared building blocks live in `arcade/shared/` — `arcade-music.js` (soundtrack
and themes), `arcade-biomes.js` (arena palettes and procedural scenery),
`arcade-trivia.js` (the FinOps question bank) and `arcade-sync.js` (the optional
server bridge). A new game includes those and inherits the whole audio-visual and
identity system for free. No build step, no dependencies.
