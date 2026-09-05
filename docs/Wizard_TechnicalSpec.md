# Wizard — Technical Specification & Agent Context

> **Status:** Consolidated build spec for ETHOnline 2026 (From Scratch submission).
> **Deadline:** Sunday, Sep 13, 2026 12:00 PM EDT. All code, demo video, and submission done by then - target Fri Sep 11 as buffer.
> **Primary sponsor tracks:** Chainlink CRE / Confidential Workflows · Privy (Best B2B Financial Product) · Privy (Best Financial Flow).
> **Ledger:** Base Sepolia (Chain ID 84532).
> **This document is the single source of truth.** It supersedes all earlier scattered notes.

---

## Implementation Scope Markers

To keep the hackathon build shippable in ~12 days, every requirement below is tagged with ONE of two markers. **The agent must treat these as hard scope. Do not silently expand.**

- **[IMPLEMENT]** - required for the demo and sponsor-track qualification. Build it.
- **[DEFERRED: README only]** - documented design decision or roadmap. Do NOT implement; describe it in the README (Design Decisions / Roadmap) to show in-depth thinking, and optionally show conceptual config in the Deep-Dive Appendix.

**Hard demo scope (v1):** static rules `minimumSpend` + `withinCampaignStartEndDate`, cashback (Bpoints) reward computation and mint **with cumulative cap**, nullifier + `CAMPAIGN_SECRET`, CRE `evm.write` to escrow then ERC-1155 mint, Privy embedded-wallet identity, redemption as a Privy wallet action, mock POS payload, and the factory-console demo app (the factory UI lists the full production rule catalog with all but the enabled rules **greyed out**). The SDK integration example is documented in the README only, not built. Campaign clone deployment is paid by the platform's Privy server wallet (demo-level "gas sponsored by the platform" - the demo WOW moment); the full operating-fund / fee-split machinery remains [DEFERRED: README only].

---

## 1. Project Vision & Core Positioning

- **Project Name:** Wizard
- **Core Framing:** An open-source, zero-trust-oriented enterprise MarTech & Attestation Protocol.
- **Primary Technology:**
  - **Chainlink CRE Confidential Workflows** (`handlerInTee`) — confidential off-chain POS verification.
  - **Privy** — unified identity anchors (embedded wallets) and automated B2B escrow/settlement.
- **Settlement / Ledger:** Base Sepolia.
- **Primary Sponsor Tracks:** Chainlink CRE / Confidential Workflows · Privy (Best B2B Financial Product) · Privy (Best Financial Flow).

### Core Business Problem

Cross-brand co-marketing normally requires custom API integrations, database sharing, sensitive customer-data exchange, and/or manual reconciliation. It also suffers from **identity fragmentation**: a single customer may exist under different emails/phones at different brands (e.g. a Yahoo address at Brand A, a Google address at Brand B), so those brands can never link that customer without sharing raw PII.

Wizard provides a reusable protocol where:

1. Brand A supplies transaction data **confidentially**.
2. CRE evaluates campaign eligibility inside a confidential execution environment (TEE).
3. **Privy provides unified identity resolution** (embedded user wallets) — the same customer is recognized across brands via a stable, pseudonymous wallet address, with no CRM syncing and no raw PII exchange.
4. Only the resulting eligibility state and deterministic nullifiers are written on-chain.
5. Brand B acts on the result via on-chain event listening and automated Privy wallet policies — without receiving Brand A's raw customer records.

### Judge-Facing Thesis (one sentence)

> **Wizard lets enterprises verify cross-brand campaign eligibility confidentially while keeping a shared, persistent settlement record — without requiring bilateral customer-data sharing or bespoke integrations.**

---

## 2. High-Level Architecture

```text
Brand A / POS
     │
     │ Private POS payload + Privy wallet address (identity anchor)
     ▼
Chainlink CRE Confidential Workflow (handlerInTee)
     │
     ├── Retrieve CAMPAIGN_SECRET via Vault DON
     ├── Read on-chain cumulative state (CampaignEscrow)
     ├── Evaluate campaign rules + cumulative cap inside enclave
     ├── Generate nullifier (anti-double-claim)
     └── evm.write: sanitized result (campaignId, nullifier, recipient, rewardAmount)
             │
             ▼
Base Sepolia: CampaignFactory → CampaignEscrow → CampaignReward (ERC-1155)
             │
             ▼
Brand B Indexer / Privy Server Wallet Policy
             │
             ├── Observe on-chain claim event
             └── Execute automated reward payout to user's embedded wallet
```

