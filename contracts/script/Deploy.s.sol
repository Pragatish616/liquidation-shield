// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {PolicyRegistry} from "../src/PolicyRegistry.sol";
import {AaveFlashProvider} from "../src/adapters/AaveFlashProvider.sol";
import {UniV3Swapper} from "../src/adapters/UniV3Swapper.sol";
import {MockPool} from "../src/mocks/MockPool.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockAToken} from "../src/mocks/MockAToken.sol";
import {MockDebtToken} from "../src/mocks/MockDebtToken.sol";
import {MockSwapper} from "../src/mocks/MockSwapper.sol";
import {LiquidationShield} from "../src/LiquidationShield.sol";
import {console} from "forge-std/console.sol";

contract Deploy is Script {
    function run() external {
        vm.startBroadcast();

        // === Deploy Mock Tokens ===
        MockERC20 weth = new MockERC20("Wrapped Ether", "WETH", 18);
        MockERC20 usdc = new MockERC20("USD Coin", "USDC", 6);
        console.log("WETH:", address(weth));
        console.log("USDC:", address(usdc));

        // === Deploy Mock Pool ===
        MockPool pool = new MockPool();
        console.log("MockPool:", address(pool));

        // === Deploy Mock aTokens ===
        MockAToken aWeth = new MockAToken("Aave WETH", "aWETH", 18, address(weth), address(pool));
        MockAToken aUsdc = new MockAToken("Aave USDC", "aUSDC", 6, address(usdc), address(pool));
        console.log("aWETH:", address(aWeth));
        console.log("aUSDC:", address(aUsdc));

        // Register aTokens with pool
        pool.registerAToken(address(weth), address(aWeth));
        pool.registerAToken(address(usdc), address(aUsdc));

        // === Deploy Mock Variable Debt Tokens ===
        // Real Aave exposes a user's debt via a per-reserve variable debt
        // token's balanceOf, not a pool method (see AaveAdapter.debtOf) --
        // these are thin read-through proxies onto MockPool's own userDebt
        // mapping, mirroring how aTokens already work above.
        MockDebtToken debtWeth = new MockDebtToken(address(pool), address(weth));
        MockDebtToken debtUsdc = new MockDebtToken(address(pool), address(usdc));
        console.log("debtWETH:", address(debtWeth));
        console.log("debtUSDC:", address(debtUsdc));

        pool.registerDebtToken(address(weth), address(debtWeth));
        pool.registerDebtToken(address(usdc), address(debtUsdc));

        // === Deploy Mock Swapper ===
        MockSwapper mockSwapper = new MockSwapper();
        console.log("MockSwapper:", address(mockSwapper));

        // === Deploy Real Adapters (wired to mocks) ===
        AaveFlashProvider flashProvider = new AaveFlashProvider(address(pool));
        console.log("AaveFlashProvider:", address(flashProvider));

        UniV3Swapper swapper = new UniV3Swapper(address(mockSwapper));
        console.log("UniV3Swapper:", address(swapper));

        // === Deploy PolicyRegistry ===
        PolicyRegistry registry = new PolicyRegistry();
        console.log("PolicyRegistry:", address(registry));

        // === Deploy LiquidationShield ===
        // MockPool doubles as its own price oracle for this mock/demo
        // deployment -- see MockPool.getAssetPrice.
        LiquidationShield shield = new LiquidationShield(
            address(flashProvider), address(swapper), address(registry), address(pool), address(pool)
        );
        console.log("LiquidationShield:", address(shield));

        // Wire the adapter to the shield it's allowed to serve. Settable
        // once, by the deployer, since LiquidationShield's constructor needs
        // flashProvider's address, so this can't be done the other way
        // around inside AaveFlashProvider's own constructor.
        flashProvider.setShield(address(shield));

        // Add shield as keeper
        registry.addKeeper(address(shield));
        // Add deployer as keeper for testing
        registry.addKeeper(vm.addr(0x1));

        vm.stopBroadcast();

        // Save addresses for Part 4
        vm.writeFile(
            "addresses.json",
            string(
                abi.encodePacked(
                    '{"weth":"',
                    vm.toString(address(weth)),
                    '",',
                    '"usdc":"',
                    vm.toString(address(usdc)),
                    '",',
                    '"pool":"',
                    vm.toString(address(pool)),
                    '",',
                    '"aWeth":"',
                    vm.toString(address(aWeth)),
                    '",',
                    '"aUsdc":"',
                    vm.toString(address(aUsdc)),
                    '",',
                    '"mockSwapper":"',
                    vm.toString(address(mockSwapper)),
                    '",',
                    '"flashProvider":"',
                    vm.toString(address(flashProvider)),
                    '",',
                    '"swapper":"',
                    vm.toString(address(swapper)),
                    '",',
                    '"registry":"',
                    vm.toString(address(registry)),
                    '",',
                    '"shield":"',
                    vm.toString(address(shield)),
                    '"}'
                )
            )
        );
    }
}
