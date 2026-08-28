// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPoolLike} from "../interfaces/IPoolLike.sol";
import "./Errors.sol";

library HealthMath {
    function getHealthFactor(address user, IPoolLike pool) internal view returns (uint256) {
        (,,,,, uint256 hf) = pool.getUserAccountData(user);
        return hf;
    }

    function assertMinTargetHF(address user, IPoolLike pool, uint256 targetHF) internal view {
        uint256 hf = getHealthFactor(user, pool);
        if (hf < targetHF) revert TargetNotReached();
    }
}
