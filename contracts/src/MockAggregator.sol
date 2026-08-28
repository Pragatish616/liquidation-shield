// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @notice Minimal Chainlink-aggregator-shaped mock for crashing an asset
/// price on the fork (plan.md §2.3). Implements both latestAnswer() (what
/// AaveOracle.getAssetPrice actually calls, per the pinned-fork trace) and
/// latestRoundData() (the documented AggregatorV3Interface shape) so it
/// satisfies either call path.
contract MockAggregator {
    int256 private _answer;
    uint8 public constant decimals = 8;

    constructor(int256 initialAnswer) {
        _answer = initialAnswer;
    }

    function latestAnswer() external view returns (int256) {
        return _answer;
    }

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        return (1, _answer, block.timestamp, block.timestamp, 1);
    }

    function setAnswer(int256 newAnswer) external {
        _answer = newAnswer;
    }
}
