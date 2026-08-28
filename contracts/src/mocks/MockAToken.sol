// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {MockERC20} from "./MockERC20.sol";
import "../libraries/Errors.sol";

contract MockAToken is MockERC20, ERC20Permit {
    address public underlyingAsset;
    address public pool;

    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals_,
        address _underlyingAsset,
        address _pool
    ) MockERC20(name, symbol, decimals_) ERC20Permit(name) {
        underlyingAsset = _underlyingAsset;
        pool = _pool;
    }

    function decimals() public view virtual override(MockERC20, ERC20) returns (uint8) {
        return super.decimals();
    }

    // Mock permit - accepts ANY signature for hackathon
    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public virtual override {
        if (block.timestamp > deadline) revert PermitExpired();
        _approve(owner, spender, value);
    }
}
