// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * Fork test against real Aave v3 mainnet. This is the first real test in
 * this repo (contracts/test/ was empty, and .github/workflows/test.yml ran
 * `forge test` against zero test files and exited 0 -- a green badge over
 * zero coverage).
 *
 * Why a mock-only test suite can't prove anything here: MockPool.withdraw
 * never decrements userCollateral (see MockPool.sol) -- releasing
 * collateral in the mock is invisible to getUserAccountData's health
 * factor, so HF can only ever go up regardless of what
 * LiquidationShield.executeOperation actually did. Every HF invariant
 * would pass trivially against the mock, whether the contract logic is
 * correct or not. Forking real Aave and reading its own
 * getUserAccountData as the source of truth is the only way these
 * invariants mean anything.
 *
 * The swap leg still goes through MockSwapper/UniV3Swapper (deployed fresh
 * here, same as script/Deploy.s.sol) -- what's being proven real here is
 * the Aave integration (Pool, Oracle, aTokens, debt accounting, HF), which
 * is what was entirely fake before Step 1's interface seam. The swap venue
 * itself was never the thing in question.
 */

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {LiquidationShield} from "../src/LiquidationShield.sol";
import {AaveFlashProvider} from "../src/adapters/AaveFlashProvider.sol";
import {UniV3Swapper} from "../src/adapters/UniV3Swapper.sol";
import {MockSwapper} from "../src/mocks/MockSwapper.sol";
import {MockAggregator} from "../src/MockAggregator.sol";
import {PolicyRegistry} from "../src/PolicyRegistry.sol";
import {IPolicyRegistry} from "../src/interfaces/IPolicyRegistry.sol";
import {IIntervention} from "../src/interfaces/IIntervention.sol";
import {IPoolLike} from "../src/interfaces/IPoolLike.sol";
import {IPriceOracleLike} from "../src/interfaces/IPriceOracleLike.sol";
import "../src/libraries/Errors.sol";

interface IWETH9 {
    function deposit() external payable;
}

/// @dev Test-only extension of the production IPoolLike: LiquidationShield
/// itself never borrows, but this test needs to in order to build a
/// position, so it's declared here rather than widening the real interface.
interface ITestPool is IPoolLike {
    function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)
        external;
}

interface IAaveOracleAdmin {
    function setAssetSources(address[] calldata assets, address[] calldata sources) external;
}

interface IPoolAddressesProviderLike {
    function getACLAdmin() external view returns (address);
}

