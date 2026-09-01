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
    address attacker = makeAddr("attacker");
    address treasury = makeAddr("treasury");
    uint96 price = 10e6; // 10.000000 (6 decimals)
    uint32 period = 30 days;
    uint32 grace = 3 days;

    function setUp() public {
        token = new MockToken("Mock USD", "MUSD", 6);
        pass = new PassNFT(
            "Pass",
            "PASS",
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
        // the subscriber funds the recurring mandate (keychain limit caps it)
        token.mint(user, 1000e6);
    }

    function test_subscribeMintsButNotActive() public {
        vm.prank(user);
        uint256 tid = pass.subscribe(keyId);

        assertEq(pass.ownerOf(tid), user);
        assertEq(pass.tokenOfOwner(user), tid);
        assertEq(pass.keyIdOf(tid), keyId);
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

    function test_activateByRelayerMarksPeriodPaid() public {
        vm.prank(user);
        pass.subscribe(keyId);

        // in production the relayer batch also transfers price -> treasury,
        // signed by the access key within the keychain recurring limit
        vm.prank(relayer);
        pass.activate(1);

        assertEq(pass.expiresAtOf(1), block.timestamp + period);
        assertTrue(pass.isActive(1));
    }

    function test_activateOnlyRelayerOrKey() public {
        vm.prank(user);
        pass.subscribe(keyId);

        // an EOA tx has no transaction key (root key = 0) != keyId -> revert
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(PassNFT.NotAuthorizedKey.selector, 1));
        pass.activate(1);

        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(PassNFT.NotAuthorizedKey.selector, 1));
        pass.activate(1);

        vm.prank(relayer);
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

    function test_renewByRelayerOnlyWhenExpired() public {
        vm.prank(user);
        pass.subscribe(keyId);
        vm.prank(relayer);
        pass.activate(1);

        // cannot renew while the period is still running: the keychain
        // recurring limit rolls over only at period end
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(PassNFT.NotExpired.selector, 1));
        pass.renew(1);

        vm.warp(block.timestamp + period + 1);
        vm.prank(relayer);
        pass.renew(1);

        assertEq(pass.expiresAtOf(1), block.timestamp + period);
        assertTrue(pass.isActive(1));
    }

    function test_renewByAttackerReverts() public {
        vm.prank(user);
        pass.subscribe(keyId);
        vm.prank(relayer);
        pass.activate(1);

        vm.warp(block.timestamp + period + 1);
        vm.prank(attacker);
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

        // after grace period — anyone, not just the holder
        vm.warp(t0 + period + grace + 1);
        vm.prank(attacker);
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

        vm.prank(attacker);
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

    function test_tokenURIIsOnchainJson() public {
        vm.prank(user);
        pass.subscribe(keyId);

        string memory uri = pass.tokenURI(1);
        bytes memory prefix = bytes("data:application/json;base64,");
        assertEq(bytes(uri).length > prefix.length, true);
        for (uint256 i; i < prefix.length; ++i) {
            assertEq(bytes(uri)[i], prefix[i]);
        }
    }

    function test_tokenURIEscapesUserInput() public {
        PassNFT evil = new PassNFT(
            'Bad"><script>',
            "BAD",
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
        address holder = makeAddr("holder");
        vm.prank(holder);
        evil.subscribe(keyId);
        uint256 tid = evil.tokenOfOwner(holder);

        // base64 payload must contain no raw angle brackets from the name
        string memory uri = evil.tokenURI(tid);
        bytes memory b = bytes(uri);
        for (uint256 i = 30; i < b.length; ++i) {
            bytes1 c = b[i];
            bool ok = (c >= "A" && c <= "Z") || (c >= "a" && c <= "z") || (c >= "0" && c <= "9") || c == "+" || c == "/" || c == "=";
            assertTrue(ok);
        }
    }

    function test_rejectInvalidConfig() public {
        vm.expectRevert(PassNFT.InvalidConfig.selector);
        new PassNFT(
            "Bad",
            "BAD",
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
