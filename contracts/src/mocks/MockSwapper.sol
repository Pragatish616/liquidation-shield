// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ISwapper} from "../interfaces/ISwapper.sol";
import {MockERC20} from "./MockERC20.sol";
import "../libraries/Errors.sol";

contract MockSwapper is ISwapper {
    // Mock swap rates: collateral -> debt
    // Key: "collateralAsset:debtAsset" -> rate (how much debt units per 1e18 collateral units)
    mapping(bytes32 => uint256) public swapRate;

    // Track calls for verification
    uint256 public lastAmountIn;
    uint256 public lastAmountOut;
    bytes public lastPath;

    constructor() {}

    function setRate(address tokenIn, address tokenOut, uint256 rate) external {
        swapRate[keccak256(abi.encodePacked(tokenIn, tokenOut))] = rate;
    }

    function swapExactOutput(
        bytes calldata path,
        uint256 amountOut,
        uint256 maxAmountIn,
        uint256 deadline
    ) external override returns (uint256 amountIn) {
        lastPath = path;
        lastAmountOut = amountOut;

        address tokenOut = address(uint160(bytes20(path[path.length - 20:])));
        address tokenIn = address(uint160(bytes20(path[0:20])));

        uint256 rate = swapRate[keccak256(abi.encodePacked(tokenIn, tokenOut))];
        require(rate > 0, "No rate set");

        amountIn = (amountOut * 1e18) / rate;
        if (amountIn > maxAmountIn) revert SlippageExceeded();

        MockERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        MockERC20(tokenOut).transfer(msg.sender, amountOut);

        lastAmountIn = amountIn;
        return amountIn;
    }

    function swapExactInput(
        bytes calldata path,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 deadline
    ) external override returns (uint256 amountOut) {
        lastPath = path;
        lastAmountIn = amountIn;

        address tokenIn = address(uint160(bytes20(path[0:20])));
        address tokenOut = address(uint160(bytes20(path[path.length - 20:])));

        uint256 rate = swapRate[keccak256(abi.encodePacked(tokenIn, tokenOut))];
        require(rate > 0, "No rate set");

        amountOut = (amountIn * rate) / 1e18;
        if (amountOut < minAmountOut) revert SlippageExceeded();

        MockERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        MockERC20(tokenOut).transfer(msg.sender, amountOut);

        lastAmountOut = amountOut;
        return amountOut;
    }
}
