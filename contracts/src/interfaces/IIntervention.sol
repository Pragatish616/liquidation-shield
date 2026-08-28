// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IIntervention {
    struct PermitData {
        uint256 value;
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    struct InterventionParams {
        address user;
        address collateralAsset;
        address debtAsset;
        uint256 releaseAmount;
        uint256 repayAmount;
        // Ceiling on collateral spent by the exact-output swap that produces
        // repayAmount + premium debt tokens (see LiquidationShield's
        // executeOperation) -- computed off-chain from a quote with a
        // slippage buffer, always <= releaseAmount. Bounds the trade far
        // more tightly than releaseAmount itself would.
        uint256 maxAmountIn;
        uint256 targetHF;
        bytes swapPath;
        uint256 deadline;
        PermitData permit;
    }

    event InterventionExecuted(
        address indexed user,
        address indexed collateralAsset,
        address indexed debtAsset,
        uint256 releaseAmount,
        uint256 repayAmount,
        uint256 hfBefore,
        uint256 hfAfter,
        uint256 costBps
    );
}
