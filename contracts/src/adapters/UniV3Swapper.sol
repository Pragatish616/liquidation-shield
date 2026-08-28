// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ISwapper} from "../interfaces/ISwapper.sol";
import {MockSwapper} from "../mocks/MockSwapper.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

contract UniV3Swapper is ISwapper {
    address public immutable SWAP_ROUTER;

    constructor(address _router) {
        SWAP_ROUTER = _router;
    }

    function swapExactOutput(bytes calldata path, uint256 amountOut, uint256 maxAmountIn, uint256 deadline)
        external
        override
        returns (uint256 amountIn)
    {
        address tokenIn = address(uint160(bytes20(path[0:20])));
        address tokenOut = address(uint160(bytes20(path[path.length - 20:])));

        MockERC20(tokenIn).transferFrom(msg.sender, address(this), maxAmountIn);
        MockERC20(tokenIn).approve(SWAP_ROUTER, maxAmountIn);

        amountIn = MockSwapper(SWAP_ROUTER).swapExactOutput(path, amountOut, maxAmountIn, deadline);

        uint256 unspent = maxAmountIn - amountIn;
        if (unspent > 0) {
            MockERC20(tokenIn).transfer(msg.sender, unspent);
        }
        MockERC20(tokenIn).approve(SWAP_ROUTER, 0);

        // Send tokenOut back to msg.sender (LiquidationShield)
        MockERC20(tokenOut).transfer(msg.sender, amountOut);

        return amountIn;
    }

    function swapExactInput(bytes calldata path, uint256 amountIn, uint256 minAmountOut, uint256 deadline)
        external
        override
        returns (uint256 amountOut)
    {
        address tokenIn = address(uint160(bytes20(path[0:20])));
        address tokenOut = address(uint160(bytes20(path[path.length - 20:])));

        MockERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        MockERC20(tokenIn).approve(SWAP_ROUTER, amountIn);

        amountOut = MockSwapper(SWAP_ROUTER).swapExactInput(path, amountIn, minAmountOut, deadline);

        MockERC20(tokenIn).approve(SWAP_ROUTER, 0);
        MockERC20(tokenOut).transfer(msg.sender, amountOut);

        return amountOut;
    }
}
