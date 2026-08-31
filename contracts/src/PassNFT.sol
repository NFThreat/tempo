// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import { IERC20 } from "@openzeppelin/contracts/interfaces/IERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/// @title PassNFT
/// @notice Subscription NFT pass on Tempo. One pass per wallet, bound to the
///         paying wallet (soulbound). A pass is activated when the first
///         billing period is paid, renewed in billing periods, and burned
///         after expiry + grace period.
///
///         Payments are pulled onchain: `activate`/`renew` transfer exactly
///         `price` from the holder to the treasury via `transferFrom`, so no
///         external actor can activate a pass without the payment moving.
///         The payer must grant a `paymentToken` allowance to this contract —
///         done by the subscriber's Tempo access key (a P256 key with a
///         recurring spend limit, scoped to `approve` for this pass). The
///         contract verifies the signing key via the Account Keychain
///         precompile's `getTransactionKey()`: only a transaction signed by
///         the subscriber's own access key (or the configured relayer
///         operator) can activate/renew a pass.
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
    /// Operator that may also activate/renew (e.g. manual reactivation).
    address public relayer;

    /// Sequential token ids, starting at 1. Never reused.
    uint256 public totalSupply;
    mapping(uint256 => uint256) public expiresAtOf;
    /// One pass per wallet (kept in sync by _update; passes are soulbound).
    mapping(address => uint256) public tokenOfOwner;
    /// Access key authorized by the subscriber for this pass (P256 keyId).
    mapping(uint256 => address) public keyIdOf;

    uint256 public constant MAX_PERIOD = 365 days;

    string private _baseURI_;

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
    error PaymentFailed(address payer, uint256 amount);

    constructor(
        string memory name_,
        string memory symbol_,
        string memory baseURI_,
        PassConfig memory cfg,
        address relayer_,
        address owner_
    ) ERC721(name_, symbol_) Ownable(owner_) {
        if (cfg.paymentToken == address(0) || cfg.treasury == address(0)) revert InvalidConfig();
        if (cfg.price == 0 || cfg.billingPeriod == 0 || cfg.billingPeriod > MAX_PERIOD) revert InvalidConfig();
        if (cfg.gracePeriod > MAX_PERIOD) revert InvalidConfig();
        config = cfg;
        relayer = relayer_;
        _baseURI_ = baseURI_;
    }

    // ------------------------------------------------------------------
    // View
    // ------------------------------------------------------------------

    function _baseURI() internal view override returns (string memory) {
        return _baseURI_;
    }

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

    /// @dev Mint a pass for the caller, bound to the subscriber's `keyId`.
    ///      The pass is not active until the first payment is confirmed via
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

    /// @dev Confirm the first billing period was paid (pulled onchain from
    ///      the holder). Only callable by the relayer operator or in a
    ///      transaction signed by the pass's access key.
    function activate(uint256 tokenId) external onlyAuthorized(tokenId) {
        address holder = _ownerOf(tokenId);
        if (holder == address(0)) revert NotMinted(tokenId);
        if (expiresAtOf[tokenId] != 0) revert AlreadyActivated(tokenId);
        _charge(holder);
        expiresAtOf[tokenId] = block.timestamp + config.billingPeriod;
        emit Activated(holder, tokenId, expiresAtOf[tokenId]);
    }

    /// @dev Confirm the next billing period was paid (pulled onchain from
    ///      the holder). Same authorization as `activate`. If the pass
    ///      already expired, the new period starts from now.
    function renew(uint256 tokenId) external onlyAuthorized(tokenId) {
        address holder = _ownerOf(tokenId);
        if (holder == address(0)) revert NotMinted(tokenId);
        uint256 exp = expiresAtOf[tokenId];
        if (exp == 0) revert NotActivated(tokenId);
        // Anti-stacking: no renewals while more than one full period remains,
        // so a pass can never be prepaid more than ~one period ahead.
        if (exp > block.timestamp + config.billingPeriod) revert NotExpired(tokenId);
        _charge(holder);
        uint256 base = exp > block.timestamp ? exp : block.timestamp;
        expiresAtOf[tokenId] = base + config.billingPeriod;
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

    /// @dev Pull exactly one period price from `payer` to the treasury.
    function _charge(address payer) internal {
        bool ok = IERC20(config.paymentToken).transferFrom(payer, config.treasury, config.price);
        if (!ok) revert PaymentFailed(payer, config.price);
    }

    /// @dev Admin: change the relayer (operator) address.
    function setRelayer(address relayer_) external onlyOwner {
        relayer = relayer_;
    }

    /// @dev Admin: update the metadata base URI.
    function setBaseURI(string memory baseURI_) external onlyOwner {
        _baseURI_ = baseURI_;
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

    modifier onlyAuthorized(uint256 tokenId) {
        if (msg.sender != relayer && _txKey() != keyIdOf[tokenId]) {
            revert NotAuthorizedKey(tokenId);
        }
        _;
    }
}
