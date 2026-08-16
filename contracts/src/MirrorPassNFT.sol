// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @title MirrorPassNFT
/// @notice Ethereum-side mirror of a Tempo PassNFT, deployed on an EVM
///         chain (e.g. Sepolia) to maximize compatibility. The Tempo
///         contract is the canonical source of truth; a relayer watches
///         Tempo mint/burn events and calls `sync` to mirror state here.
///         On Ethereum, the pass is a compatibility claim — payment,
///         renewal and expiry all happen on Tempo.
contract MirrorPassNFT is ERC721 {
    address public relayer;
    string private _baseURI_;

    /// Last holder synced per token id.
    mapping(uint256 => address) public sourceHolder;

    event MirrorSynced(uint256 indexed tokenId, address indexed holder, bool active);

    error NotRelayer();

    constructor(
        string memory name_,
        string memory symbol_,
        string memory baseURI_,
        address relayer_
    ) ERC721(name_, symbol_) {
        relayer = relayer_;
        _baseURI_ = baseURI_;
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseURI_;
    }

    function setBaseURI(string memory baseURI_) external {
        if (msg.sender != relayer) revert NotRelayer();
        _baseURI_ = baseURI_;
    }

    function setRelayer(address relayer_) external {
        if (msg.sender != relayer) revert NotRelayer();
        relayer = relayer_;
    }

    /// @dev Mirror one token's canonical Tempo state.
    ///      active=true  -> mint if missing, transfer if holder changed.
    ///      active=false -> burn if the token exists on this chain.
    function sync(uint256 tokenId, address holder, bool active) external {
        if (msg.sender != relayer) revert NotRelayer();
        address current = _ownerOf(tokenId);
        if (active) {
            if (current == address(0)) {
                _safeMint(holder, tokenId);
            } else if (current != holder) {
                _transfer(current, holder, tokenId);
            }
            sourceHolder[tokenId] = holder;
        } else {
            if (current != address(0)) {
                _burn(tokenId);
            }
            sourceHolder[tokenId] = address(0);
        }
        emit MirrorSynced(tokenId, holder, active);
    }
}