contract LiquidationShieldForkTest is Test {
    // Real Aave v3 Ethereum mainnet addresses -- verified live via `cast
    // call` against the pinned block below before being hardcoded here
    // (same discipline as agent/src/reader/abis.ts), not copied from a
    // blog post.
    address constant POOL_ADDRESSES_PROVIDER = 0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e;
    address constant POOL = 0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2;
    address constant ORACLE = 0x54586bE62E3c3580375aE3723C145253060Ca0C2;
    address constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address constant aWETH = 0x4d5F47FA6A74757f35C14fD3a6Ef8E3C9BC514E8;

    // Pinned so the whole test is reproducible -- current mainnet block at
    // the time this test was written.
    uint256 constant FORK_BLOCK = 25_855_209;

    uint256 constant INITIAL_DEBT_USDC = 17_000e6;
    uint256 constant RELEASE_AMOUNT_WETH = 4e18;
    uint256 constant REPAY_AMOUNT_USDC = 8_000e6;

    address user = makeAddr("borrower");
    address keeper = makeAddr("keeper");

    LiquidationShield shield;
    AaveFlashProvider flashProvider;
    MockSwapper mockSwapper;
    PolicyRegistry registry;

    uint256 wethUsdcRate; // MockSwapper's rate: USDC raw units out per 1e18 WETH in

    function setUp() public {
        vm.createSelectFork("mainnet", FORK_BLOCK);

        // ============ 1. Create a real WETH/USDC borrower position ============
        vm.deal(user, 11 ether);
        vm.startPrank(user);
        IWETH9(WETH).deposit{value: 10 ether}();
        IERC20(WETH).approve(POOL, 10 ether);
        ITestPool(POOL).supply(WETH, 10 ether, user, 0);
        ITestPool(POOL).borrow(USDC, INITIAL_DEBT_USDC, 2, 0, user);
        vm.stopPrank();

        // ============ 2. Deploy the shield's own contracts, wired to the REAL pool/oracle ============
        mockSwapper = new MockSwapper();
        deal(USDC, address(mockSwapper), 100_000e6);

        flashProvider = new AaveFlashProvider(POOL);
        UniV3Swapper swapper = new UniV3Swapper(address(mockSwapper));
        registry = new PolicyRegistry();
        shield = new LiquidationShield(address(flashProvider), address(swapper), address(registry), POOL, ORACLE);
        flashProvider.setShield(address(shield));

        registry.addKeeper(keeper);
        // executeIntervention's own step 11 calls
        // POLICY_REGISTRY.setLastExecutedAt as itself, not as the keeper
        // EOA that called executeIntervention -- msg.sender there is
        // address(shield), which PolicyRegistry.setLastExecutedAt also
        // gates on being a registered keeper (see Deploy.s.sol, which
        // registers both for the same reason).
        registry.addKeeper(address(shield));

        // ============ 3. Crash WETH's oracle price -10%, mirroring scripts/crashPrice.ts ============
        // (deploy MockAggregator(newPrice) -> impersonate the ACL admin,
        // resolved at runtime not hand-typed -> aaveOracle.setAssetSources)
        address aclAdmin = IPoolAddressesProviderLike(POOL_ADDRESSES_PROVIDER).getACLAdmin();
        uint256 wethPriceBefore = IPriceOracleLike(ORACLE).getAssetPrice(WETH);
        int256 crashedPrice = int256(wethPriceBefore) * 90 / 100;

        MockAggregator mockAggregator = new MockAggregator(crashedPrice);
        address[] memory assets = new address[](1);
        assets[0] = WETH;
        address[] memory sources = new address[](1);
        sources[0] = address(mockAggregator);

        vm.prank(aclAdmin);
        IAaveOracleAdmin(ORACLE).setAssetSources(assets, sources);

        uint256 wethPriceAfter = IPriceOracleLike(ORACLE).getAssetPrice(WETH);
        assertLt(wethPriceAfter, wethPriceBefore, "oracle price crash did not take effect");

        // ============ 4. Set the MockSwapper's rate off the (now-crashed) oracle price ============
        // rate is "USDC raw units out per 1e18 WETH in" -- see
        // MockSwapper.swapExactOutput's amountIn = amountOut*1e18/rate.
        // A small ~1% haircut off the fair oracle rate stands in for real
        // swap friction (fee tier + price impact), the same role
        // effectiveCostFraction plays in the off-chain quoter.
        uint256 fairRate = wethPriceAfter / 100; // 8dp USD price -> USDC(6dp) per 1 WETH(18dp)
        wethUsdcRate = (fairRate * 99) / 100;
        mockSwapper.setRate(WETH, USDC, wethUsdcRate);

        // ============ 5. Set the user's policy and the aToken approval ============
        address[] memory allowedCollateral = new address[](1);
        allowedCollateral[0] = WETH;
        address[] memory allowedDebt = new address[](1);
        allowedDebt[0] = USDC;

        IPolicyRegistry.Policy memory policy = IPolicyRegistry.Policy({
            triggerHF: 1.1e18,
            targetHF: 1.2e18,
            maxReleasePerTx: type(uint128).max,
            maxCostBps: 500,
            minIntervalSec: 0,
            expiry: uint64(block.timestamp + 1 days),
            allowedCollateral: allowedCollateral,
            allowedDebt: allowedDebt,
            enabled: true
        });
        vm.prank(user);
        registry.setPolicy(policy);

        vm.prank(user);
        IERC20(aWETH).approve(address(shield), type(uint256).max);

        // Sanity: the crash actually put the position in the trigger band,
        // not already fully liquidated -- otherwise this test would be
        // exercising a different code path than intended.
        (,,,,, uint256 hfAfterCrash) = IPoolLike(POOL).getUserAccountData(user);
        assertLt(hfAfterCrash, policy.triggerHF, "crash did not push HF below triggerHF");
        assertGt(hfAfterCrash, 1e18, "crash pushed HF below 1.0 -- position already liquidatable, not just at-risk");
    }

    /// @dev Builds InterventionParams for the fixed release/repay amounts
    /// above, with an explicit maxAmountIn so both the passing and
    /// reverting tests can share the same position setup.
    function _buildParams(uint256 maxAmountIn) internal view returns (IIntervention.InterventionParams memory) {
        bytes memory swapPath = abi.encodePacked(WETH, uint24(500), USDC);
        IIntervention.PermitData memory noPermit; // deadline: 0 -> permit branch skipped, plain approve() used instead

        return IIntervention.InterventionParams({
            user: user,
            collateralAsset: WETH,
            debtAsset: USDC,
            releaseAmount: RELEASE_AMOUNT_WETH,
            repayAmount: REPAY_AMOUNT_USDC,
            maxAmountIn: maxAmountIn,
            targetHF: 1.2e18,
            swapPath: swapPath,
            deadline: block.timestamp + 300,
            permit: noPermit
        });
    }

    /// @dev The nominal collateral input the swap actually needs at the
    /// configured rate, before any buffer -- owed*1e18/rate, mirroring
    /// selection.ts's own bufferedAmountIn derivation.
    function _nominalAmountIn() internal view returns (uint256) {
        uint256 premium = (REPAY_AMOUNT_USDC * 5) / 10000; // matches the real pool's actual 5bps premium
        uint256 owed = REPAY_AMOUNT_USDC + premium;
        return (owed * 1e18) / wethUsdcRate;
    }

    function test_executeIntervention_onRealAave_strictlyImprovesHFAndReachesTarget() public {
        (,,,,, uint256 hfBefore) = IPoolLike(POOL).getUserAccountData(user);

        uint256 maxAmountIn = (_nominalAmountIn() * 101) / 100; // 1% buffer, same shape as selection.ts
        assertLt(maxAmountIn, RELEASE_AMOUNT_WETH, "test setup: maxAmountIn must fit within releaseAmount");

        vm.prank(keeper);
        shield.executeIntervention(_buildParams(maxAmountIn));

        (,,,,, uint256 hfAfter) = IPoolLike(POOL).getUserAccountData(user);

        // The claim under test: real Aave's own getUserAccountData, not our
        // own math, says the position strictly improved and reached the
        // policy's targetHF.
        assertGt(hfAfter, hfBefore, "HF must strictly improve");
        assertGe(hfAfter, 1.2e18, "HF must reach policy.targetHF");
    }

    function test_executeIntervention_revertsAndLeavesPositionUnchanged_whenMaxAmountInTooTight() public {
        // Deliberately below what the swap actually needs (see
        // _nominalAmountIn) -- MockSwapper.swapExactOutput must revert
        // SlippageExceeded rather than silently spending more.
        uint256 tooTight = _nominalAmountIn() / 2;
        assertLt(tooTight, _nominalAmountIn(), "test setup: tooTight must actually be too tight");

        (uint256 totalCollateralBefore, uint256 totalDebtBefore,,,, uint256 hfBefore) =
            IPoolLike(POOL).getUserAccountData(user);
        uint256 aWethBalBefore = IERC20(aWETH).balanceOf(user);
        uint256 shieldWethBalBefore = IERC20(WETH).balanceOf(address(shield));
        uint256 shieldUsdcBalBefore = IERC20(USDC).balanceOf(address(shield));

        vm.prank(keeper);
        vm.expectRevert(SlippageExceeded.selector);
        shield.executeIntervention(_buildParams(tooTight));

        // Atomic or nothing: every piece of state the intervention would
        // have touched must be byte-for-byte identical to before the call,
        // not just "HF looks about the same."
        (uint256 totalCollateralAfter, uint256 totalDebtAfter,,,, uint256 hfAfter) =
            IPoolLike(POOL).getUserAccountData(user);

        assertEq(totalCollateralAfter, totalCollateralBefore, "collateral changed despite revert");
        assertEq(totalDebtAfter, totalDebtBefore, "debt changed despite revert");
        assertEq(hfAfter, hfBefore, "HF changed despite revert");
        assertEq(IERC20(aWETH).balanceOf(user), aWethBalBefore, "user's aWETH balance changed despite revert");
        assertEq(
            IERC20(WETH).balanceOf(address(shield)), shieldWethBalBefore, "shield WETH balance changed despite revert"
        );
        assertEq(
            IERC20(USDC).balanceOf(address(shield)), shieldUsdcBalBefore, "shield USDC balance changed despite revert"
        );
    }
}
