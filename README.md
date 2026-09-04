# B2BCampaignFactory

**Confidential cross-brand campaign factory** — B2B loyalty/cross-brand campaigns where two enterprises run "spend at Brand A → earn rewards redeemable at Brand B" without sharing raw customer data or building bilateral integrations.

> Scaffolded from the `hello-confidential-workflows` starter kit ([smartcontractkit/cre-templates](https://github.com/smartcontractkit/cre-templates/tree/main/starter-templates/hello-confidential-workflows), MIT). The CRE confidential workflow provides the confidential eligibility verification; settlement lives on Base Sepolia.

## Stack

| Layer | Tech |
|---|---|
| Smart contracts | Solidity 0.8.28, Foundry, OpenZeppelin v5.1 (EIP-1167 clones, ERC-1155) |
| Confidential workflow | Chainlink CRE (`handlerInTee`), TypeScript, `@chainlink/cre-sdk` 1.18 |
| Settlement | Base Sepolia (`CampaignFactory` → `CampaignEscrow` clones → `CampaignReward`) |
| Identity | Privy embedded wallets (identity anchor = wallet address) |

## Layout

```
contracts/            Foundry project (CampaignFactory, CampaignEscrow, CampaignReward, tests)
b2b-campaign-factory/ CRE workflow (workflow.ts, tests, configs)
docs/                 Technical spec + demo outline
project.yaml          CRE project settings (Base Sepolia RPCs)
secrets.yaml          CRE secret mapping
```

## Prerequisites

- [Foundry](https://book.getfoundry.sh/) — `forge` (e.g. `~/.foundry/bin/forge.exe`)
- [bun](https://bun.sh/) — used by the CRE workflow toolchain
- The `cre` CLI (Chainlink Runtime Environment, e.g. `C:\Users\<you>\AppData\Local\Programs\cre\cre`)

## Installation

```bash
# Workflow dependencies
git clone https://github.com/Logiqode/ETHOnline2026-B2BCampaignFactory.git
bun install --cwd ./b2b-campaign-factory

# Environment (required for CRE simulate)
cp .env.example .env    # fill SECRET_API_TOKEN, or export it
```

Contracts use vendored dependencies in `contracts/lib/` (via `git clone`; gitignored).

---

## Testing

### Smart contracts (Foundry)

```bash
cd contracts

# Build
~/.foundry/bin/forge build          # or: forge build (if on PATH)

# Run the test suite (20 tests: claim, cap, nullifier, window,
# redeem/redeemFor, reedeemer whitelist, decimal guard, factory wiring)
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

```bash
cd b2b-campaign-factory

# Typecheck
bun run typecheck                      # or: ./node_modules/.bin/tsc --noEmit

# Unit tests (6 tests: eligibility, window bounds, cap, logs)
bun run test                           # or: bun test

# End-to-end simulation (runs the workflow against mock payloads in a simulated TEE)
#   - the config files (config.staging.json / config.production.json) carry the mock POS payload
#   - export SECRET_API_TOKEN so the Vault-DON secret resolves
cd ..
export SECRET_API_TOKEN="test-secret-token"
cre workflow simulate ./b2b-campaign-factory --target=staging-settings -e .env
```

Simulation output shows the handler's `runtime.log` lines (debug only — removed for production) and ends with the verdict, e.g.:

```
✓ Workflow compiled
[USER LOG] secret loaded (27 chars)
[USER LOG] payload: userAnchor=0x1234... merchant=burgera amountSpent=12 items=2
[USER LOG] eligibility: ok eligible=true points=1.2000000000000002
✓ Workflow Simulation Result: "APPROVE points=1.2000000000000002 reason=ok"
```

### Mock payloads

Test-specific POS payloads live in the config files per environment:

- `b2b-campaign-factory/config.staging.json` → `--target=staging-settings`
- `b2b-campaign-factory/config.production.json` → `--target=production-settings`

Each carries a `testPayload` object (`userAnchor`, `merchantId`, `amountSpent`, `timestamp`, `items`) plus the campaign terms. Edit the JSON to test different scenarios (below/above min-spend, window edges, cap).

---

## Useful commands

```bash
# CRE: list chains + mock forwarders for your tenant
cre workflow supported-chains

# CRE: compile a workflow to WASM
cre workflow build ./b2b-campaign-factory

# CRE: deploy a workflow to the Workflow Registry (real, requires staging/prod target)
cre workflow deploy ./b2b-campaign-factory --target=staging-settings
```

## Notes

- `runtime.log` calls are for simulation/testing only and **must be removed** before production (enclave logs are hidden in real execution anyway).
- Config files bind a workflow to a campaign at deploy time (cron model); production per-campaign isolation is a deployment choice, not a code limitation.
- All on-chain writes via the CRE workflow (`EVMClient.writeReport`) are currently **commented** until the receiver contract (`IReceiver`-compatible `CampaignEscrow`) is deployed on Base Sepolia.