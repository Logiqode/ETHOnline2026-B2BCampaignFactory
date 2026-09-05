# Wizard - ETHOnline 2026 Demo and Presentation Outline

> **Status:** Consolidated demo outline for ETHOnline 2026 (From Scratch submission).
> **Companion doc:** Wizard_TechnicalSpec.md (single source of truth for architecture and sponsor-track requirements). This outline is the presentation companion to that spec.
> **Primary sponsor tracks:** Chainlink CRE / Confidential Workflows - Privy (Best B2B Financial Product) - Privy (Best Financial Flow).
> **Scope of the 4-minute video:** cashback (Bpoints) model only - time is limited. The badge model is telegraphed in one beat and fully covered in the Deep-Dive Appendix.

---

## Demo Goal

The demo proves one thesis:

> **Two enterprises can run a cross-brand campaign without exchanging raw customer transaction data or building a bespoke bilateral integration - and the same factory handles any campaign shape.**

The presentation prioritizes a working end-to-end vertical slice over production completeness.

---

## Product Shape (what the demo shows)

The demo is a **single polished web app** ("the factory console") that plays all three roles via tabs/views:

- **Brand A console** - configure and deploy a campaign.
- **Customer portal** - make a purchase, watch the confidential check, receive the reward.
- **Brand B page** - redeem the reward (the Privy financial flow).

The integration story is shown as a code panel to convey the developer experience; the SDK package itself is **not built** for the hackathon (documented in the README, deferred). **The factory is the hero.** The customer identity is provided by Privy (embedded wallet), the confidential verification by Chainlink CRE, and the settlement record lives on Base Sepolia.

---

## Fictional Brand Convention (use throughout)

Use fictional brands in all copy. No real logos, no "partner" language, no real IP.

- **Cashback demo (the full in-video flow):** "Acme Coffee" (Brand A) and "Globex Books" (Brand B).
- **Badge demo (one telegraphed beat):** "Galaxy Rivals" (a game studio) x "CineMax" (a national cinema chain) - "watch the movie, unlock limited-time cosmetics."

---

# 4-Minute Demo Script (Cashback Model)

## 0:00-0:45 - Problem and Universal Protocol Vision

### Visual
Show Brand A and Brand B as separate data silos. Show the identity-fragmentation problem (same person, a Yahoo email at one brand, a Google email at another). Transition into the factory console with the SDK layer sitting above Chainlink CRE and Privy.

### Script
> "Cross-brand co-marketing forces enterprises into risky database sharing or expensive custom API builds. And even when a brand wants to reward its customers, they cannot link the same person across companies - a Yahoo address at one brand, a Google address at another. Wizard is an open-source enterprise protocol built natively on Chainlink CRE and Privy. It replaces centralized data exchange with confidential TEE workflows, unified identity, and immutable on-chain state on Base Sepolia."

### Message to Land
The problem is **enterprise coordination, data sharing, and identity fragmentation** - not simply coupons or loyalty points.

---

## 0:45-1:30 - Factory Deployment and Identity

### Visual
Split screen:
- **Left:** the factory console - configure a campaign: "Acme Coffee to Globex Books. 10% cashback in Bpoints. Min spend $10 pre-tax. Capped to 100 Bpoints per customer during the campaign period. 1 Bpoint is equivalent in value to $1." Below the configured fields, the rule editor lists the **full production rule catalog** (cumulative visits, day-of-week, Pay-with-Purchase, buy specific product, member tier, refer-a-friend, birth month, reward shapes, etc.) with every rule except the two enabled ones (**Minimum spend**, **Campaign window**) **greyed out / disabled**. This is **frontend-only presentation** - the disabled rules are static UI, no backend, no contract, no workflow logic behind them.
- **Right:** `CampaignFactory.createCampaign()` deploying a campaign clone on Base Sepolia. Show the new campaign address.

**WOW FACTOR (the money shot):** "Launch Campaign" is a single click. The platform's Privy server wallet sends the factory transaction and pays the deployment gas - **gas sponsored by the platform**, no brand wallet, no gas setup. Within a second the new campaign clone's address appears on the Base Sepolia explorer. One click turns a config into deployed, funded infrastructure - that is the MasterFactory moment.

### Script
> "Integration takes minutes. A Web2 developer uses the platform integration; a brand deploys a campaign clone with its terms in seconds. The factory understands every campaign shape - here we enable two rules. Each customer signs in with Privy - one tap - and gets a stable wallet identity that works across both brands."

### Demo Action
Create the campaign: show the resulting campaign instance/address and the configured terms.

### Message to Land
The factory turns campaigns into configurable protocol instances, and Privy gives every customer a portable, pseudonymous identity - no CRM syncing.

---
## 1:30-2:30 - CRE Confidential Workflow / Privacy Boundary (the Chainlink proof)

