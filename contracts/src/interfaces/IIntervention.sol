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
        uint256 minAmountOut;
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
