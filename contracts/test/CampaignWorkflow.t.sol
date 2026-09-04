// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {CampaignFactory} from "../src/CampaignFactory.sol";
import {CampaignEscrow} from "../src/CampaignEscrow.sol";
import {CampaignReward} from "../src/CampaignReward.sol";

/// @title CampaignWorkflow — integration tests for factory → escrow → reward
contract CampaignWorkflowTest is Test {
    CampaignFactory public factory;
    CampaignEscrow public escrowImpl;

    address public workflowOwner = address(0xBEEF);
    address public brandA = address(0xA11CE);
    address public brandB = address(0xB0B);
    address public customer = address(0xC0FFEE);
    address public attacker = address(0xBAD);

    uint256 public campaignId;
    address public escrowAddr;
    address public rewardAddr;
    uint256 public rewardTokenId;

    // Demo numbers: $12 spend → 1.20 Bpoints at 10% cashback, cap $20/user
    uint256 public constant MIN_SPEND = 10e18; // $10
    uint256 public constant RATE_BPS = 1000;   // 10%
    uint256 public constant CAP = 20e18;       // $20

    function setUp() public {
        vm.warp(1_700_000_000); // realistic wall-clock (2023-11-14), avoids uint64 underflow
        // Deploy escrow implementation + factory
        escrowImpl = new CampaignEscrow();
        factory = new CampaignFactory(address(escrowImpl));

        // Create a campaign: terms + workflowOwner + reward URI
        uint64 start = uint64(block.timestamp - 1 days);
        uint64 end = uint64(block.timestamp + 30 days);
        CampaignEscrow.CampaignTerms memory terms = CampaignEscrow.CampaignTerms({
            minSpend: MIN_SPEND,
            rateBps: RATE_BPS,
            cap: CAP,
            start: start,
            end: end,
            reward: address(0), // set by factory
            rewardTokenId: 0    // set by factory
        });
        campaignId = factory.createCampaign(terms, workflowOwner, "https://example.com/metadata/{id}.json");
        (escrowAddr, rewardAddr, rewardTokenId, , ) = factory.campaigns(campaignId);
    }

    /*//////////////////////////////////////////////////////////////
                              FACTORY
    //////////////////////////////////////////////////////////////*/

    function test_FactoryDeploysCloneAndReward() public view {
        assertTrue(escrowAddr != address(0), "escrow deployed");
        assertTrue(rewardAddr != address(0), "reward deployed");
        assertEq(CampaignEscrow(escrowAddr).workflowOwner(), workflowOwner, "workflowOwner wired");
        (uint256 minSpend_, uint256 rateBps_, uint256 cap_, , , address reward_, uint256 tokenId_) =
            CampaignEscrow(escrowAddr).terms();
        assertEq(rateBps_, RATE_BPS, "terms rate wired");
        assertEq(minSpend_, MIN_SPEND, "terms minSpend wired");
        assertEq(cap_, CAP, "terms cap wired");
        assertEq(reward_, rewardAddr, "terms reward wired");
        assertEq(tokenId_, rewardTokenId, "terms tokenId wired");
        assertEq(rewardTokenId, factory.REWARD_TOKEN_RANGE(), "first campaign tokenId = 1 * RANGE");
    }

    function test_FactoryMultipleCampaignsIsolateState() public {
        uint64 start = uint64(block.timestamp - 1 hours);
        uint64 end = uint64(block.timestamp + 30 days);
        CampaignEscrow.CampaignTerms memory terms = CampaignEscrow.CampaignTerms({
            minSpend: MIN_SPEND,
            rateBps: RATE_BPS,
            cap: CAP,
            start: start,
            end: end,
            reward: address(0),
            rewardTokenId: 0
        });
        uint256 id2 = factory.createCampaign(terms, workflowOwner, "https://example.com/metadata/{id}.json");
        (address escrow2, address reward2, uint256 tokenId2, , ) = factory.campaigns(id2);

        assertTrue(escrowAddr != escrow2, "distinct escrow clones");
        assertTrue(rewardAddr != reward2, "distinct reward contracts");
        assertEq(tokenId2, id2 * factory.REWARD_TOKEN_RANGE(), "tokenId range per campaign");
    }

    /*//////////////////////////////////////////////////////////////
                               REWARD GATING
    //////////////////////////////////////////////////////////////*/

    function test_RewardMintOnlyEscrow() public {
        vm.prank(workflowOwner);
        vm.expectRevert(); // attacker not escrow
        CampaignReward(rewardAddr).mint(attacker, rewardTokenId, 1e18);
    }

    function test_RewardBurnOnlyEscrow() public {
        vm.prank(customer);
        vm.expectRevert(); // attacker not escrow
        CampaignReward(rewardAddr).burn(customer, rewardTokenId, 1e18);
    }

    /*//////////////////////////////////////////////////////////////
                              CLAIM (CRE write)
    //////////////////////////////////////////////////////////////*/

    function test_ClaimMintsPoints() public {
        bytes32 nf = keccak256("nullifier-1");
        vm.prank(workflowOwner);
        uint256 points = CampaignEscrow(escrowAddr).claim(nf, customer, 12e18);

        assertEq(points, 1.2e18, "10% of $12 = 1.20");
        assertEq(CampaignReward(rewardAddr).balanceOf(customer, rewardTokenId), 1.2e18, "tokens minted");
        assertEq(CampaignEscrow(escrowAddr).availableBalance(customer), 1.2e18, "ledger balance");
        assertEq(CampaignEscrow(escrowAddr).lifetimeEarned(customer), 1.2e18, "lifetime earned");
        assertTrue(CampaignEscrow(escrowAddr).usedNullifiers(nf), "nullifier recorded");
    }

    function test_ClaimOnlyWorkflowOwner() public {
        bytes32 nf = keccak256("nullifier-2");
        vm.prank(attacker);
        vm.expectRevert(); // OnlyWorkflowOwner
        CampaignEscrow(escrowAddr).claim(nf, customer, 12e18);
    }

    function test_ClaimNullifierReuseReverts() public {
        bytes32 nf = keccak256("nullifier-3");
        vm.startPrank(workflowOwner);
        CampaignEscrow(escrowAddr).claim(nf, customer, 12e18);
        vm.expectRevert(); // NullifierAlreadyUsed
        CampaignEscrow(escrowAddr).claim(nf, customer, 12e18);
        vm.stopPrank();
    }

    function test_ClaimCapEnforced() public {
        vm.startPrank(workflowOwner);
        // Cap = $20 → 10% × $200 = $20, exactly at cap
        uint256 p1 = CampaignEscrow(escrowAddr).claim(keccak256("n1"), customer, 200e18);
        assertEq(p1, 20e18, "cap reached");
        // Next claim > cap → revert (remaining == 0)
        vm.expectRevert(); // CapExceeded / ZeroPoints
        CampaignEscrow(escrowAddr).claim(keccak256("n2"), customer, 12e18);
        vm.stopPrank();
    }

    function test_ClaimBeforeWindowReverts() public {
        uint64 start = uint64(block.timestamp + 1 days);
        uint64 end = uint64(block.timestamp + 30 days);
        CampaignEscrow.CampaignTerms memory terms = CampaignEscrow.CampaignTerms({
            minSpend: MIN_SPEND,
            rateBps: RATE_BPS,
            cap: CAP,
            start: start,
            end: end,
            reward: address(0),
            rewardTokenId: 0
        });
        uint256 id = factory.createCampaign(terms, workflowOwner, "https://example.com/metadata/{id}.json");
        (address esc, , , , ) = factory.campaigns(id);
        vm.prank(workflowOwner);
        vm.expectRevert(); // CampaignNotLive
        CampaignEscrow(esc).claim(keccak256("x"), customer, 12e18);
    }

    function test_ClaimAfterWindowReverts() public {
        uint64 start = uint64(block.timestamp - 30 days);
        uint64 end = uint64(block.timestamp - 1 days);
        CampaignEscrow.CampaignTerms memory terms = CampaignEscrow.CampaignTerms({
            minSpend: MIN_SPEND,
            rateBps: RATE_BPS,
            cap: CAP,
            start: start,
            end: end,
            reward: address(0),
            rewardTokenId: 0
        });
        uint256 id = factory.createCampaign(terms, workflowOwner, "https://example.com/metadata/{id}.json");
        (address esc, , , , ) = factory.campaigns(id);
        vm.prank(workflowOwner);
        vm.expectRevert(); // CampaignEnded
        CampaignEscrow(esc).claim(keccak256("x"), customer, 12e18);
    }

    /*//////////////////////////////////////////////////////////////
                    REDEEM (Company B, merchant-only)
    //////////////////////////////////////////////////////////////*/

    function test_RedeemBurnsAndUpdatesLedger() public {
        vm.startPrank(workflowOwner);
        CampaignEscrow(escrowAddr).claim(keccak256("n1"), customer, 12e18); // 1.20 earned
        vm.stopPrank();
        assertEq(CampaignReward(rewardAddr).balanceOf(customer, rewardTokenId), 1.2e18);

        // Authorize Brand B as the merchant redeemer
        vm.prank(address(factory));
        CampaignEscrow(escrowAddr).setRedeemer(brandB, true);

        vm.prank(brandB);
        CampaignEscrow(escrowAddr).redeemFor(customer, 1e18); // merchant spends 1.00 on user

        assertEq(CampaignReward(rewardAddr).balanceOf(customer, rewardTokenId), 0.2e18, "0.20 left");
        assertEq(CampaignEscrow(escrowAddr).availableBalance(customer), 0.2e18, "ledger balance 0.20");
        assertEq(CampaignEscrow(escrowAddr).lifetimeEarned(customer), 1.2e18, "lineage preserved (1.20)");
    }

    function test_RedeemMoreThanBalanceReverts() public {
        vm.prank(workflowOwner);
        CampaignEscrow(escrowAddr).claim(keccak256("n1"), customer, 12e18); // 1.20 earned
        vm.prank(address(factory));
        CampaignEscrow(escrowAddr).setRedeemer(brandB, true);
        vm.prank(brandB);
        vm.expectRevert(); // InsufficientBalance
        CampaignEscrow(escrowAddr).redeemFor(customer, 2e18);
    }

    function test_RedeemZeroDoesNothing() public {
        vm.prank(address(factory));
        CampaignEscrow(escrowAddr).setRedeemer(brandB, true);
        vm.prank(brandB);
        CampaignEscrow(escrowAddr).redeemFor(customer, 0);
        assertEq(CampaignEscrow(escrowAddr).availableBalance(customer), 0, "no-op");
    }

    function test_RedeemOnlyAuthorizedRedeemer() public {
        vm.prank(workflowOwner);
        CampaignEscrow(escrowAddr).claim(keccak256("n1"), customer, 12e18); // give user points
        // Customer themselves is NOT a redeemer → must revert
        vm.prank(customer);
        vm.expectRevert(); // OnlyRedeemer
        CampaignEscrow(escrowAddr).redeemFor(customer, 1e18);
        // Unauthorized attacker also reverts
        vm.prank(attacker);
        vm.expectRevert(); // OnlyRedeemer
        CampaignEscrow(escrowAddr).redeemFor(customer, 1e18);
    }

    function test_RedeemRevokedRedeemer() public {
        vm.prank(address(factory));
        CampaignEscrow(escrowAddr).setRedeemer(brandB, true);
        vm.prank(address(factory));
        CampaignEscrow(escrowAddr).setRedeemer(brandB, false);
        vm.prank(brandB);
        vm.expectRevert(); // OnlyRedeemer (revoked)
        CampaignEscrow(escrowAddr).redeemFor(customer, 1e18);
    }

    function test_RedeemZeroTargetReverts() public {
        vm.prank(address(factory));
        CampaignEscrow(escrowAddr).setRedeemer(brandB, true);
        vm.prank(brandB);
        vm.expectRevert(); // InvalidRedeemTarget
        CampaignEscrow(escrowAddr).redeemFor(address(0), 1e18);
    }
    /*//////////////////////////////////////////////////////////////
                       DECIMAL GUARD (≤ 2 decimals)
    //////////////////////////////////////////////////////////////*/

    function test_ClaimRejectsTooManyDecimals() public {
        vm.prank(workflowOwner);
        vm.expectRevert(); // TooManyDecimals — $3.125 has 3 decimals
        CampaignEscrow(escrowAddr).claim(keccak256("n1"), customer, 3.125e18);
    }

    function test_ClaimAllowsExactlyTwoDecimals() public {
        vm.prank(workflowOwner);
        uint256 points = CampaignEscrow(escrowAddr).claim(keccak256("n1"), customer, 3.25e18); // $3.25
        assertEq(points, 0.325e18, "10% of $3.25 = 0.325 Bpoints");
    }

    function test_RedeemForRejectsTooManyDecimals() public {
        vm.prank(address(factory));
        CampaignEscrow(escrowAddr).setRedeemer(brandB, true);
        vm.prank(brandB);
        vm.expectRevert(); // TooManyDecimals — $3.125 has 3 decimals
        CampaignEscrow(escrowAddr).redeemFor(customer, 3.125e18);
    }

    function test_RedeemForAllowsExactlyTwoDecimals() public {
        // Give the user 1.20 then redeem exactly 1.20 (2 decimals)
        vm.prank(workflowOwner);
        CampaignEscrow(escrowAddr).claim(keccak256("n1"), customer, 12e18); // 1.20 earned
        vm.prank(address(factory));
        CampaignEscrow(escrowAddr).setRedeemer(brandB, true);
        vm.prank(brandB);
        CampaignEscrow(escrowAddr).redeemFor(customer, 1.2e18); // 2 decimals — ok
        assertEq(CampaignEscrow(escrowAddr).availableBalance(customer), 0, "all spent");
    }
}
