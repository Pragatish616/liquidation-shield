// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IPolicyRegistry} from "./interfaces/IPolicyRegistry.sol";
import "./libraries/Errors.sol";

contract PolicyRegistry is Ownable, IPolicyRegistry {
    mapping(address => Policy) private _policies;
    mapping(address => uint64) public override lastExecutedAt;
    mapping(address => bool) public keepers;
    bool public permissionlessMode = false;

    event PolicySet(address indexed user, Policy policy);
    event PolicyRevoked(address indexed user);
    event KeeperAdded(address indexed keeper);
    event KeeperRemoved(address indexed keeper);
    event PermissionlessToggled(bool enabled);

    constructor() Ownable(msg.sender) {}

    function policies(address user) external view override returns (Policy memory) {
        return _policies[user];
    }

    function setPolicy(Policy calldata p) external override {
        if (p.triggerHF >= p.targetHF) revert InvalidPermit();
        if (p.expiry < block.timestamp) revert PolicyExpired();
        if (p.allowedCollateral.length == 0 || p.allowedDebt.length == 0) revert AssetNotAllowed();

        _policies[msg.sender] = p;
        emit PolicySet(msg.sender, p);
    }

    function revoke() external override {
        Policy storage p = _policies[msg.sender];
        if (!p.enabled) return;
        p.enabled = false;
        emit PolicyRevoked(msg.sender);
    }

    function addKeeper(address keeper) external onlyOwner {
        keepers[keeper] = true;
        emit KeeperAdded(keeper);
    }

    function removeKeeper(address keeper) external onlyOwner {
        keepers[keeper] = false;
        emit KeeperRemoved(keeper);
    }

    function isKeeper(address account) external view override returns (bool) {
        return permissionlessMode || keepers[account];
    }

    function togglePermissionless() external onlyOwner {
        permissionlessMode = !permissionlessMode;
        emit PermissionlessToggled(permissionlessMode);
    }

    function setLastExecutedAt(address user, uint64 timestamp) external override {
        if (!permissionlessMode && !keepers[msg.sender] && msg.sender != owner()) revert UnauthorizedKeeper();
        lastExecutedAt[user] = timestamp;
    }

    function validatePolicy(address user, address collateralAsset, address debtAsset, uint256 releaseAmount)
        external
        view
        override
        returns (Policy memory)
    {
        Policy memory p = _policies[user];
        if (!p.enabled) revert PolicyDisabled();
        if (block.timestamp > p.expiry) revert PolicyExpired();

        bool collateralOk = false;
        for (uint256 i = 0; i < p.allowedCollateral.length; i++) {
            if (p.allowedCollateral[i] == collateralAsset) {
                collateralOk = true;
                break;
            }
        }
        if (!collateralOk) revert AssetNotAllowed();

        bool debtOk = false;
        for (uint256 i = 0; i < p.allowedDebt.length; i++) {
            if (p.allowedDebt[i] == debtAsset) {
                debtOk = true;
                break;
            }
        }
        if (!debtOk) revert AssetNotAllowed();

        if (releaseAmount > p.maxReleasePerTx) revert ExceedsPolicyCap();
        if (block.timestamp < lastExecutedAt[user] + p.minIntervalSec) revert TooSoon();

        return p;
    }
}
