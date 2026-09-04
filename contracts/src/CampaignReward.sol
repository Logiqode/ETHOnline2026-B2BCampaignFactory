// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";

/// @title CampaignReward
/// @notice Per-campaign universal reward asset (ERC-1155). One contract per campaign clone.
/// @dev Mint & burn authority is isolated to this campaign's CampaignEscrow.
///      Burn acts as "spend" on redemption: tokens are burned-as-spent, but the escrow's
///      UTXO-style ledger preserves lifetime totals for M&A provenance (spec §5 State Model).
contract CampaignReward is ERC1155 {
    /*//////////////////////////////////////////////////////////////
                                ERRORS
    //////////////////////////////////////////////////////////////*/

    error CampaignReward__CallerNotEscrow(address caller, address escrow);

    /*//////////////////////////////////////////////////////////////
                                STORAGE
    //////////////////////////////////////////////////////////////*/

    /// @notice The CampaignEscrow clone authorized to mint (claims) and burn (redemptions).
    address public immutable ESCROW;

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    /// @param escrow_ The campaign's escrow clone — sole mint/burn authority.
    /// @param uri_ Metadata URI template, e.g. "https://.../api/metadata/{id}.json"
    constructor(address escrow_, string memory uri_) ERC1155(uri_) {
        if (escrow_ == address(0)) revert CampaignReward__CallerNotEscrow(address(0), address(0));
        ESCROW = escrow_;
    }

    /*//////////////////////////////////////////////////////////////
                           MINT / BURN (escrow-gated)
    //////////////////////////////////////////////////////////////*/

    /// @notice Mint reward tokens to a claimant. Callable only by this campaign's escrow,
    ///         i.e. only after a valid confidential eligibility verification (CRE write).
    function mint(address to, uint256 id, uint256 amount) external {
        _escrowOnly();
        _mint(to, id, amount, "");
    }

    /// @notice Burn tokens as "spend" on redemption. Callable only by this campaign's escrow,
    ///         which validates the UTXO ledger (available = unspentBalance) first.
    function burn(address from, uint256 id, uint256 amount) external {
        _escrowOnly();
        _burn(from, id, amount);
    }

    /*//////////////////////////////////////////////////////////////
                               INTERNAL
    //////////////////////////////////////////////////////////////*/

    function _escrowOnly() internal view {
        if (msg.sender != ESCROW) revert CampaignReward__CallerNotEscrow(msg.sender, ESCROW);
    }
}