### Architectural Principles

- **Raw customer transaction data is never written to the public blockchain.** The chain stores campaign state, eligibility/claim state, settlement state, and provenance — not the underlying receipt payload.
- **The wallet address is the cross-brand identity anchor.** It is stable, pseudonymous, and naturally the on-chain `recipient`.
- **The factory is the product.** Campaigns are deployed as configured protocol instances ("clones"), not bespoke integrations.

---

## 3. Identity Layer — Privy

### Why Privy (verified against docs)

Privy provides a unified user-management system. Each user in a Privy app gets a unique **Privy DID**; all their login methods (email, phone, Google, Apple, wallets, passkeys) are *linked accounts* on a single user object. Users can link/unlink methods at any time without the DID changing. This directly solves identity fragmentation: one person = one identity, even with two emails and two phones.

**Key scoping fact:** Privy DIDs are scoped **per app**. A user at Brand A's Privy app has a different DID than at Brand B's app. The **embedded wallet address is the portable cross-brand anchor**, not the DID.

### The Identity Anchor

- **Use the Privy embedded wallet address** (`0x...`) as the stable identifier that feeds the nullifier and serves as the on-chain `recipient`. It is:
  - **Stable** — persists even if the user changes emails/phones.
  - **Pseudonymous** — an address, not an email or phone.
  - **Portable** — a public, on-chain value that any brand can reference.
  - **Verifiable** — the user proves ownership via a Privy-issued token / signature, verifiable confidentially inside the enclave.
- **Never use raw email/phone as the identity input** to nullifiers — they are mutable and are precisely the fragmentation problem.

### Cross-App Identity - [DEFERRED: README only]

Privy **Global Wallets** let a wallet be shared across Privy-powered apps (provider app shares; requester app links via `linkCrossAppAccount`). This is the sanctioned path for "each brand keeps its own Privy app." It is **gated** (provider access must be requested; app must be production; base domain required) and adds consent flows — so for the hackathon demo we use a **single shared Privy app** and document Global Wallets as the multi-brand-onboarding path.

### Identity Decision

- **Hackathon:** single shared Privy app; both brands reference the same user's embedded wallet address. Simplest and fully demoable.
- **Roadmap:** each brand runs its own Privy app + Global Wallets as the provider/requester bridge, avoiding a single shared-app trust ask.

---

## 4. Privacy Layer — Chainlink CRE

### Intended Input (confidential)

Raw Web2 POS JSON payloads may contain sensitive customer identifiers, merchant API credentials, itemized spend details, purchase timestamps, and other campaign-relevant attributes. These must never leave the enclave.

### Intended Execution (inside `handlerInTee`)

1. Receive the private payload via confidential HTTP/JSON ingress.
2. Decrypt/authenticate the payload as configured.
3. Retrieve authorized credentials/secrets (including `CAMPAIGN_SECRET`) through the Vault DON into the attested enclave.
4. **Read on-chain cumulative state** from `CampaignEscrow` (e.g. `totalClaimed` for this user in this campaign) — required for cap enforcement.
5. Evaluate campaign rules inside the confidential execution environment.
6. Generate a nullifier to prevent replay / double redemption.
7. Invoke `evm.write` with sanitized parameters to update the campaign contract.

### Privacy Boundary

```text
PRIVATE (inside TEE / enclave)
────────────────────────────────
Customer receipt (itemized SKUs, total)
Raw customer email / phone
Merchant API credentials
CAMPAIGN_SECRET
Cumulative spend / earned state (when read into enclave)
────────────────────────────────
          CRE Confidential TEE Boundary
────────────────────────────────
PUBLIC (written on-chain via Base Sepolia)
────────────────────────────────
Campaign ID
Nullifier (Keccak256)
Eligibility verdict (APPROVE / REJECT)
Recipient wallet address
Reward amount
Campaign provenance metadata
────────────────────────────────
```

