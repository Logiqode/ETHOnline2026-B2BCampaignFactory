# Wizard

**Confidential cross-brand campaign factory** — B2B loyalty/cross-brand campaigns where two enterprises run "spend at Brand A → earn rewards redeemable at Brand B" without sharing raw customer data or building bilateral integrations.

> Scaffolded from the `hello-confidential-workflows` starter kit ([smartcontractkit/cre-templates](https://github.com/smartcontractkit/cre-templates/tree/main/starter-templates/hello-confidential-workflows), MIT). The CRE confidential workflow provides the confidential eligibility verification; settlement lives on Base Sepolia.

## Stack

| Layer | Tech |
|---|---|
| Smart contracts | Solidity 0.8.28, Foundry, OpenZeppelin v5.1 (EIP-1167 clones, ERC-1155) |
| Confidential workflow | Chainlink CRE (`handlerInTee`), TypeScript, `@chainlink/cre-sdk` 1.18 |
| Backend | bun + Hono + postgres.js + zod |
| Local state | Postgres 16 in Docker (`docker compose`), port 5433 |
| Settlement | Base Sepolia (`CampaignFactory` → `CampaignEscrow` clones → `CampaignReward`) |
| Identity | Privy embedded wallets (identity anchor = wallet address) |

## Layout

```
contracts/            Foundry project (CampaignFactory, CampaignEscrow, CampaignReward, tests)
wizard/               CRE workflow (workflow.ts, tests, configs, test-payloads/)
backend/              Local-state API (Hono + postgres.js). Campaign CRUD + launch (fee split, salt)
backend/db/           Schema (auto-applied to Postgres on first `docker compose up`)
app/                  Vite + React frontend (Campaign Wizard, Campaigns list)
docs/                 Technical spec + demo outline
docker-compose.yml    Local Postgres 16 (port 5433) — one command for a fresh clone
project.yaml          CRE project settings (Base Sepolia RPCs)
secrets.yaml          CRE secret mapping
Makefile              Common dev tasks (db-up, backend, app, test)
```

## Prerequisites

- [Foundry](https://book.getfoundry.sh/) — `forge` (e.g. `~/.foundry/bin/forge.exe`)
- [bun](https://bun.sh/) — used by the CRE workflow toolchain
- The `cre` CLI (Chainlink Runtime Environment, e.g. `C:\Users\<you>\AppData\Local\Programs\cre\cre`)

## Installation

```bash
# Workflow dependencies
git clone https://github.com/Logiqode/ETHOnline2026-Wizard.git
bun install --cwd ./wizard
bun install --cwd ./backend
bun install --cwd ./app

# Environment (required for CRE simulate)
cp .env.example .env    # fill SECRET_API_TOKEN, or export it

# Environment (backend local dev)
cp backend/.env.example backend/.env   # optional — defaults match compose

# Start the local Postgres (one command, no local install)
docker compose up -d
```

Contracts use vendored dependencies in `contracts/lib/` (via `git clone`; gitignored).

## Local dev

```bash
make db-up       # start Postgres (port 5433)
make backend     # run the API on http://localhost:4000  (bun --watch)
make app         # run the Vite app (http://localhost:5173)
```

Or without make:

```bash
docker compose up -d
cd backend && bun run dev
cd app && bun run dev
```

The wizard's **Launch Campaign** now saves a campaign draft in Postgres, validates
launch (fee split 0–10000 bps, non-zero fee accounts, ≥ 0.01 ETH operating deposit
— mirrors `CampaignFactory.createCampaign`), and stores the generated CREATE2 salt.
On-chain `createCampaign()` wiring is still pending deployment, so escrow/reward
addresses stay null (honest boundary). See `backend/src/lib/launch.ts`. The
**Campaigns** page lists everything persisted.

---

## Testing

### Backend (local state API)

```bash
cd backend
bun run typecheck
bun test          # launch validation: fee split, fee accounts, deposit, salt
```

Requires the Postgres container (`docker compose up -d`).

### Smart contracts (Foundry)

```bash
cd contracts

# Build
~/.foundry/bin/forge build          # or: forge build (if on PATH)

# Run the test suite (26 tests: claim, cap, nullifier, window,
# redeem/redeemFor, redeemer whitelist, decimal guard, factory wiring,
# per-rule deployment shapes, and parallel campaigns with different rule mixes)
~/.foundry/bin/forge test           # or: forge test

# Run a single test (verbose trace)
~/.foundry/bin/forge test --match-test test_ClaimMintsPoints -vvv

# Run tests matching a substring
~/.foundry/bin/forge test --match-path test/CampaignWorkflow.t.sol

# Gas report
~/.foundry/bin/forge test --gas-report
```

> Note: `forge` may not be on PATH on Windows — use the full path `~/.foundry/bin/forge.exe`, or add it to PATH.

### CRE confidential workflow (TypeScript / bun)

The workflow is **HTTP-triggered** and serves multiple campaigns from one binary. The config holds a `campaigns` map keyed by `campaignId`; each HTTP request body selects a campaign via `campaignId` and carries the POS purchase.

```bash
cd wizard

# Typecheck
bun run typecheck                      # or: ./node_modules/.bin/tsc --noEmit

# Unit tests (15 tests: 3 demo campaigns x 5 payloads — eligibility, window,
# min-spend, day-of-week, per-user cap, reset rollover, discount, digital)
bun run test                           # or: bun test
```

### End-to-end simulation (HTTP-triggered, per-campaign payloads)

```bash
cd ..   # repo root

# Run one payload against a campaign
cre workflow simulate ./wizard --target=staging-settings -e .env --http-payload ./wizard/test-payloads/campaign-a-pass.json
```

- `--target=staging-settings` selects the config from `workflow.yaml` (`config.staging.json`).
- `-e .env` loads the environment (including `SECRET_API_TOKEN`, read by the enclave at runtime — no shell export needed).
- `--http-payload <path>` is the HTTP request body. Payload files live in `wizard/test-payloads/`.

The three demo campaigns (in `config.staging.json` / `config.production.json`):

| id | Mechanic | Rules |
|----|----------|-------|
| 1 | Fixed $5 discount | min spend $20, no caps |
| 2 | 20% cashback | Tue+Thu only, $50/user cap, resets weekly Mon 04:00 UTC |
| 3 | Digital Merchandise "White Bear Plushie Medium" | min spend $15, total redeem cap 200 |

Run all the bundled payloads (pass + fail per campaign) and check the verdict:

```bash
for p in wizard/test-payloads/campaign-*.json; do
  echo "===== $(basename $p) ====="
  cre workflow simulate ./wizard --target=staging-settings -e .env \
    --http-payload "$p" 2>&1 | grep -E "Workflow Simulation Result|APPROVE|REJECT"
done
```

Expected results:

```
campaign-a-pass.json            → APPROVE points=5 reason=ok            (fixed $5 discount)
campaign-a-fail-below-min.json  → REJECT points=0 reason=below-min-spend
campaign-b-pass-tue.json        → APPROVE points=20 reason=ok           (20% of $100)
campaign-b-fail-monday.json     → REJECT points=0 reason=not-allowed-day
campaign-b-fail-cap-exhausted.json → REJECT points=0 reason=cap-exhausted
campaign-c-pass.json            → APPROVE points=1 reason=ok            (1 NFT redemption)
campaign-c-fail-below-min.json  → REJECT points=0 reason=below-min-spend
```

Simulation output shows the handler's `runtime.log` lines (debug only — removed for production) and ends with the verdict, e.g.:

```
[USER LOG] secret loaded (27 chars)
[USER LOG] payload: campaign=1 user=0x1234... merchant=burgera amount=30 earnedInWindow=0
[USER LOG] eligibility: ok eligible=true points=5
✓ Workflow Simulation Result: "APPROVE points=5 reason=ok"
```

### Mock payloads

Per-campaign POS payloads live in `wizard/test-payloads/` (one file per campaign × scenario). The campaign terms live in the `campaigns` map inside the config files:

- `wizard/config.staging.json` → `--target=staging-settings`
- `wizard/config.production.json` → `--target=production-settings`

Each payload is a request body `{ campaignId, userAnchor, merchantId, amountSpent, timestamp, earnedInWindow, items }`. `earnedInWindow` is how much the user already earned in the current reset window (0 after a rollover). Edit the JSON to test different scenarios (below/above min-spend, window edges, disallowed day, cap exhaustion).

---

## Useful commands

```bash
# CRE: list chains + mock forwarders for your tenant
cre workflow supported-chains

# CRE: compile a workflow to WASM
cre workflow build ./wizard

# CRE: deploy a workflow to the Workflow Registry (real, requires staging/prod target)
cre workflow deploy ./wizard --target=staging-settings
```

## Notes

- **N-participant campaign support (production).** This demo UI and local backend hardcode a **2-participant** model: Company A (POS) and Company B (reward), with a single `feeSplitBps` for Company A and Company B receiving the remainder. The underlying contracts (`CampaignFactory` / `CampaignEscrow`) and the CRE workflow are **already N-party** (see the `campaigns` map keyed by `campaignId`, the `participants` array in the frontend, and the spec's N-party design), but the demo's fee-split input, the wizard's two-brand `description.participants`, and the launch validation only exercise the 2-party case. In production this would generalize to a per-participant fee-share array and an arbitrary number of participating brands.
- `runtime.log` calls are for simulation/testing only and **must be removed** before production (enclave logs are hidden in real execution anyway).
- The workflow is **HTTP-triggered** and serves multiple campaigns from one binary: the config holds a `campaigns` map keyed by `campaignId`, and each request body selects the campaign. Production per-campaign isolation (one workflow per campaign for billing/blast-radius) is a *deployment* choice, not a code limitation — the same binary can be deployed once per campaign, each with its own config, or once for all.
- **New campaigns after a workflow is live** require a config update + `cre workflow deploy` (workflow versions on deploy): a campaign created *after* deployment is not in the baked `campaigns` map, so its payloads fail with `Unknown campaignId`. The production roadmap is to drop the baked config and have the enclave **read campaign terms on-chain from the factory at request time** (`campaigns(id)` via `evmClient.callContract` — the factory is the single stable "workflow master" address), so new campaigns register on-chain and are picked up with zero redeploys.
- All on-chain writes via the CRE workflow (`EVMClient.writeReport`) are currently **commented** until the receiver contract (`IReceiver`-compatible `CampaignEscrow`) is deployed on Base Sepolia.
- The `totalRedeemCap` and the reset-window *boundary* are carried in config and enforced by the caller/escrow; the workflow clamps the per-user cap against the caller-supplied `earnedInWindow`.
- **Gas & the operating deposit (production roadmap).** In this demo the platform wallet (an EOA) pays all gas directly and the `OperatingDeposit` is a *recorded* amount owed by each company to the platform reserves (settled off-chain — no ETH moves on-chain; the companies never touch wallets). In production the roadmap is: companies deposit **USDC** (via Stripe/Coinbase fiat rails) into platform custody, and an **ERC-4337 paymaster — e.g. Coinbase Developer Platform's, billed in USDC — sponsors all campaign gas**, so neither the platform nor the companies hold ETH and deposits are USDC-denominated (no bear-market exposure on held deposits). Trade-off, honestly stated: the DIY alternative (platform holds a small ETH float, tops up from USDC periodically) avoids paymaster fees and smart-account (4337) constraints but reintroduces an ETH treasury to manage; the paymaster buys zero-ETH friction at a per-tx fee. Either way, deposits are **custody, not revenue** — unspent deposits refund to the company at campaign end.
- **Pricing follow-through (business model).** The demo contract's `platformFeeBps` (10% uplift in the demo terms) exists as a *cost-plus buffer*: gas + an ETH-volatility premium so the platform doesn't bleed out while holding a float. Once gas is USDC-denominated (paymaster or periodic swap), that buffer's reason disappears and the platform fee drops to a thin value-based margin (e.g. ~1.5%, or 0% as a deliberate growth subsidy) — the fee is just a per-campaign parameter in `CampaignTerms`, so infrastructure savings flow straight through to customer pricing without code changes.