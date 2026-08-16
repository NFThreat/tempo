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
    }

    function test_subscribeMintsButNotActive() public {
        vm.prank(user);
        uint256 tid = pass.subscribe(user, keyId);

        assertEq(pass.ownerOf(tid), user);
        assertEq(pass.tokenOfOwner(user), tid);
        assertEq(pass.totalSupply(), 1);
        assertFalse(pass.isActive(tid));

        (uint256 id, bool active) = pass.holderOf(user);
        assertEq(id, tid);
        assertFalse(active);
    }

    function test_onePassPerWallet() public {
        vm.prank(user);
        pass.subscribe(user, keyId);
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(PassNFT.AlreadySubscribed.selector, user));
        pass.subscribe(user, keyId);
    }

    function test_activateSetsFirstPeriod() public {
        vm.prank(user);
        uint256 tid = pass.subscribe(user, keyId);

        vm.prank(relayer);
        pass.activate(tid);

        assertEq(pass.expiresAtOf(tid), block.timestamp + period);
        assertTrue(pass.isActive(tid));
        (uint256 id, bool active) = pass.holderOf(user);
        assertEq(id, tid);
        assertTrue(active);
    }

    function test_activateOnlyRelayer() public {
        vm.prank(user);
        uint256 tid = pass.subscribe(user, keyId);

        // without an access-key-signed tx, getTransactionKey() is 0
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(PassNFT.NotAuthorizedKey.selector, tid));
        pass.activate(tid);
    }

    function test_activateOnlyOnce() public {
        vm.prank(user);
        uint256 tid = pass.subscribe(user, keyId);
        vm.prank(relayer);
        pass.activate(tid);

        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(PassNFT.NotExpired.selector, tid));
        pass.activate(tid);
    }

    function test_renewExtendsFromCurrentExpiry() public {
        vm.prank(user);
        uint256 tid = pass.subscribe(user, keyId);
        vm.prank(relayer);
        pass.activate(tid);

        vm.warp(block.timestamp + 10 days);
        vm.prank(relayer);
        pass.renew(tid);

        // expiry extended by a full period from the previous expiry
        assertEq(pass.expiresAtOf(tid), block.timestamp - 10 days + period + period);
        assertTrue(pass.isActive(tid));
    }

    function test_renewAfterExpiryRestartsFromNow() public {
        vm.prank(user);
        uint256 tid = pass.subscribe(user, keyId);
        vm.prank(relayer);
        pass.activate(tid);

        vm.warp(block.timestamp + period + grace + 1);
        assertFalse(pass.isActive(tid));

        vm.prank(relayer);
        pass.renew(tid);

        assertEq(pass.expiresAtOf(tid), block.timestamp + period);
        assertTrue(pass.isActive(tid));
    }

    function test_renewOnlyRelayer() public {
        vm.prank(user);
        uint256 tid = pass.subscribe(user, keyId);
        vm.prank(relayer);
        pass.activate(tid);

        // without an access-key-signed tx, getTransactionKey() is 0
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(PassNFT.NotAuthorizedKey.selector, tid));
        pass.renew(tid);
    }

    function test_renewUnactivatedPassReverts() public {
        vm.prank(user);
        uint256 tid = pass.subscribe(user, keyId);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(PassNFT.NotActivated.selector, tid));
        pass.renew(tid);
    }

    function test_burnOnlyAfterExpiryPlusGrace() public {
        vm.prank(user);
        uint256 tid = pass.subscribe(user, keyId);
        vm.prank(relayer);
        pass.activate(tid);
        uint256 t0 = block.timestamp;

        // inside the billing period
        vm.warp(t0 + 10 days);
        vm.expectRevert(abi.encodeWithSelector(PassNFT.NotExpired.selector, tid));
        pass.burnExpired(tid);

        // inside the grace period
        vm.warp(t0 + period + grace / 2);
        vm.expectRevert(abi.encodeWithSelector(PassNFT.NotExpired.selector, tid));
        pass.burnExpired(tid);

        // after grace period
        vm.warp(t0 + period + grace + 1);
        pass.burnExpired(tid);

        vm.expectRevert(); // token burned
        pass.ownerOf(tid);
        (uint256 id, bool active) = pass.holderOf(user);
        assertEq(id, 0);
        assertFalse(active);
        assertEq(pass.totalSupply(), 1);
    }

    function test_burnUnactivatedReverts() public {
        vm.prank(user);
        uint256 tid = pass.subscribe(user, keyId);
        vm.warp(block.timestamp + period + grace + 1);
        vm.expectRevert(abi.encodeWithSelector(PassNFT.NotActivated.selector, tid));
        pass.burnExpired(tid);
    }

    function test_burnAllowsResubscribe() public {
        vm.prank(user);
        uint256 tid = pass.subscribe(user, keyId);
        vm.prank(relayer);
        pass.activate(tid);
        vm.warp(block.timestamp + period + grace + 1);
        pass.burnExpired(tid);

        vm.prank(user);
        uint256 tid2 = pass.subscribe(user, keyId);
        assertEq(tid2, 2);
        assertEq(pass.tokenOfOwner(user), tid2);
    }

    function test_setRelayerOnlyOwner() public {
        vm.prank(address(this));
        pass.setRelayer(user);
        assertEq(pass.relayer(), user);

        vm.prank(user);
        vm.expectRevert();
        pass.setRelayer(relayer);
    }

    function test_setBaseURI() public {
        vm.prank(user);
        uint256 tid = pass.subscribe(user, keyId);
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
