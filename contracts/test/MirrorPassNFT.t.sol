// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { MirrorPassNFT } from "../src/MirrorPassNFT.sol";

contract MirrorPassNFTTest is Test {
    MirrorPassNFT mirror;
    address relayer = makeAddr("relayer");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        mirror = new MirrorPassNFT("Pass Mirror", "PASS-M", "https://pass.example/mirror/", relayer);
    }

    function test_syncMintsWhenActive() public {
        vm.prank(relayer);
        mirror.sync(1, alice, true);
        assertEq(mirror.ownerOf(1), alice);
        assertEq(mirror.sourceHolder(1), alice);
    }

    function test_syncTransfersWhenHolderChanges() public {
        vm.prank(relayer);
        mirror.sync(1, alice, true);
        vm.prank(relayer);
        mirror.sync(1, bob, true);
        assertEq(mirror.ownerOf(1), bob);
    }

    function test_syncBurnsWhenInactive() public {
        vm.prank(relayer);
        mirror.sync(1, alice, true);
        vm.prank(relayer);
        mirror.sync(1, alice, false);
        vm.expectRevert();
        mirror.ownerOf(1);
        assertEq(mirror.sourceHolder(1), address(0));
    }

    function test_syncInactiveOnMissingTokenIsNoOp() public {
        vm.prank(relayer);
        mirror.sync(99, alice, false);
        assertEq(mirror.sourceHolder(99), address(0));
    }

    function test_onlyRelayerCanSync() public {
        vm.prank(alice);
        vm.expectRevert(MirrorPassNFT.NotRelayer.selector);
        mirror.sync(1, alice, true);
    }

    function test_relayerCanUpdateItself() public {
        vm.prank(relayer);
        mirror.setRelayer(alice);
        vm.prank(alice);
        mirror.sync(1, alice, true);
        assertEq(mirror.ownerOf(1), alice);
    }

    function test_onlyRelayerCanSetBaseURI() public {
        vm.prank(alice);
        vm.expectRevert(MirrorPassNFT.NotRelayer.selector);
        mirror.setBaseURI("https://evil.example/");
    }
}