### Salt / Nullifier Design (final)

**Decision:** use a **random 256-bit `CAMPAIGN_SECRET`** generated once at campaign creation — **not** a deterministic function of public campaign metadata. A deterministic salt derived from `CampaignID + BrandA_ID + BrandB_ID + StartTime + Nonce` is all public values, so it provides **zero secrecy** and allows an observer to brute-force the identity mapping. A true random secret gives cross-campaign unlinkability and blast-radius isolation.

```text
CAMPAIGN_SECRET = randomBytes32()          // generated at campaign creation
campaignIdentity  = H(CAMPAIGN_SECRET || walletAddress)
campaignNullifier = H(campaignIdentity || campaignId)
```

**`CAMPAIGN_SECRET` lives only in the CRE Vault DON / enclave.** It is never written on-chain, never placed in `.env` files distributed to both brands, and never passed in unhashed payloads.

**Honest note on the nullifier's role:** because the recipient wallet address is written on-chain alongside the nullifier, the nullifier's function is **anti-double-claim** (prevent the same wallet claiming the same campaign twice), not recipient hiding. An observer can see that a wallet participated in a campaign — this is pseudonymous-but-linkable, which is the accepted model for loyalty. Do not describe this as zero-knowledge.

### Honest Privacy Framing

- **Do not call the `evm.write` output a "zero-knowledge proof"** unless the implementation actually produces one. Prefer: *confidentially verified result*, *attested state transition*, *execution result*.
- **The workflow binary itself is NOT confidential** — only the data it computes over is. State this boundary honestly.
- Confidentially evaluating a payload does not prove the payload is truthful. Distinguish: **data confidentiality**, **input authenticity**, **computation integrity**, **double-claim prevention**, **settlement finality** — these are separate security properties.

---

## 5. Ledger Layer — Base Sepolia

### Contracts

1. **`CampaignFactory.sol`** — master factory; deploys configured campaign clones (escrow instances) with tailored terms.
2. **`CampaignEscrow.sol`** — holds campaign reward funding and verifies incoming `evm.write` calls originate from the CRE TEE enclave. Maintains on-chain nullifier mapping to prevent double-claims.
3. **`CampaignReward.sol` (ERC-1155)** — **universal reward primitive**. `mint()` restricted to `CampaignEscrow.sol` upon valid CRE `evm.write` trigger; `burn()` on redemption.

### Universal Reward Model (ERC-1155)

Not all campaigns are cashback/loyalty. A badge campaign (e.g. "watch the movie → unlock limited-time cosmetics") needs an NFT-equivalent, not fungible points. **One ERC-1155 contract handles both** via distinct `tokenId`s:

- **Fungible token ID** → Bpoints / cashback points (divisible, per-user balances).
- **Semi-fungible badge ID** → NFT-equivalent badge/voucher (one per user, preserved on-chain until redeemed).

Same contract, same escrow, same confidential flow — only the token metadata and the reward computation differ. This is what makes the product a **platform**, not a point-of-sale feature.

**Demo scope:** implement the fungible Bpoints token ID. The semi-fungible **badge** campaign path is [DEFERRED: README only] - it may appear as a telegraphed visual (pre-created example) but is not built end-to-end.

### State Model (UTXO-inspired, non-destructive)

```solidity
struct CampaignProof {
    uint256 totalClaimed;  // Total historical allocation (lifetime points/badges earned)
    uint256 totalRedeemed; // Amount consumed (points spent / badge redeemed)
    uint256 originalBlock; // Block/timestamp for provenance
}

mapping(uint256 => mapping(address => CampaignProof))
    public campaignLedger;
```

**Decision:** keep the UTXO ledger **alongside** minting (do not drop it). The ERC-1155 token is the durable on-chain asset (M&A provenance); the ledger is the accounting trail.

```text
AMOUNT_BALANCE = totalClaimed - totalRedeemed
```

Redemption increments `totalRedeemed`; it does **not** destroy the historical `totalClaimed`. This preserves participation lineage: a future acquiring company can verify historical campaign participation on-chain without a deprecated API, migrated CRM, legacy loyalty DB, or broken bilateral integration.

