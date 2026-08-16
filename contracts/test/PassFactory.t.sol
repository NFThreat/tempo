// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { PassFactory } from "../src/PassFactory.sol";
import { PassNFT } from "../src/PassNFT.sol";
import { MockToken } from "./MockToken.sol";

contract PassFactoryTest is Test {
    PassFactory factory;
    MockToken token;

    address user = makeAddr("user");
    address relayer = makeAddr("relayer");
    address treasury = makeAddr("treasury");
    uint256 deployFee = 100e6; // 100.000000

    function setUp() public {
        token = new MockToken("Mock USD", "MUSD", 6);
        factory = new PassFactory(address(token), deployFee);
        token.mint(user, deployFee);
        vm.startPrank(user);
        token.approve(address(factory), deployFee);
        vm.stopPrank();
    }

    function _cfg() internal view returns (PassNFT.PassConfig memory) {
        return PassNFT.PassConfig({
            paymentToken: address(token),
            price: 10e6,
            billingPeriod: 30 days,
            gracePeriod: 3 days,
            treasury: treasury
        });
    }

    function test_deployPassChargesFeeAndTransfersOwnership() public {
        uint256 feeBefore = token.balanceOf(address(this));
        vm.prank(user);
        address pass = factory.deployPass("Pass", "PASS", "https://pass.example/", _cfg(), relayer);

        assertEq(factory.passCount(), 1);
        assertEq(factory.passes(0), pass);
        assertEq(factory.creatorOf(pass), user);
        // fee went to the factory owner
        assertEq(token.balanceOf(address(this)), feeBefore + deployFee);
        assertEq(token.balanceOf(user), 0);
        // pass is owned by the creator
        assertEq(PassNFT(pass).owner(), user);
        assertEq(PassNFT(pass).relayer(), relayer);
    }

    function test_deployPassWithoutFee() public {
        PassFactory free = new PassFactory(address(token), 0);
        vm.prank(user);
        address pass = free.deployPass("Pass", "PASS", "https://pass.example/", _cfg(), relayer);
        assertEq(free.passCount(), 1);
        assertEq(PassNFT(pass).owner(), user);
    }

    function test_deployFeeNotPaidReverts() public {
        // a token with no balance/approval for the deployer
        MockToken broke = new MockToken("Broke", "BRK", 6);
        PassFactory f = new PassFactory(address(broke), deployFee);
        vm.prank(user);
        vm.expectRevert();
        f.deployPass("Pass2", "PASS2", "https://pass.example/", _cfg(), relayer);
    }

    function test_setDeployFeeOnlyOwner() public {
        factory.setDeployFee(50e6);
        assertEq(factory.deployFee(), 50e6);

        vm.prank(user);
        vm.expectRevert();
        factory.setDeployFee(0);
    }

    function test_passDeployedEvent() public {
        // the PassNFT is created via CREATE as the factory's first transaction
        address expectedPass = vm.computeCreateAddress(address(factory), 1);
        vm.expectEmit(true, true, true, true);
        emit PassFactory.PassDeployed(expectedPass, user, "Pass", "PASS");
        vm.prank(user);
        factory.deployPass("Pass", "PASS", "https://pass.example/", _cfg(), relayer);
    }
}
