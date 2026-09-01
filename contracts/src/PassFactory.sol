// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IERC20 } from "@openzeppelin/contracts/interfaces/IERC20.sol";
import { PassNFT } from "./PassNFT.sol";

/// @title PassFactory
/// @notice Launchpad factory: anyone can launch a subscription pass
///         collection by paying a one-time deploy fee (in a TIP-20
///         stablecoin). The creator becomes the owner of the PassNFT.
contract PassFactory is Ownable {
    /// Token used to pay the deploy fee (e.g. pathUSD).
    address public immutable feeToken;
    uint256 public deployFee;

    address[] public passes;
    mapping(address => address) public creatorOf;

    event DeployFeeChanged(uint256 fee);
    event PassDeployed(address indexed pass, address indexed creator, string name, string symbol);

    constructor(address feeToken_, uint256 deployFee_) Ownable(msg.sender) {
        feeToken = feeToken_;
        deployFee = deployFee_;
    }

    function setDeployFee(uint256 deployFee_) external onlyOwner {
        deployFee = deployFee_;
        emit DeployFeeChanged(deployFee_);
    }

    function passCount() external view returns (uint256) {
        return passes.length;
    }

    /// @dev Launch a new pass collection. Pays `deployFee` in `feeToken`.
    function deployPass(
        string calldata name_,
        string calldata symbol_,
        PassNFT.PassConfig calldata cfg,
        address relayer_
    ) external returns (address pass) {
        if (deployFee > 0) {
            if (IERC20(feeToken).transferFrom(msg.sender, owner(), deployFee) == false) {
                revert("PassFactory: fee transfer failed");
            }
        }
        PassNFT nft = new PassNFT(name_, symbol_, cfg, relayer_, msg.sender);
        pass = address(nft);
        passes.push(pass);
        creatorOf[pass] = msg.sender;
        emit PassDeployed(pass, msg.sender, name_, symbol_);
    }
}
