// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockPool} from "../mocks/MockPool.sol";
import "./Errors.sol";

library HealthMath {
    function getHealthFactor(address user, MockPool pool) internal view returns (uint256) {
        (,,,,, uint256 hf) = pool.getUserAccountData(user);
        return hf;
    }

    function assertMinTargetHF(address user, MockPool pool, uint256 targetHF) internal view {
        uint256 hf = getHealthFactor(user, pool);
        if (hf < targetHF) revert TargetNotReached();
    }
}
