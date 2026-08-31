// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { PassNFT } from "../src/PassNFT.sol";
import { MockToken } from "./MockToken.sol";

contract PassNFTTest is Test {
    PassNFT pass;
    MockToken token;

    address relayer = makeAddr("relayer");
    address user = makeAddr("user");
    address keyId = makeAddr("key");
    address treasury = makeAddr("treasury");
    uint96 price = 10e6; // 10.000000 (6 decimals)
    uint32 period = 30 days;
    uint32 grace = 3 days;

    function setUp() public {
        token = new MockToken("Mock USD", "MUSD", 6);
        pass = new PassNFT(
            "Pass",
            "PASS",
            "https://pass.example/metadata/",
            PassNFT.PassConfig({
                paymentToken: address(token),
                price: price,
                billingPeriod: period,
                gracePeriod: grace,
                treasury: treasury
            }),
            relayer,
            address(this)
        );
        // fund the subscriber and pre-approve the pass (as the access key would)
        token.mint(user, 1000e6);
        vm.prank(user);
        token.approve(address(pass), type(uint256).max);
    }

    function test_subscribeMintsButNotActive() public {
        vm.prank(user);
        uint256 tid = pass.subscribe(keyId);

        assertEq(pass.ownerOf(tid), user);
        assertEq(pass.tokenOfOwner(user), tid);
        assertEq(pass.totalSupply(), 1);
        assertFalse(pass.isActive(tid));

        (uint256 id, bool active) = pass.holderOf(user);
        assertEq(id, tid);
        assertFalse(active);
    }

    function test_onePassPerWallet() public {
        vm.startPrank(user);
        pass.subscribe(keyId);
        vm.expectRevert(abi.encodeWithSelector(PassNFT.AlreadySubscribed.selector, user));
        pass.subscribe(keyId);
        vm.stopPrank();
    }

    function test_subscribeMintsToCallerOnly() public {
        // subscribe() mints to msg.sender, never to a third party
        address holder = makeAddr("holder");
        vm.prank(holder);
        uint256 tid = pass.subscribe(keyId);
        assertEq(pass.ownerOf(tid), holder);
        assertEq(pass.tokenOfOwner(holder), tid);
    }

    function test_activateSetsFirstPeriodAndPullsPayment() public {
        vm.prank(user);
        uint256 tid = pass.subscribe(keyId);

        uint256 before = token.balanceOf(treasury);
        vm.prank(relayer);
        pass.activate(tid);

        assertEq(pass.expiresAtOf(tid), block.timestamp + period);
        assertTrue(pass.isActive(tid));
        assertEq(token.balanceOf(treasury), before + price);
        assertEq(token.balanceOf(user), 1000e6 - price);
    }

    function test_activateWithoutAllowanceReverts() public {
        vm.prank(user);
        uint256 tid = pass.subscribe(keyId);
        vm.prank(user);
        token.approve(address(pass), 0);

        vm.prank(relayer);
        vm.expectRevert(); // ERC20: insufficient allowance
        pass.activate(tid);
    }

    function test_activateOnlyRelayer() public {
        vm.prank(user);
        pass.subscribe(keyId);

        // without an access-key-signed tx, getTransactionKey() is 0
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(PassNFT.NotAuthorizedKey.selector, 1));
        pass.activate(1);
    }

    function test_activateOnlyOnce() public {
        vm.prank(user);
        pass.subscribe(keyId);
        vm.prank(relayer);
        pass.activate(1);

        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(PassNFT.AlreadyActivated.selector, 1));
        pass.activate(1);
    }

    function test_renewExtendsFromCurrentExpiryAndPullsPayment() public {
        vm.prank(user);
        pass.subscribe(keyId);
        vm.prank(relayer);
        pass.activate(1);

        vm.warp(block.timestamp + 10 days);
        uint256 treasuryBefore = token.balanceOf(treasury);
        vm.prank(relayer);
        pass.renew(1);

        // expiry extended by a full period from the previous expiry
        assertEq(pass.expiresAtOf(1), block.timestamp - 10 days + period + period);
        assertTrue(pass.isActive(1));
        assertEq(token.balanceOf(treasury), treasuryBefore + price);
    }

    function test_renewAfterExpiryRestartsFromNow() public {
        vm.prank(user);
        pass.subscribe(keyId);
        vm.prank(relayer);
        pass.activate(1);

        vm.warp(block.timestamp + period + grace + 1);
        assertFalse(pass.isActive(1));

        vm.prank(relayer);
        pass.renew(1);

        assertEq(pass.expiresAtOf(1), block.timestamp + period);
        assertTrue(pass.isActive(1));
    }

    function test_renewCannotStackPeriods() public {
        vm.prank(user);
        pass.subscribe(keyId);
        vm.prank(relayer);
        pass.activate(1);

        // renewing while a full period is still ahead of the cap is allowed
        // once (extends to now + 2 periods), then blocked by anti-stacking
        vm.prank(relayer);
        pass.renew(1);
        assertEq(pass.expiresAtOf(1), block.timestamp + period + period);

        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(PassNFT.NotExpired.selector, 1));
        pass.renew(1);
    }

    function test_renewOnlyRelayer() public {
        vm.prank(user);
        pass.subscribe(keyId);
        vm.prank(relayer);
        pass.activate(1);

        // without an access-key-signed tx, getTransactionKey() is 0
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(PassNFT.NotAuthorizedKey.selector, 1));
        pass.renew(1);
    }

    function test_renewUnactivatedPassReverts() public {
        vm.prank(user);
        pass.subscribe(keyId);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(PassNFT.NotActivated.selector, 1));
        pass.renew(1);
    }

    function test_burnOnlyAfterExpiryPlusGrace() public {
        vm.prank(user);
        pass.subscribe(keyId);
        vm.prank(relayer);
        pass.activate(1);
        uint256 t0 = block.timestamp;

        // inside the billing period
        vm.warp(t0 + 10 days);
        vm.expectRevert(abi.encodeWithSelector(PassNFT.NotExpired.selector, 1));
        pass.burnExpired(1);

        // inside the grace period
        vm.warp(t0 + period + grace / 2);
        vm.expectRevert(abi.encodeWithSelector(PassNFT.NotExpired.selector, 1));
        pass.burnExpired(1);

        // after grace period
        vm.warp(t0 + period + grace + 1);
        pass.burnExpired(1);

        vm.expectRevert(); // token burned
        pass.ownerOf(1);
        (uint256 id, bool active) = pass.holderOf(user);
        assertEq(id, 0);
        assertFalse(active);
        assertEq(pass.tokenOfOwner(user), 0);
        assertEq(pass.totalSupply(), 1);
    }

    function test_burnUnactivatedReverts() public {
        vm.prank(user);
        pass.subscribe(keyId);
        vm.warp(block.timestamp + period + grace + 1);
        vm.expectRevert(abi.encodeWithSelector(PassNFT.NotActivated.selector, 1));
        pass.burnExpired(1);
    }

    function test_unsubscribeClearsNonActivatedPass() public {
        vm.prank(user);
        pass.subscribe(keyId);

        vm.prank(user);
        pass.unsubscribe();

        vm.expectRevert(); // token burned
        pass.ownerOf(1);
        assertEq(pass.tokenOfOwner(user), 0);

        // can subscribe again afterwards
        vm.prank(user);
        uint256 tid2 = pass.subscribe(keyId);
        assertEq(tid2, 2);
    }

    function test_unsubscribeOnlyHolder() public {
        vm.prank(user);
        pass.subscribe(keyId);

        address other = makeAddr("other");
        vm.prank(other);
        vm.expectRevert(abi.encodeWithSelector(PassNFT.NotMinted.selector, 0));
        pass.unsubscribe();
    }

    function test_unsubscribeActivatedPassReverts() public {
        vm.prank(user);
        pass.subscribe(keyId);
        vm.prank(relayer);
        pass.activate(1);

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(PassNFT.AlreadyActivated.selector, 1));
        pass.unsubscribe();
    }

    function test_passIsSoulbound() public {
        vm.prank(user);
        pass.subscribe(keyId);

        vm.prank(user);
        vm.expectRevert(PassNFT.Soulbound.selector);
        pass.transferFrom(user, treasury, 1);
    }

    function test_burnAllowsResubscribe() public {
        vm.prank(user);
        pass.subscribe(keyId);
        vm.prank(relayer);
        pass.activate(1);
        vm.warp(block.timestamp + period + grace + 1);
        pass.burnExpired(1);

        vm.prank(user);
        uint256 tid2 = pass.subscribe(keyId);
        assertEq(tid2, 2);
        assertEq(pass.tokenOfOwner(user), tid2);
    }

    function test_setRelayerOnlyOwner() public {
        pass.setRelayer(user);
        assertEq(pass.relayer(), user);

        vm.prank(user);
        vm.expectRevert();
        pass.setRelayer(relayer);
    }

    function test_setBaseURI() public {
        vm.prank(user);
        uint256 tid = pass.subscribe(keyId);
        pass.setBaseURI("https://new.example/");
        assertEq(pass.tokenURI(tid), "https://new.example/1");
    }

    function test_rejectInvalidConfig() public {
        vm.expectRevert(PassNFT.InvalidConfig.selector);
        new PassNFT(
            "Bad",
            "BAD",
            "",
            PassNFT.PassConfig({
                paymentToken: address(0),
                price: price,
                billingPeriod: period,
                gracePeriod: grace,
                treasury: treasury
            }),
            relayer,
            address(this)
        );

        vm.expectRevert(PassNFT.InvalidConfig.selector);
        new PassNFT(
            "Bad",
            "BAD",
            "",
            PassNFT.PassConfig({
                paymentToken: address(token),
                price: 0,
                billingPeriod: period,
                gracePeriod: grace,
                treasury: treasury
            }),
            relayer,
            address(this)
        );
    }
}