### Visual
Split screen:
- **Left:** the simulated/raw JSON receipt payload (customer wallet, merchant, amount, pre-tax total, timestamp, items).
- **Right:** CRE CLI execution logs showing the confidential workflow (`handlerInTee`): secret fetch from the Vault DON, rule evaluation, cumulative-cap check, nullifier generation, clean `evm.write` parameters.

### Example Payload
```json
{
  "customerId": "wallet:0xabc...",
  "merchant": "acme-coffee",
  "amountSpend": 12.00,
  "timestamp": "...",
  "items": ["latte", "pastry"]
}
```

### Script
> "When a customer spends $12 at Acme Coffee, the POS submits a payload for confidential processing. The CRE workflow authenticates and decrypts it inside the enclave, checks the campaign rules and the cumulative cap - how much this customer has already earned - and keeps the underlying receipt data off the blockchain. (Demo receipts are tax-free for clarity.)"

### Demo Action
Show:
```text
Purchase: $12
Min spend: $10  PASS
Cap remaining: $20  PASS
Cashback: 1.20 Bpoints

Eligible - evm.write
```
Then show the on-chain transaction being triggered. **Optional second beat (if time permits):** a later purchase hitting the cap and earning 0 - proving stateful confidential computation.

### Message to Land
The blockchain receives the **result/state transition**, not the raw customer receipt.

### Important Wording
Do not call the output a zero-knowledge proof unless the implementation actually generates one. Prefer: *confidential verification*, *attested result*, *verified state transition*, *execution result*.

---

## 2:30-3:30 - The Reward Lands (the Privy proof)

### Visual
Show the customer's Privy embedded wallet receiving the minted Bpoints. Then show the mint event on Base Sepolia (CampaignEscrow -> CampaignReward ERC-1155).

### Script
> "Upon verification, the confidential workflow writes the result to CampaignEscrow, which mints Bpoints directly into the customer's embedded Privy wallet - no manual steps, no wallet management."

### Demo Action
Show the on-chain mint (CampaignReward ERC-1155) and the Bpoints balance in the customer's wallet.

### Message to Land
The reward is a real on-chain asset with provenance - not just a number in a database.

---

## 3:30-4:00 - Redemption and Closing (the Financial Flow plus B2B proof)

### Visual
Switch to the **Brand B (Globex Books) page**. Show the customer's Bpoints balance and a "Redeem" button. On click, show the policy-gated Privy wallet action firing in the background, then the reward settling to the customer's wallet.

### Script
> "At Company B, the customer redeems their Bpoints with one click. A policy-gated Privy wallet action settles the reward automatically - no manual wire transfers, no custom integrations. Every step is confidential, automated, and recorded on-chain."

### Closing Slide
```text
Wizard

Private verification.   (Chainlink CRE)
Unified identity.       (Privy)
Programmable campaigns. (Factory)
Persistent settlement.  (Base Sepolia)

Open-source.
```

### Message to Land
This is zero-trust-oriented, automated enterprise co-marketing - powered by Chainlink CRE for confidentiality and Privy for identity and settlement.

---

# Demo Architecture Visual

```text
+---------------+
|   Brand A     |
|    POS/API    |
+-------+-------+
        |
        | Private receipt + Privy wallet address
        v
+-----------------------+
| Chainlink CRE         |
| Confidential Workflow |
|                       |
| Fetch secret (Vault)  |
| Read cumulative state |
| Evaluate rules + cap  |
| Generate nullifier    |
+-----------+-----------+
            | evm.write
            v
+-----------------------+
| Base Sepolia          |
| Factory -> Escrow     |
| -> Reward (ERC-1155)  |
+-----------+-----------+
            |
            v
+-----------------------+
|      Brand B          |
| Privy policy-gated    |
| redemption / payout   |
+-----------------------+
```

---

# What the Demo Must Prove

Prioritize these five things:

1. **Campaign creation works** (factory deploys a clone).
2. **A transaction payload enters the confidential workflow** (`handlerInTee`).
3. **Eligibility is actually evaluated** (rules plus cumulative cap).
4. **CRE actually causes an EVM state change** (mint).
5. **Brand B can act on the resulting state** without receiving the raw receipt (redemption).

If time is limited, these matter more than additional UI features.

---

# Sponsor Track Evidence (Deep-Dive Appendix - not in the 4-minute cut)

Partner judges evaluate the **submission** (video, repo, source, explanation), not only the live demo. Put the proof here:

