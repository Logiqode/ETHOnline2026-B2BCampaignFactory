// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {CampaignEscrow} from "../src/CampaignEscrow.sol";
import {CampaignFactory} from "../src/CampaignFactory.sol";

/// @title Deploy — CampaignEscrow implementation + CampaignFactory on Base Sepolia.
/// @notice Run with a funded broadcaster:
///   forge script script/Deploy.s.sol:Deploy \
///     --rpc-url https://base-sepolia-rpc.publicnode.com \
///     --broadcast --verify  # (verification optional/etherscan key)
///
/// Env (via `--broadcast` using the default broadcaster):
///   PRIVATE_KEY / ETH_FROM — the funded deployer EOA.
/// Output: contracts/deployments/<chain-alias>.json with the factory address.
contract Deploy is Script {
    /// @notice Deterministic per-network output path, e.g. deployments/base-sepolia.json.
    function _chainAlias(uint256 chainId) internal pure returns (string memory) {
        if (chainId == 84532) return "base-sepolia";
        if (chainId == 1) return "mainnet";
        if (chainId == 31337) return "anvil";
        revert("Unsupported chain; add an alias");
    }

    function run() external {
        uint256 chainId = block.chainid;
        string memory alias_ = _chainAlias(chainId);

        vm.startBroadcast();
        // Escrow is an implementation behind EIP-1167 clones — never used directly.
        CampaignEscrow escrowImpl = new CampaignEscrow();
        CampaignFactory factory = new CampaignFactory(address(escrowImpl));
        vm.stopBroadcast();

        // Record the deployment for the backend/wizard to consume.
        // The workflow-owner address is intentionally NOT part of the factory
        // (it's per-campaign at createCampaign time); record the broadcaster
        // for reference — the backend passes it as workflowOwner_.
        address broadcaster = msg.sender;

        string memory json = "deployment";
        vm.serializeAddress(json, "factory", address(factory));
        vm.serializeAddress(json, "escrowImplementation", address(escrowImpl));
        vm.serializeAddress(json, "deployer", broadcaster);
        vm.serializeUint(json, "chainId", chainId);
        string memory written = vm.serializeUint(json, "deployedAt", block.timestamp);

        string memory dir = "./deployments";
        vm.createDir(dir, true);
        vm.writeJson(written, string.concat(dir, "/", alias_, ".json"));

        console2.log("=== Wizard deployed to chain", chainId);
        console2.log("factory:              ", address(factory));
        console2.log("escrowImplementation: ", address(escrowImpl));
        console2.log("deployment JSON:      ", string.concat(dir, "/", alias_, ".json"));
    }
}
