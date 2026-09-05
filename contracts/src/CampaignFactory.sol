// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {CampaignEscrow} from "./CampaignEscrow.sol";
import {CampaignReward} from "./CampaignReward.sol";

/// @title CampaignFactory
/// @notice Master factory for B2BCampaignFactory — deploys configured campaign clones.
/// @dev Each campaign = one EIP-1167 clone of the CampaignEscrow implementation + one
///      CampaignReward (ERC-1155) deployed in the same transaction (isolated mint authority).
///      Deployment gas is paid by whoever calls (the platform's Privy server wallet in the
///      demo — "gas sponsored by the platform", the demo WOW moment).
contract CampaignFactory {
    /*//////////////////////////////////////////////////////////////
                                ERRORS
    //////////////////////////////////////////////////////////////*/

    error CampaignFactory__InvalidTokenId(uint256 tokenId);
    error CampaignFactory__InvalidUri();

    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/

    event CampaignCreated(uint256 indexed campaignId, address indexed escrow, address indexed reward);

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
    /// @return campaignId Incrementing id. The escrow's rewardTokenId = campaignId * REWARD_TOKEN_RANGE
    ///         (reserved range per campaign — no collision across campaigns).
    function createCampaign(
        CampaignEscrow.CampaignTerms calldata terms_,
        address workflowOwner_,
        string calldata rewardUri_
    ) external returns (uint256 campaignId) {
        if (bytes(rewardUri_).length == 0) revert CampaignFactory__InvalidUri();

        campaignId = nextCampaignId++;
        uint256 tokenId = campaignId * REWARD_TOKEN_RANGE; // tokenId 0 reserved
        if (tokenId == 0) revert CampaignFactory__InvalidTokenId(tokenId);

        // Clone the escrow implementation.
        address escrow = Clones.clone(escrowImplementation);

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

        emit CampaignCreated(campaignId, escrow, address(reward));
    }
}