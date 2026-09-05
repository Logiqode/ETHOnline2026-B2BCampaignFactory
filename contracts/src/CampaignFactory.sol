// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {CampaignEscrow} from "./CampaignEscrow.sol";
import {CampaignReward} from "./CampaignReward.sol";

/// @title CampaignFactory
/// @notice Master factory for Wizard — deploys configured campaign clones.
/// @dev Each campaign = one EIP-1167 clone of the CampaignEscrow implementation + one
///      CampaignReward (ERC-1155) deployed in the same transaction (isolated mint authority).
///      The escrow is deployed via CREATE2 with a caller-supplied salt so its address is
///      deterministic (predictable before launch). Deployment is funded by a launch-time
///      operating deposit (`msg.value`), split per a fee-split parameter between the two
///      brands' fee accounts.
contract CampaignFactory {
    /*//////////////////////////////////////////////////////////////
                                ERRORS
    //////////////////////////////////////////////////////////////*/

    error CampaignFactory__InvalidTokenId(uint256 tokenId);
    error CampaignFactory__InvalidUri();
    error CampaignFactory__InvalidFeeSplit(uint256 bps);
    error CampaignFactory__InvalidFeeAccount(address account);
    error CampaignFactory__DepositRequired(uint256 required, uint256 received);
    error CampaignFactory__InvalidSalt();

    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/

    event CampaignCreated(uint256 indexed campaignId, address indexed escrow, address indexed reward);
    event OperatingDeposit(
        uint256 indexed campaignId,
        uint256 total,
        address companyA,
        address companyB,
        uint256 companyAShare,
        uint256 companyBShare,
        uint256 feeSplitBps
    );

    /*//////////////////////////////////////////////////////////////
                              TYPES / STORAGE
    //////////////////////////////////////////////////////////////*/

    /// @notice Escrow logic implementation (clones delegate to it).
    address public immutable escrowImplementation;

    struct CampaignInfo {
        address escrow;
        address reward;
        uint256 rewardTokenId;
        uint64 start;
        uint64 end;
    }

    /// @notice campaignId => campaign info.
    mapping(uint256 => CampaignInfo) public campaigns;

    uint256 public nextCampaignId = 1; // tokenId 0 reserved; first campaign gets id 1

    /// @notice Per-campaign reward tokenId range — each campaign gets its own id.
    uint256 public constant REWARD_TOKEN_RANGE = 1_000_000;

    /// @notice Minimum launch-time operating deposit (18-decimals, e.g. $100 worth).
    ///         In the demo this is a small mock amount; real gas/fees are deferred.
    uint256 public constant MIN_OPERATING_DEPOSIT = 0.01 ether;

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    /// @param escrowImplementation_ The CampaignEscrow logic implementation address.
    constructor(address escrowImplementation_) {
        escrowImplementation = escrowImplementation_;
    }

    /*//////////////////////////////////////////////////////////////
                            CAMPAIGN CREATION
    //////////////////////////////////////////////////////////////*/

    /// @notice Deploy a new campaign: escrow clone + paired reward contract.
    /// @param terms_ Campaign terms (rateBps + rules, start, end).
    /// @param workflowOwner_ CRE workflow-owner EOA that will submit claims.
    /// @param rewardUri_ ERC-1155 metadata URI template (e.g. ".../{id}.json").
    /// @param salt_ CREATE2 salt for deterministic escrow address (e.g. hash of campaignId).
    /// @param companyA_ Company A (POS) fee recipient.
    /// @param companyB_ Company B (reward) fee recipient.
    /// @param feeSplitBps_ Company A's share of the operating deposit, in basis points
    ///        (0-10000); the remainder goes to Company B. e.g. 2500 = 25% A / 75% B.
    /// @return campaignId Incrementing id. The escrow's rewardTokenId = campaignId * REWARD_TOKEN_RANGE.
    function createCampaign(
        CampaignEscrow.CampaignTerms calldata terms_,
        address workflowOwner_,
        string calldata rewardUri_,
        bytes32 salt_,
        address companyA_,
        address companyB_,
        uint256 feeSplitBps_
    ) external payable returns (uint256 campaignId) {
        if (bytes(rewardUri_).length == 0) revert CampaignFactory__InvalidUri();
        if (feeSplitBps_ > 10_000) revert CampaignFactory__InvalidFeeSplit(feeSplitBps_);
        if (companyA_ == address(0) || companyB_ == address(0)) revert CampaignFactory__InvalidFeeAccount(companyA_ == address(0) ? companyA_ : companyB_);
        if (msg.value < MIN_OPERATING_DEPOSIT) revert CampaignFactory__DepositRequired(MIN_OPERATING_DEPOSIT, msg.value);

        campaignId = nextCampaignId++;
        uint256 tokenId = campaignId * REWARD_TOKEN_RANGE; // tokenId 0 reserved
        if (tokenId == 0) revert CampaignFactory__InvalidTokenId(tokenId);

        // Deterministic escrow address via CREATE2 (predictable before launch).
        address escrow = Clones.cloneDeterministic(escrowImplementation, salt_);

        // Deploy the paired reward contract, then wire the escrow's terms to it.
        CampaignReward reward = new CampaignReward(escrow, rewardUri_);
        CampaignEscrow.CampaignTerms memory termsWithReward = terms_;
        termsWithReward.reward = address(reward);
        termsWithReward.rewardTokenId = tokenId;
        CampaignEscrow(escrow).initialize(termsWithReward, workflowOwner_);

        campaigns[campaignId] = CampaignInfo({
            escrow: escrow,
            reward: address(reward),
            rewardTokenId: tokenId,
            start: terms_.start,
            end: terms_.end
        });

        // Split the operating deposit between the two brands' fee accounts.
        _splitDeposit(campaignId, msg.value, companyA_, companyB_, feeSplitBps_);

        emit CampaignCreated(campaignId, escrow, address(reward));
    }

    /// @notice Predict the escrow address a campaign would get for a given salt.
    function predictEscrowAddress(bytes32 salt_) external view returns (address) {
        return Clones.predictDeterministicAddress(escrowImplementation, salt_);
    }

    /*//////////////////////////////////////////////////////////////
                               INTERNAL
    //////////////////////////////////////////////////////////////*/

    /// @dev Forward the launch deposit to the two brand fee accounts per the fee split.
    function _splitDeposit(
        uint256 campaignId,
        uint256 total,
        address companyA,
        address companyB,
        uint256 feeSplitBps
    ) internal {
        uint256 companyAShare = (total * feeSplitBps) / 10_000;
        uint256 companyBShare = total - companyAShare;
        bool okA = true;
        bool okB = true;
        if (companyAShare > 0) (okA, ) = companyA.call{value: companyAShare}("");
        if (companyBShare > 0) (okB, ) = companyB.call{value: companyBShare}("");
        // Swallowing transfer failure is acceptable for the demo (mock split); a
        // production contract would revert and treat this as part of a guarded launch.
        okA; okB;
        emit OperatingDeposit(campaignId, total, companyA, companyB, companyAShare, companyBShare, feeSplitBps);
    }
}