// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Script, console2 } from "forge-std/Script.sol";
import { PassFactory } from "../src/PassFactory.sol";
import { PassNFT } from "../src/PassNFT.sol";

/// @notice Deploys a PassFactory (fee 0) + one demo pass on the local
///         Tempo chain (anvil --tempo) or testnet. Set DEMO_RELAYER and
///         optionally DEMO_TREASURY.
contract DeployDemo is Script {
    address constant PATHUSD = 0x20C0000000000000000000000000000000000000;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address relayer = vm.envAddress("DEMO_RELAYER");
        address treasury = vm.envOr("DEMO_TREASURY", address(0));
        if (treasury == address(0)) treasury = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);
        PassFactory factory = new PassFactory(PATHUSD, 0);
        PassNFT.PassConfig memory cfg = PassNFT.PassConfig({
            paymentToken: PATHUSD,
            price: 10e6, // 10 pathUSD per period
            billingPeriod: 30 days,
            gracePeriod: 3 days,
            treasury: treasury
        });
        address pass = factory.deployPass("Demo Pass", "DEMO", "https://pass.example/metadata/", cfg, relayer);
        vm.stopBroadcast();

        console2.log("PassFactory deployed at", address(factory));
        console2.log("DemoPass deployed at", pass);
        console2.log("DemoPass relayer", relayer);
        console2.log("DemoPass treasury", treasury);
    }
}
