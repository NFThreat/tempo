// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Script, console2 } from "forge-std/Script.sol";
import { PassFactory } from "../src/PassFactory.sol";
import { MirrorPassNFT } from "../src/MirrorPassNFT.sol";

/// @notice Deploys the launchpad infrastructure.
///         Tempo testnet (Moderato, chain 42431): `run()` — PassFactory.
///         Ethereum (Sepolia): `runMirror()` — MirrorPassNFT for one pass.
contract Deploy is Script {
    /// pathUSD on Tempo testnet (same address on mainnet).
    address constant PATHUSD = 0x20C0000000000000000000000000000000000000;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        uint256 fee = vm.envOr("DEPLOY_FEE", uint256(0));
        vm.startBroadcast(deployerKey);
        PassFactory factory = new PassFactory(PATHUSD, fee);
        vm.stopBroadcast();
        console2.log("PassFactory deployed at", address(factory));
        console2.log("feeToken (pathUSD)", PATHUSD);
        console2.log("deployFee", fee);
    }
    /// @dev Deploy the Ethereum mirror. Set MIRROR_RELAYER to the relayer
    ///      address that will sync Tempo state (same EOA as TEMPO_RELAYER).
    function runMirror() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address mirrorRelayer = vm.envAddress("MIRROR_RELAYER");
        string memory name = vm.envOr("MIRROR_NAME", string("Tempo Pass Mirror"));
        string memory symbol = vm.envOr("MIRROR_SYMBOL", string("TPASS"));
        string memory baseURI = vm.envOr("MIRROR_BASE_URI", string("https://pass.example/mirror/"));
        vm.startBroadcast(deployerKey);
        MirrorPassNFT mirror = new MirrorPassNFT(name, symbol, baseURI, mirrorRelayer);
        vm.stopBroadcast();
        console2.log("MirrorPassNFT deployed at", address(mirror));
    }
}
