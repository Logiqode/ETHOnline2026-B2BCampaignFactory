// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {CampaignReward} from "./CampaignReward.sol";

/// @title CampaignEscrow
/// @notice Per-campaign state & authorization contract for a B2B cross-brand campaign.
/// @dev Named "escrow" per the design spec; it does NOT custody assets in the demo.
///      Terms, UTXO-style ledger, and nullifier registry live here; the ERC-1155 assets
///      live in the paired CampaignReward. Mint/burn on that reward is authorized here.
///
///      SECURITY MODEL (read carefully):
///      - `claim()` is callable ONLY by the workflow-owner EOA configured at init.
///        That EOA is the address the Chainlink CRE `evm.write` capability uses to submit
///        the enclave's verdict. This contract CANNOT verify TEE attestation — attestation
///        is verified at the CRE workflow-DON level, not on-chain. If the workflow-owner
///        key is compromised, claims can be replayed/forged. This is the honest trust
///        boundary for the hackathon demo; a production contract would additionally
///        verify an on-chain report/author/forwarder (see cre-templates ReceiverTemplate).
///      - Defense-in-depth: the contract re-validates on-chain what it CAN check
///        (date window, per-user cap vs ledger, nullifier freshness) and re-computes
///        points from public terms + on-chain ledger. It CANNOT verify `amountSpent`
///        (only the enclave saw the POS payload) — that truthfulness is the enclave's job.
///
///      UTXO MODEL:
///      - `amountBalance` = unspent reward (ERC-1155 balance mirrors this)
///      - `amountSpent`    = lifetime spent; `amountSpent + amountBalance` = lifetime earned
///      - Earn (claim)   : amountBalance += points, mint tokens
///      - Spend (redeem) : amountBalance -= amount, amountSpent += amount, burn tokens
///      Lineage preserved: sum never shrinks, totalClaimed lineage == spent + balance.
contract CampaignEscrow {
    /*//////////////////////////////////////////////////////////////
                                ERRORS
    //////////////////////////////////////////////////////////////*/

    error CampaignEscrow__NotInitialized();
    error CampaignEscrow__AlreadyInitialized();
    error CampaignEscrow__InvalidWorkflowOwner();
    error CampaignEscrow__OnlyWorkflowOwner(address caller, address owner);
    error CampaignEscrow__CampaignNotLive(uint256 timestamp, uint256 start, uint256 end);
    error CampaignEscrow__CampaignEnded(uint256 timestamp, uint256 end);
    error CampaignEscrow__NullifierAlreadyUsed(bytes32 nullifier);
    error CampaignEscrow__CapExceeded(uint256 alreadyEarned, uint256 points, uint256 cap);
    error CampaignEscrow__ZeroPoints();
    error CampaignEscrow__InsufficientBalance(uint256 balance, uint256 amount);
    error CampaignEscrow__OnlyOwner(address caller, address owner);

    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/

    event Claim(bytes32 indexed nullifier, address indexed recipient, uint256 points, uint256 amountSpent);
    event Redeem(address indexed recipient, uint256 amount);

    /*//////////////////////////////////////////////////////////////
                              TYPES / STORAGE
    //////////////////////////////////////////////////////////////*/

    struct CampaignTerms {
        uint256 minSpend;   // e.g. 1000 = $10.00 (18-decimals-friendly integer)
        uint256 rateBps;    // cashback rate in basis points, e.g. 1000 = 10%
        uint256 cap;        // per-user lifetime cap in reward units
        uint64 start;       // campaign start (unix)
        uint64 end;         // campaign end (unix)
        address reward;     // paired CampaignReward (ERC-1155)
        uint256 rewardTokenId;
    }

    struct CampaignProof {
        uint256 amountSpent;   // lifetime spent
        uint256 amountBalance; // unspent balance
        uint256 originalBlock; // first participation block (provenance)
    }

    /// @notice Reset guard — every setting is stuck at its initial value after initialize().
    bool private initialized_;
    CampaignTerms public terms;

    /// @notice UTXO-style ledger: tokenId => wallet => proof.
    mapping(uint256 => mapping(address => CampaignProof)) public campaignLedger;

    /// @notice Anti-double-claim registry of used nullifiers (CRE enclave computes them).
    mapping(bytes32 => bool) public usedNullifiers;

    /// @notice The dedicated EOA that CRE `evm.write` submits verdicts from.
    address public workflowOwner;

    /*//////////////////////////////////////////////////////////////
                              INITIALIZER
    //////////////////////////////////////////////////////////////*/

    /// @param terms_ Campaign terms (all public; agreed by both brands at launch).
    /// @param workflowOwner_ The CRE workflow-owner EOA (dedicated claim submitter).
    function initialize(CampaignTerms calldata terms_, address workflowOwner_) external {
        if (initialized_) revert CampaignEscrow__AlreadyInitialized();
        initialized_ = true;
        if (workflowOwner_ == address(0)) revert CampaignEscrow__InvalidWorkflowOwner();
        if (terms_.rateBps == 0) revert CampaignEscrow__ZeroPoints();
        terms = terms_;
        workflowOwner = workflowOwner_;
    }

    /*//////////////////////////////////////////////////////////////
                               ADMIN
    //////////////////////////////////////////////////////////////*/

    /// @notice Demo-scope admin: reassign the claim submitter. Owner = init caller
    ///         (factory), who may be a platform EOA/Privy server wallet in the demo.
    function setWorkflowOwner(address newOwner) external {
        _onlyOwner();
        if (newOwner == address(0)) revert CampaignEscrow__InvalidWorkflowOwner();
        workflowOwner = newOwner;
    }

    /*//////////////////////////////////////////////////////////////
                                CLAIM  (CRE write)
    //////////////////////////////////////////////////////////////*/

    /// @notice Record a confidential eligibility verdict from the CRE enclave.
    /// @param nullifier H(CAMPAIGN_SECRET || recipient || campaignId), enclave-computed.
    /// @param recipient The claimant's Privy embedded-wallet address (identity anchor).
    /// @param amountSpent The POS payload amount (USD, 18-decimals); ONLY the enclave
    ///                    verified it — on-chain truthfulness is the enclave's trust.
    /// @return points Reward units minted (re-computed on-chain from public terms).
    function claim(bytes32 nullifier, address recipient, uint256 amountSpent)
        external
        returns (uint256 points)
    {
        _onlyWorkflowOwner();
        _requireLive();

        if (usedNullifiers[nullifier]) revert CampaignEscrow__NullifierAlreadyUsed(nullifier);

        CampaignProof storage proof = campaignLedger[terms.rewardTokenId][recipient];
        if (proof.originalBlock == 0) proof.originalBlock = block.number;

        uint256 alreadyEarned = proof.amountSpent + proof.amountBalance;
        points = _computePoints(amountSpent, alreadyEarned);

        // Guard against underflow on ledger updates (can't go negative).
        proof.amountBalance += points;
        usedNullifiers[nullifier] = true;
        emit Claim(nullifier, recipient, points, amountSpent);

        CampaignReward(terms.reward).mint(recipient, terms.rewardTokenId, points);
    }

    /// @dev points = min(rate * amountSpent / 1e4, cap - alreadyEarned), floored at 0;
    ///      reverts if nothing left to earn (cap fully exhausted).
    function _computePoints(uint256 amountSpent, uint256 alreadyEarned) internal view returns (uint256) {
        uint256 raw = (terms.rateBps * amountSpent) / 10_000;
        uint256 remaining = terms.cap - alreadyEarned;
        uint256 points = raw > remaining ? remaining : raw;
        if (points == 0) revert CampaignEscrow__CapExceeded(alreadyEarned, raw, terms.cap);
        return points;
    }

    /*//////////////////////////////////////////////////////////////
                               REDEEM  (Privy wallet action)
    //////////////////////////////////////////////////////////////*/

    /// @notice Spend earned rewards. Called by the customer's Privy embedded wallet
    ///         (Brand B page) when redeeming. Burns tokens as "spend"; ledger preserves
    ///         lifetime lineage.
    /// @param amount Reward units to spend.
    function redeem(uint256 amount) external {
        _requireLive();
        CampaignProof storage proof = campaignLedger[terms.rewardTokenId][msg.sender];
        if (proof.amountBalance < amount) {
            revert CampaignEscrow__InsufficientBalance(proof.amountBalance, amount);
        }
        proof.amountBalance -= amount;
        proof.amountSpent += amount;

        emit Redeem(msg.sender, amount);
        CampaignReward(terms.reward).burn(msg.sender, terms.rewardTokenId, amount);
    }

    /*//////////////////////////////////////////////////////////////
                                VIEWS
    //////////////////////////////////////////////////////////////*/

    /// @notice Lifetime earned for a wallet (lineage-preserving).
    function lifetimeEarned(address wallet) external view returns (uint256) {
        CampaignProof storage p = campaignLedger[terms.rewardTokenId][wallet];
        return p.amountSpent + p.amountBalance;
    }

    /// @notice Available (unspent) balance for a wallet.
    function availableBalance(address wallet) external view returns (uint256) {
        return campaignLedger[terms.rewardTokenId][wallet].amountBalance;
    }

    /*//////////////////////////////////////////////////////////////
                               INTERNAL
    //////////////////////////////////////////////////////////////*/

    function _onlyWorkflowOwner() internal view {
        if (msg.sender != workflowOwner) revert CampaignEscrow__OnlyWorkflowOwner(msg.sender, workflowOwner);
    }

    function _onlyOwner() internal view {
        if (msg.sender != address(this)) revert CampaignEscrow__OnlyOwner(msg.sender, address(this));
    }

    function _requireLive() internal view {
        uint256 ts = block.timestamp;
        if (ts < terms.start) revert CampaignEscrow__CampaignNotLive(ts, terms.start, terms.end);
        if (ts > terms.end) revert CampaignEscrow__CampaignEnded(ts, terms.end);
    }
}