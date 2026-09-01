// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Base64 } from "@openzeppelin/contracts/utils/Base64.sol";
import { Strings } from "@openzeppelin/contracts/utils/Strings.sol";

/// @title PassNFT
/// @notice Subscription NFT pass on Tempo, powered by the protocol's native
///         recurring-payment primitive: the Account Keychain.
///
///         The subscriber authorizes a scoped P256 access key with a
///         RECURRING SPEND LIMIT enforced by the keychain precompile: the key
///         can transfer at most `price + buffer` of the payment token to this
///         pass's treasury per billing period, and only call
///         `activate`/`renew` on this pass. Every period the relayer signs
///         `transfer(treasury, price) + renew` with that key — a direct debit
///         the protocol caps and the holder can revoke at any time.
///
///         One pass per wallet (soulbound). Unpaid passes expire and can be
///         burned by anyone after the grace period. Metadata is generated
///         fully onchain (SVG + JSON as a base64 data URI).
contract PassNFT is ERC721, Ownable {
    struct PassConfig {
        /// TIP-20 stablecoin used for payments (e.g. pathUSD).
        address paymentToken;
        /// Price per billing period, in paymentToken base units (6 decimals).
        uint96 price;
        /// Length of one subscription period in seconds.
        uint32 billingPeriod;
        /// Seconds after expiry before the pass can be burned.
        uint32 gracePeriod;
        /// Receives all subscription payments.
        address treasury;
    }

    /// Account Keychain precompile (Tempo protocol).
    address internal constant KEYCHAIN = 0xaAAAaaAA00000000000000000000000000000000;

    PassConfig public config;
    /// Operator fallback for activate/renew (e.g. manual reactivation).
    address public relayer;

    /// Sequential token ids, starting at 1. Never reused.
    uint256 public totalSupply;
    mapping(uint256 => uint256) public expiresAtOf;
    /// One pass per wallet (kept in sync by _update; passes are soulbound).
    mapping(address => uint256) public tokenOfOwner;
    /// Access key authorized by the subscriber for this pass.
    mapping(uint256 => address) public keyIdOf;

    uint256 public constant MAX_PERIOD = 365 days;

    event Subscribed(address indexed subscriber, uint256 indexed tokenId, address indexed keyId);
    event Activated(address indexed subscriber, uint256 indexed tokenId, uint256 expiresAt);
    event Renewed(uint256 indexed tokenId, uint256 expiresAt);
    event ExpiredBurn(uint256 indexed tokenId, address indexed holder);
    event Unsubscribed(address indexed subscriber, uint256 indexed tokenId);

    error AlreadySubscribed(address subscriber);
    error NotMinted(uint256 tokenId);
    error NotActivated(uint256 tokenId);
    error AlreadyActivated(uint256 tokenId);
    error NotExpired(uint256 tokenId);
    error NotAuthorizedKey(uint256 tokenId);
    error InvalidConfig();
    error Soulbound();

    constructor(
        string memory name_,
        string memory symbol_,
        PassConfig memory cfg,
        address relayer_,
        address owner_
    ) ERC721(name_, symbol_) Ownable(owner_) {
        if (cfg.paymentToken == address(0) || cfg.treasury == address(0)) revert InvalidConfig();
        if (cfg.price == 0 || cfg.billingPeriod == 0 || cfg.billingPeriod > MAX_PERIOD) revert InvalidConfig();
        if (cfg.gracePeriod > MAX_PERIOD) revert InvalidConfig();
        config = cfg;
        relayer = relayer_;
    }

    // ------------------------------------------------------------------
    // View
    // ------------------------------------------------------------------

    /// @dev true while the pass has been activated and has not expired.
    function isActive(uint256 tokenId) external view returns (bool) {
        return _active(tokenId);
    }

    /// @dev tokenId and active flag for a subscriber wallet.
    function holderOf(address user) external view returns (uint256 tokenId, bool active) {
        tokenId = tokenOfOwner[user];
        if (tokenId == 0) return (0, false);
        active = _active(tokenId);
    }

    function _active(uint256 tokenId) internal view returns (bool) {
        if (_ownerOf(tokenId) == address(0)) return false;
        uint256 exp = expiresAtOf[tokenId];
        return exp != 0 && block.timestamp <= exp;
    }

    // ------------------------------------------------------------------
    // Subscription lifecycle
    // ------------------------------------------------------------------

    /// @dev Soulbound: mint (from zero) and burn (to zero) are allowed, any
    ///      holder-to-holder transfer reverts. Keeps `tokenOfOwner` in sync.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address from) {
        from = super._update(to, tokenId, auth);
        if (from != address(0) && to != address(0)) revert Soulbound();
        if (from != address(0)) delete tokenOfOwner[from];
        if (to != address(0)) tokenOfOwner[to] = tokenId;
        return from;
    }

    /// @dev Mint a pass for the caller, bound to the subscriber's access key
    ///      `keyId` (authorized on the Account Keychain with a recurring
    ///      spend limit scoped to this pass's treasury).
    ///      The pass is not active until the first period is charged via
    ///      `activate` (signed by the same access key).
    function subscribe(address keyId) external returns (uint256 tokenId) {
        if (tokenOfOwner[msg.sender] != 0) revert AlreadySubscribed(msg.sender);
        ++totalSupply;
        tokenId = totalSupply;
        keyIdOf[tokenId] = keyId;
        _safeMint(msg.sender, tokenId);
        emit Subscribed(msg.sender, tokenId, keyId);
    }

    /// @dev Clear a pass that was minted but never activated. Lets a
    ///      subscriber undo an interrupted signup without waiting for a burn.
    function unsubscribe() external {
        uint256 tokenId = tokenOfOwner[msg.sender];
        if (tokenId == 0) revert NotMinted(tokenId);
        if (expiresAtOf[tokenId] != 0) revert AlreadyActivated(tokenId);
        delete keyIdOf[tokenId];
        _burn(tokenId);
        emit Unsubscribed(msg.sender, tokenId);
    }

    /// @dev Mark the first billing period as paid. Callable by the pass's
    ///      access key (the relayer batch also transfers `price` to the
    ///      treasury in the same atomic transaction) or by the operator.
    function activate(uint256 tokenId) external onlyAuthorizedKey(tokenId) {
        address holder = _ownerOf(tokenId);
        if (holder == address(0)) revert NotMinted(tokenId);
        if (expiresAtOf[tokenId] != 0) revert AlreadyActivated(tokenId);
        expiresAtOf[tokenId] = block.timestamp + config.billingPeriod;
        emit Activated(holder, tokenId, expiresAtOf[tokenId]);
    }

    /// @dev Mark the next billing period as paid. Only possible once the
    ///      current period has expired: the keychain's recurring limit rolls
    ///      over at period end, so each charge is capped at one `price` per
    ///      period — the protocol-enforced direct debit rate.
    function renew(uint256 tokenId) external onlyAuthorizedKey(tokenId) {
        address holder = _ownerOf(tokenId);
        if (holder == address(0)) revert NotMinted(tokenId);
        uint256 exp = expiresAtOf[tokenId];
        if (exp == 0) revert NotActivated(tokenId);
        if (exp > block.timestamp) revert NotExpired(tokenId);
        expiresAtOf[tokenId] = block.timestamp + config.billingPeriod;
        emit Renewed(tokenId, expiresAtOf[tokenId]);
    }

    /// @dev Anyone can burn a pass once expiry + grace period has passed.
    function burnExpired(uint256 tokenId) external {
        address holder = _ownerOf(tokenId);
        if (holder == address(0)) revert NotMinted(tokenId);
        uint256 exp = expiresAtOf[tokenId];
        if (exp == 0) revert NotActivated(tokenId);
        if (block.timestamp <= exp + config.gracePeriod) revert NotExpired(tokenId);
        delete expiresAtOf[tokenId];
        delete keyIdOf[tokenId];
        _burn(tokenId);
        emit ExpiredBurn(tokenId, holder);
    }

    /// @dev Admin: change the relayer (operator) address.
    function setRelayer(address relayer_) external onlyOwner {
        relayer = relayer_;
    }

    // ------------------------------------------------------------------
    // Onchain metadata
    // ------------------------------------------------------------------

    /// @dev Escape user-provided strings for safe embedding in the SVG/JSON
    ///      metadata (name and symbol come from the launcher).
    function _esc(string memory s) internal pure returns (string memory) {
        bytes memory b = bytes(s);
        // worst case: every char expands to 6 bytes (&quot;)
        bytes memory tmp = new bytes(b.length * 6);
        uint256 j;
        for (uint256 i; i < b.length; ++i) {
            bytes1 c = b[i];
            if (c == "&") {
                tmp[j++] = "&"; tmp[j++] = "a"; tmp[j++] = "m"; tmp[j++] = "p"; tmp[j++] = ";";
            } else if (c == "<") {
                tmp[j++] = "&"; tmp[j++] = "l"; tmp[j++] = "t"; tmp[j++] = ";";
            } else if (c == ">") {
                tmp[j++] = "&"; tmp[j++] = "g"; tmp[j++] = "t"; tmp[j++] = ";";
            } else if (c == '"') {
                tmp[j++] = "&"; tmp[j++] = "q"; tmp[j++] = "u"; tmp[j++] = "o"; tmp[j++] = "t"; tmp[j++] = ";";
            } else if (c == "'") {
                tmp[j++] = "&"; tmp[j++] = "#"; tmp[j++] = "3"; tmp[j++] = "9"; tmp[j++] = ";";
            } else if (c == "\\") {
                tmp[j++] = "&"; tmp[j++] = "#"; tmp[j++] = "9"; tmp[j++] = "2"; tmp[j++] = ";";
            } else {
                tmp[j++] = c;
            }
        }
        // copy to an exactly-sized buffer — the over-allocated tail would
        // otherwise leave NUL bytes inside the JSON
        bytes memory out = new bytes(j);
        for (uint256 i; i < j; ++i) out[i] = tmp[i];
        return string(out);
    }

    /// @dev Fully onchain metadata: a flat SVG whale card wrapped in a
    ///      base64 data URI — no external hosting needed.
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        uint256 exp = expiresAtOf[tokenId];
        bool active = exp != 0 && block.timestamp <= exp;
        string memory status = active ? "Active" : (exp == 0 ? "Pending" : "Expired");
        string memory svg = string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="250">',
            '<rect width="400" height="250" rx="20" fill="#edf6fd"/>',
            '<rect x="16" y="16" width="368" height="218" rx="16" fill="#ffffff" stroke="#d3e4f1" stroke-width="2"/>',
            '<circle cx="330" cy="60" r="60" fill="#d7f0f2"/>',
            '<path d="M74 48 C 72 42 68 39 62 38 L 72 44 C 74 46 75 50 74 54 C 78 54 82 53 85 50 L 80 45 Z" fill="#4a8fcb"/>',
            '<ellipse cx="42" cy="58" rx="28" ry="16" fill="#5fa8e0"/>',
            '<ellipse cx="42" cy="64" rx="20" ry="10" fill="#d7f0f2"/>',
            '<circle cx="30" cy="54" r="2.6" fill="#1e3a5f"/>',
            '<text x="24" y="120" font-family="sans-serif" font-size="24" font-weight="800" fill="#1e3a5f">',
            _esc(name()),
            '</text>',
            '<text x="24" y="146" font-family="sans-serif" font-size="14" font-weight="600" fill="#64839f">',
            _esc(symbol()),
            ' #',
            Strings.toString(tokenId),
            '</text>',
            '<text x="24" y="178" font-family="sans-serif" font-size="15" font-weight="700" fill="#3f7fb8">',
            priceStr(),
            ' pathUSD / ',
            Strings.toString(config.billingPeriod / 86400),
            ' days</text>',
            '<text x="24" y="206" font-family="sans-serif" font-size="13" font-weight="700" fill="#2e7d5b">Status: ',
            status,
            '</text>',
            '</svg>'
        );
        string memory json = string.concat(
            '{"name":"',
            _esc(name()),
            ' #',
            Strings.toString(tokenId),
            '","description":"Whel Pass subscription pass on Tempo. Payments run automatically in pathUSD - cancel anytime.","attributes":[{"trait_type":"Status","value":"',
            status,
            '"},{"trait_type":"Price (pathUSD)","value":"',
            priceStr(),
            '"},{"trait_type":"Period (days)","value":"',
            Strings.toString(config.billingPeriod / 86400),
            '"}],"image":"data:image/svg+xml;base64,',
            Base64.encode(bytes(svg)),
            '"}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    function priceStr() internal view returns (string memory) {
        uint256 p = config.price;
        return string.concat(Strings.toString(p / 1e6), ".", _pad2((p % 1e6) / 1e4));
    }

    function _pad2(uint256 v) internal pure returns (string memory) {
        return v < 10 ? string.concat("0", Strings.toString(v)) : Strings.toString(v);
    }

    // ------------------------------------------------------------------
    // Authorization
    // ------------------------------------------------------------------

    modifier onlyAuthorizedKey(uint256 tokenId) {
        if (msg.sender != relayer && _txKey() != keyIdOf[tokenId]) {
            revert NotAuthorizedKey(tokenId);
        }
        _;
    }

    /// @dev The signing key of the current transaction, per the Account
    ///      Keychain precompile (address(0) = root key).
    function _txKey() internal view returns (address) {
        (bool ok, bytes memory data) = KEYCHAIN.staticcall(
            abi.encodeWithSignature("getTransactionKey()")
        );
        if (!ok || data.length < 32) return address(0);
        return abi.decode(data, (address));
    }
}