- **Chainlink:** `handlerInTee` source, `cre workflow simulate` terminal output, the read-compute-write loop with the cumulative cap, clean `evm.write` params.
- **Privy Financial Flow:** the redemption is a real Privy wallet action (transfer/payout) to the user's embedded wallet, shown via Company B's page. Must be a generally-available (GA) feature.
- **Privy B2B Product:** campaign escrow is a **Privy organization/server wallet** with **policies** (allowlist, max amount, only-after-on-chain-eligibility) and optional **quorum/signers** on campaign funding. Show the policy config and an automated event-driven payout.
- **Badge model (telegraphed only in video):** one screen - "same factory, different campaign: Galaxy Rivals x CineMax, watch the movie, earn the limited-edition badge." Show the badge minting to the wallet. Full redemption/action covered here in the appendix.

---
# What Not to Spend Hackathon Time On

Do not prioritize before the core vertical slice works:

- Full enterprise POS integrations.
- Dozens of campaign predicates.
- Production-grade upgradeability.
- A complete payment system.
- Yield-bearing escrow.
- Sophisticated merger/acquisition tooling.
- Comprehensive customer identity systems.
- Every edge case around refunds/chargebacks.
- Full production security hardening.

These belong in the roadmap/limitations section unless required for the core demonstration.

---

# Future Work Slide

After the demo, future work can be summarized as:

### Business Validation

- Interview merchants/brands.
- Identify common eligibility predicates.
- Validate pricing and campaign economics.

### Protocol

- More campaign predicates.
- Multi-brand campaigns.
- SKU/category rules.
- Location rules.
- Campaign versioning.
- Badge reward type end-to-end.

### Identity

- Each brand runs its own Privy app + **Global Wallets** as the provider/requester bridge (avoids a single shared-app trust ask).

### Security

- Threat modeling.
- Contract audits.
- Workflow security review.
- Stronger input provenance.
- Credential/key management.

### Enterprise

- POS/CRM/loyalty integrations.
- Enterprise identity.
- Production settlement rails.

---

# Closing Judge-Facing Thesis

If a judge remembers only one sentence:

> **Wizard lets enterprises verify cross-brand campaign eligibility confidentially while keeping a shared, persistent settlement record - without requiring bilateral customer-data sharing.**

The technical story:

```text
Web2 data + Privy identity
   |
   v
CRE Confidential Compute
   |
   v
Verified campaign state
   |
   v
Base Sepolia (ERC-1155 reward)
```

The business story:

```text
No raw database sharing
No bespoke bilateral middleware
No identity fragmentation
Less manual reconciliation
Persistent campaign provenance
```

The hackathon story:

```text
Working technical proof-of-concept
        +
Open-source reference architecture
        +
Chainlink CRE + Privy as core dependencies
```


---

# Submission Checklist and Video Rules (ETHGlobal)

## Hard deadline
- **Sunday, Sep 13, 2026 12:00 PM EDT.** Late submissions are rejected. Target finishing the video and the submission form by Fri Sep 11 (24-48h buffer).

## Demo video (auto-reject risks - DO NOT)
- Length must be 2-4 minutes (auto-reject outside this band).
- Resolution at least 720p (upload fails below).
- Record your OWN voice - **AI voiceover / text-to-speech is prohibited**. This is a read-aloud script, not a TTS script.
- No sped-up footage, no music-with-text slides in place of talking, no mobile-phone screen recording.
- Keep intros under 20 seconds; edit out waiting.

## Partner prize selection (max 3)
- Select **Chainlink** and **Privy** = 2 selections; a partner with multiple tracks counts as 1, so this covers Chainlink Confidential Workflow + Privy Best Financial Flow + Privy Best B2B Financial Product.
- In the form, explain per partner how the project uses their tools, plus feedback/comments.

## Finalist judging (live, top ~20% advance)
- 4-minute demo + 3-minute Q and A (7 min total).
- Prepare: what inspired the project; what tools and why; what challenges were solved and how.
- Round-1 async judging screens; partner prizes are judged independently - you can still win them even without advancing to live.

## Judging criteria mapping
| Criterion | How Wizard scores |
|---|---|
| Technicality | CRE confidential workflow with stateful cumulative cap, identity-linked nullifiers, ERC-1155 universal rewards |
| Originality | Confidential cross-brand campaign factory + unified identity as a service; one-click gas-sponsored clone deploy |
| Practicality | Working vertical slice: mock POS, real Base Sepolia contract state, honest README scope |
| Usability | 1-tap Privy login, one-click campaign deploy, greyed-out rule catalog, one-button redemption |
| WOW Factor | One click deploys a campaign contract with deployment gas sponsored by the platform, and rewards land in a wallet |

## Version control
- Commit from the very start, incrementally, with meaningful messages. No giant single commits (disqualification risk).

## AI tooling disclosure
- Document in the repo which files were AI-assisted (spec, contracts scaffold, workflow, tests, UI, docs). The spec/planning artifacts are included in the repo as spec-driven development artifacts (required).
