// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

error Expired();
error NotAtRisk();
error TooSoon();
error PolicyDisabled();
error PolicyExpired();
error AssetNotAllowed();
error ExceedsPolicyCap();
error MadeItWorse();
error TargetNotReached();
error NewDebtOpened();
error SlippageExceeded();
error TooExpensive();
error ResidualBalance(address token, uint256 balance);
error OnlyPool();
error OnlyThis();
error InsufficientAllowance();
error PermitExpired();
error InvalidPermit();
error UnauthorizedKeeper();
error BelowTriggerHF();
error ZeroAmount();
