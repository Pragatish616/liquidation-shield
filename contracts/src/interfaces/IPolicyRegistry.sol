// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IPolicyRegistry {
    struct Policy {
        uint128 triggerHF;
        uint128 targetHF;
        uint128 maxReleasePerTx;
        uint32 maxCostBps;
        uint32 minIntervalSec;
        uint64 expiry;
        address[] allowedCollateral;
        address[] allowedDebt;
        bool enabled;
    }

    function setPolicy(Policy calldata p) external;
    function revoke() external;
    function policies(address user) external view returns (Policy memory);
    function lastExecutedAt(address user) external view returns (uint64);
    function setLastExecutedAt(address user, uint64 timestamp) external;
    function isKeeper(address account) external view returns (bool);
    function validatePolicy(address user, address collateralAsset, address debtAsset, uint256 releaseAmount)
        external
        view
        returns (Policy memory);
}
