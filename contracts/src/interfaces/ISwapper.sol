// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ISwapper {
    function swapExactOutput(bytes calldata path, uint256 amountOut, uint256 maxAmountIn, uint256 deadline)
        external
        returns (uint256 amountIn);
    function swapExactInput(bytes calldata path, uint256 amountIn, uint256 minAmountOut, uint256 deadline)
        external
        returns (uint256 amountOut);
}