### Cashback Reward Computation (the confidential stateful loop)

For a cashback campaign (`rate = 10%`, `minSpend = $10`, `cap = $20`; demo uses tax-free amounts):

```text
alreadyEarned = read on-chain: campaignLedger[campaignId][walletAddress].totalClaimed
points = min( rate * purchaseAmount,  cap - alreadyEarned )
if purchaseAmount < minSpend: points = 0
```

**The cap requires reading cumulative on-chain state into the enclave** — a *read → confidential compute → write* loop. This is the strongest Chainlink-track demonstration and prevents the cap from being gamed by Brand A's reported data (do not trust cumulative spend from the payload alone).

**Tax handling note (real-world integrations only):** demo examples assume tax-free amounts for clarity. Real POS payloads may include tax; then define eligibility on a pre-tax subtotal and sanity-check it inside the enclave (e.g. `preTax + taxAmount ≈ total` within a cent, and the derived rate vs the merchant's configured Vault rate) as a consistency layer — not as proof of truthfulness.

---

## 6. Campaign Factory

A master factory creates campaign instances/clones with configurable terms. The factory UI exposes the **full production rule catalog below**; in the demo, the catalog is fully visible but every rule except the enabled ones is **greyed out** (disabled), communicating how rich the campaign factory can be while keeping the build shippable. **This is frontend-only presentation:** the disabled rules are static UI (hardcoded list, styled disabled); there is no backend, contract, workflow, or data-model logic behind them. Do not implement any logic for greyed-out rules.

### Campaign Rule Catalog

| Campaign Rule | Status |
|---|---|
| Minimum spend (`minimumSpend`) | **[IMPLEMENT]** - demo-enabled |
| Campaign date window (`withinCampaignStartEndDate`) | **[IMPLEMENT]** - demo-enabled |
| Cumulative spend within a time period | [DEFERRED: README only] - greyed out in UI |
| Minimum cumulative visits (max 1 tx per day within campaign period) | [DEFERRED: README only] - greyed out in UI |
| Day of week (weekend only / weekdays only / Tuesday only / etc.) | [DEFERRED: README only] - greyed out in UI |
| Pay-with-Purchase (spend X qualifies for Y; get Y by paying additional Z) | [DEFERRED: README only] - greyed out in UI |
| Buy a specific product (or a combination of products) | [DEFERRED: README only] - greyed out in UI |
| Is member | [DEFERRED: README only] - greyed out in UI |
| Member tier >= Tier 2 / Gold membership | [DEFERRED: README only] - greyed out in UI |
| Refer a friend | [DEFERRED: README only] - greyed out in UI |
| Rewards option: Cashback / Badge / Redeemable Badge / Flat Discount (flat discount may need no ERC-1155, or a simple participation badge) | [DEFERRED: README only] - greyed out in UI (cashback is the demo reward type) |
| Date-specific (e.g. birth month is July) | [DEFERRED: README only] - greyed out in UI |
| Participating brands, fee split, cashback rate, reward cap | config stored per campaign and used by the demo |

**Production rule semantics (all [DEFERRED: README only]):** cumulative spend within a time period; minimum cumulative visits (only up to 1 transaction per day within the campaign period); day-of-week filters (weekend only, weekdays only, Tuesday only, etc.); Pay-with-Purchase (spend X to qualify for Y, then pay an additional Z to get Y); buy a specific product or combination of products; membership status; membership tier (e.g. >= Tier 2/Gold); refer-a-friend; reward shapes (cashback, badge, redeemable badge, flat discount - flat discount may not use an ERC-1155, or just a participation badge); and date-specific triggers (e.g. customer birth month is July).

**Scope discipline:** the initial prototype implements **one** eligibility rule end-to-end, then expands incrementally:

```text
v1: minimumSpend + campaign window   [IMPLEMENT]
v2: configurable campaign parameters     [DEFERRED: README only]
v3: cumulative spend + cap (cashback)    [IMPLEMENT - confirmed]
v4: multiple predicates                  [DEFERRED: README only]
v5: factory-generated campaign instances [IMPLEMENT - the factory is the demo hero]
v6: badge reward type                    [DEFERRED: README only]
```

### Campaign Operating Fund (Gas + Usage Fees + Deposit) - [DEFERRED: README only]

**Purpose.** Every on-chain campaign action (CRE `evm.write`, ERC-1155 mints, redemptions) and every per-usage infrastructure call (Privy wallet actions, Chainlink/CRE workflow executions) costs money. Rather than either brand absorbing a surprise bill, each campaign carries a pre-funded operating deposit agreed by both parties at initialization. In the prototype the CRE workflow executes `evm.write` from the workflow-owner account; this model describes how all those costs are funded, settled between brands, and kept opaque to the customer.

**Mechanics**
- At campaign creation ("Launch Campaign"), a **$100 operating deposit** is required. In the demo, the UI auto-attaches this deposit to the launch transaction.
- The deposit is an **all-in operating fund**: gas for on-chain actions **plus** per-usage fees from infrastructure providers (Privy, Chainlink/CRE) are paid out of it, abstracted into a single bill. Campaign participants never see the provider breakdown.
- The deposit is split per a **fee-split parameter agreed at initialization** (a configurable campaign parameter, stored with the campaign). Example: 25% Company A / 75% Company B when the campaign benefits Company B (the reward/payment side) more.
- **Multisig launch (production):** the launch/deposit transaction itself requires **internal approval quorums on BOTH companies** before it finalizes - e.g. 4 of 5 approvers on Company A's side and 9 of 12 approvers on Company B's side (each company's quorum is configurable). Until **both** sides have fulfilled their multisigs, the transaction remains pending; once both quorums are satisfied, the transaction finalizes (deposits the initial operating bill per the agreed split) and the campaign is launched. In production this maps to the org-wallet **quorum approvals / intents** machinery deferred in Section 9.
- **Launch vs run:** "launching" the campaign (deploy + deposit + multisig finalization) does **not** mean the campaign runs the moment it goes live. Launch simply registers and funds the campaign; it only becomes active per its configured **campaign date window** (the `minimumSpend` + Campaign window rules from the Catalog). The campaign may go live at a later date.
- The **10% platform fee is NOT applied at deposit**. It is a **per-transaction uplift** on every tx that goes through the platform flow: a transaction costing $0.10 in gas/provider fees is charged $0.11 (gas + 10%). The deposit only holds expected operating costs; the platform fee accrues per executed transaction, not as a deposit surcharge.

**Monetization**
- The 10% per-transaction uplift is the **baseline** revenue per campaign. Primary profit comes from **dynamic tier pricing based on campaign volume** (e.g. per-verification / per-mint / per-claim pricing tiers that scale with monthly campaign volume) - not from the deposit itself.

**Top-up and pause**
- If the fund runs low, the **platform covers costs up to a defined subsidy ceiling** (`platformSubsidy`) to keep the campaign live.
- Beyond that ceiling, the workflow is **paused automatically** until the companies deposit more - or an automated billing path (e.g. Stripe) tops up the fund.

**Refund**
- Once the campaign end date passes, the **deposit is returned** (minus actual gas/usage consumed; the platform margin is earned per transaction and is not withheld from the deposit - exact remainder accounting is an implementation detail). This preserves the zero-trust, no-surprise-billing posture.

**Scope note**
- This is a product/economic design decision, **not** part of the 4-minute demo. It belongs in the README under `Design Decisions` (see Section 10) to show in-depth thought on the operational model.

---

## 7. SDK / Developer Experience - [DEFERRED: README only]

The protocol exposes a lightweight Web2-facing JS/TS integration layer (`@b2b-campaigns/sdk`):

```text
Traditional Web2 Backend
        │
        ▼
@b2b-campaigns/sdk
        │
        ▼
CRE + Campaign Contracts
```

The SDK is a **future product surface**, not a hackathon deliverable. The demo app calls CRE/Privy directly; the SDK's shape (campaign registration/configuration, payload submission, identity handling, blockchain/CRE plumbing) is documented in the README as a Design Decision and an integration example. It is not required for either partner track or the ETHGlobal finalist judging.

---

## 8. Settlement Model

```text
Brand A purchase
      ↓
Private CRE verification (identity + rules + cumulative cap)
      ↓
Eligibility proven → evm.write
      ↓
On-chain campaign state update + ERC-1155 mint
      ↓
Brand B observes/verifies on-chain state
      ↓
User redeems at Brand B's page → Privy wallet action settles reward
```

The system eliminates manual campaign reconciliation and manual wire-based settlement for the demonstrated use case. Production settlement mechanics remain scoped to what the prototype actually implements.

---

## 9. Sponsor Track Qualification Plan

### Chainlink — Best Confidential Workflow ($2,000) — STRONG FIT

| Requirement | How we meet it |
|---|---|
| CRE workflow uses Confidential Workflows meaningfully | Confidentiality *is* the product — eligibility verification on raw receipts |
| Registers a TEE handler (`handlerInTee`) | Core of the design |
| Processes sensitive input/secret inside enclave | Receipt payload, `CAMPAIGN_SECRET`, merchant credentials, cumulative spend |
| Meaningfully integrated (not a placeholder) | Enclave decides eligibility → drives `evm.write`; it is the heart |
| Evidence of simulation/deployment | `cre workflow simulate` output in demo + README |

### Privy — Best Financial Flow ($2,500) — QUALIFIES

| Requirement | How we meet it |
|---|---|
| Privy as core part | Identity anchor + settlement |
| Create/use ≥1 Privy wallet | Customer embedded wallets + Brand B settlement wallet |
| ≥1 functional financial flow (GA feature) | **User redeems Bpoints at Company B's page → policy-gated Privy wallet action transfers the reward to the user's embedded wallet.** Eligible under "transfers … other supported wallet actions." |
| Working demo + source | Planned |
| Explain how Privy improves UX | 1-tap login, no wallet management, redemption hidden behind Company B's page |

**Note:** the financial *flow* must be a real wallet action (a transfer/payout), not just a mint. The redemption step is the flow.

### Privy — Best B2B Financial Product ($2,500) — QUALIFIES (with escrow-as-wallet design)

| Requirement | How we meet it |
|---|---|
| Integrate Privy as core | Yes |
| Create/use ≥1 Privy wallet | Customer + Brand A/B organization/server wallets |
| Business/organization use case | Cross-brand B2B co-marketing |
| ≥1 functional B2B workflow | **Campaign escrow = a Privy organization/server wallet.** Brand A funds it (B2B treasury act); policies gate payouts (allowlist, max amount, only after on-chain eligibility); optional quorum approval on large funding. |
| ≥1 Privy control | **Policies** (payout gating) and optionally **quorum/signers** on campaign funding. |
| Working demo + source | Planned |
| Explain how Privy enables the product | Narrative in README + deep-dive |

**Design implication (status: [DEFERRED: README only] - finalized):** a production model would set the campaign escrow as a **Privy organization/server wallet** with policies (allowlist, max amount, only after on-chain eligibility) and optional quorum/signers. For the hackathon, the redemption is implemented as a Privy wallet action transfer; the full org-wallet policy/quorum machinery is documented in the README, not built. Primary Privy prize target is **Best Financial Flow**.

### ETHGlobal Top-10 (separate qualification)

Round-1 criteria: video presentation & quality, project live-demo quality, **proper git commit history**. Maintain a visible incremental commit trail (scaffold → contracts → CRE workflow → app → polish) with meaningful messages. Partner-track requirements are about technical substance; Top-10 is about presentation + process. The 4-minute video serves Top-10; the repo + deep-dive appendix serve the partner tracks.

---

## 10. Repository / Documentation Strategy

```text
Wizard/
├── contracts/
│   ├── CampaignFactory.sol
│   ├── CampaignEscrow.sol
│   └── CampaignReward.sol
├── cre/
│   └── campaign-eligibility/
│       ├── workflow.ts
│       ├── workflow.test.ts
│       ├── config.staging.json
│       └── config.production.json
├── src/
│   └── sdk/
│       └── index.ts               # B2B Integration SDK
├── app/                           # Web2 Demo Portal (Brand A POS & Brand B App)
├── scripts/
├── test/
├── project.yaml
├── secrets.yaml
└── README.md
```

Do not create the full production architecture before the minimal vertical slice works.

README should include a **`Design Decisions`** section capturing the load-bearing choices: identity anchor (Privy embedded wallet address), `CAMPAIGN_SECRET` rationale, ERC-1155 dual-reward model, UTXO-ledger-alongside-mint, and the **campaign operating fund** (gas + usage fees + per-transaction platform fee + multisig launch; see Section 6). The gas-deposit mechanics are a README-level design decision, not a demo beat.

---

## 11. Development Strategy

Build the smallest end-to-end vertical slice first:

```text
Simulated Brand A receipt
        ↓
CRE confidential workflow (handlerInTee)
        ↓
minimumSpend evaluation (+ cumulative cap)
        ↓
evm.write
        ↓
CampaignEscrow state update + ERC-1155 mint
        ↓
Brand B reads eligibility
        ↓
Reward redemption (Privy wallet action)
```

Only after v1 ships (see Implementation Scope Markers) does it expand toward multiple rules, campaign parameters, factory clones, and the badge reward type - all of which remain [DEFERRED: README only] for the hackathon. The SDK is deferred separately (see Section 7). Use the CRE bootcamp/tutorial as a reference for individual primitives rather than requiring complete CRE mastery before starting.

---

## 12. Security Model & Known Assumptions

This is a hackathon prototype, **not production-ready or audited**. Future security areas:

- Input authenticity & POS data provenance.
- Merchant authentication.
- Credential management & rotation.
- Replay protection.
- Nullifier correctness.
- Duplicate claim prevention.
- Malicious campaign parameters.
- Contract access control.
- Workflow authorization.
- TEE trust assumptions.
- DON assumptions.
- Reward exhaustion.
- Refund/chargeback handling.
- Campaign cancellation.
- Race conditions.
- Privacy leakage through on-chain metadata (recipient addresses are pseudonymous-but-linkable).
- Sybil/customer identity issues.
- Upgradeability risks.

**Key distinction:** confidentially evaluating a payload does not inherently prove the payload is truthful. Distinguish data confidentiality, input authenticity, computation integrity, double-claim prevention, and settlement finality as separate properties.

---

## 13. Prototype Scope / Limitations

The project is a technical proof of concept. It does not claim production security, complete enterprise integration, complete business validation, complete coverage of real-world campaign rules, or audited contracts/workflows. Future business validation should interview brands/merchants to determine which campaign predicates and integration patterns are actually common.

---

## 14. Fictional Brand Convention

**Use fictional brands for all demo examples and copy.** This avoids any implication of endorsement or partnership and keeps the focus on the platform rather than specific IP.

- **Cashback demo:** "Brand A" (e.g. a coffee shop) and "Brand B" (e.g. a bookstore), or clearly fictional names like "Acme" / "Globex."
- **Badge demo:** "a game studio × a national cinema chain" with made-up names (e.g. "Galaxy Rivals × CineMax").
- If a real company must ever be referenced: no logos, no "partner" language, and a visible "independent demo, not affiliated" footnote. For a hackathon, prefer fictional names throughout.

---

## 15. AI Tooling Disclosure and Submission Hygiene

### AI disclosure (required)
Include the required ETHGlobal disclosure that AI assistants were used for: spec/planning artifacts, boilerplate contract generation, unit-test scaffolding, SDK/type scaffolding, the CRE workflow logic, the demo app UI, and documentation. Be specific per file/area in an `AI_DISCLOSURE.md` or a README section (the rules require stating exactly which parts were AI-assisted). AI must assist, not author the whole project - keep meaningful human direction (this spec + the git history are the evidence of that direction).

### Version control hygiene (required)
Commit from the very start of the hackathon, incrementally, with meaningful messages (scaffold -> contracts -> CRE workflow -> app -> polish). No giant single commits - large single commits or missing history can disqualify. The repo proves the work happened during the event window.

### From Scratch compliance
All code is written after the hackathon start (Sep 4, 2026). The spec/planning .md files are included in the repo as spec-driven development artifacts (required and encouraged); public starter kits (e.g. `cre-templates`) are allowed. No prior project code/assets are reused. State clearly in the README what is new (build) vs. reused (public kit, spec artifacts).