import { JsonRpcProvider, WebSocketProvider, Wallet, Contract } from "ethers";
import type { Deployment } from "./config.js";

// Minimal ABIs — only the methods/events the bot uses.
// Full ABIs ship with hardhat artifacts; these are hand-curated to keep
// the bot independent of hardhat compile state.
//
// ABI CORRECTIONS vs. plan (verified against actual contracts 2026-04-25):
// - PositionOpened/PositionClosed are on NoirVault, NOT PerpEngine.
// - LimitEngine: OrderPlaced has orderType BEFORE marketId (not after).
// - LimitEngine: termination events are Triggered/TriggerNotMet (NOT OrderTriggered/OrderMissed).
// - LimitEngine: TriggerRequested has shouldTriggerHandle (not handle).
// - AMMEngine: WithdrawRequested has plaintext claimedShares before matchHandle (4-arg event).
// - AMMEngine: fulfillment events are LiquidityRemoved/WithdrawRejected (not WithdrawDecided/etc).
// - PerpEngine: LiquidationRequested has underwaterHandle (not handle).

const VAULT_ABI = [
  "event PositionOpened(uint256 indexed positionId, address indexed owner, uint8 marketId)",
  "event PositionClosed(uint256 indexed positionId)",
];

const PERP_ABI = [
  "event LiquidationRequested(uint256 indexed requestId, uint256 indexed positionId, address indexed keeper, bytes32 underwaterHandle)",
  "event Liquidated(uint256 indexed positionId, address indexed keeper)",
  "event LiquidationChecked(uint256 indexed positionId)",
  "function requestLiquidation(uint256 positionId) external returns (uint256 requestId)",
  "function _onLiquidationDecided(uint256 requestId, bytes32[] handles, bytes cleartexts, bytes proof) external",
];

const LIMIT_ABI = [
  "event OrderPlaced(uint256 indexed orderId, address indexed owner, uint8 orderType, uint8 marketId)",
  "event OrderCancelled(uint256 indexed orderId, address indexed owner)",
  "event TriggerRequested(uint256 indexed requestId, uint256 indexed orderId, address indexed keeper, bytes32 shouldTriggerHandle)",
  "event Triggered(uint256 indexed orderId, address indexed user)",
  "event TriggerNotMet(uint256 indexed orderId)",
  "function requestTrigger(uint256 orderId) external returns (uint256 requestId)",
  "function _onTriggerDecided(uint256 requestId, bytes32[] handles, bytes cleartexts, bytes proof) external",
];

const AMM_ABI = [
  "event WithdrawRequested(uint256 indexed requestId, address indexed user, uint64 claimedShares, bytes32 matchHandle)",
  "event LiquidityRemoved(uint256 indexed requestId, address indexed user, uint64 shares, uint64 payout)",
  "event WithdrawRejected(uint256 indexed requestId, address indexed user)",
  "function _onWithdrawDecided(uint256 requestId, bytes32[] handles, bytes cleartexts, bytes proof) external",
];

const DARK_ABI = [
  "event OrderSubmitted(uint256 indexed orderId, address indexed owner, uint8 marketId)",
  "event OrderSubmittedForPair(uint256 indexed orderId, address indexed owner, uint8 marketId, bool isLong)",
  "event OrderCancelled(uint256 indexed orderId, address indexed owner)",
  "event OrderClosed(uint256 indexed orderId, string reason)",
  "event BatchMatchRequested(uint256 indexed requestId, address indexed keeper, uint256[] orderIds, bytes32[] handles)",
  "event BatchSettled(uint256 indexed requestId, uint256[] orderIds, uint256[] shouldFires)",
  "event MatchProposed(uint256 indexed requestId, uint256 indexed buyId, uint256 indexed sellId, address requester, bytes32[] handles)",
  "event MatchSettled(uint256 indexed requestId, uint256 indexed buyId, uint256 indexed sellId, address settler)",
  "event MatchRejected(uint256 indexed requestId, uint256 indexed buyId, uint256 indexed sellId)",
  "event MatchAborted(uint256 indexed requestId, uint256 indexed buyId, uint256 indexed sellId, string reason)",
  "function requestBatchMatch(uint256[] orderIds) external returns (uint256 requestId)",
  "function submitMatchPair(uint256 buyId, uint256 sellId) external returns (uint256 requestId)",
  "function _onBatchDecided(uint256 requestId, bytes32[] handles, bytes cleartexts, bytes proof) external",
  "function _onMatchDecided(uint256 requestId, bytes32[] handles, bytes cleartexts, bytes proof) external",
];

export type Clients = {
  rpc: JsonRpcProvider;
  ws: WebSocketProvider;
  signer: Wallet;
  vaultRO: Contract;
  perpRO: Contract;
  perpRW: Contract;
  limitRO: Contract;
  limitRW: Contract;
  ammRO: Contract;
  ammRW: Contract;
  darkRO: Contract;
  darkRW: Contract;
};

export function makeClients(
  rpcUrl: string,
  wsUrl: string,
  botKey: string,
  deployment: Deployment,
): Clients {
  const rpc = new JsonRpcProvider(rpcUrl);
  const ws = new WebSocketProvider(wsUrl);
  const signer = new Wallet(botKey, rpc);
  return {
    rpc,
    ws,
    signer,
    // NoirVault: subscribe to PositionOpened/PositionClosed (position events live here)
    vaultRO:  new Contract(deployment.contracts.NoirVault,      VAULT_ABI, ws),
    perpRO:   new Contract(deployment.contracts.PerpEngine,     PERP_ABI,  ws),
    perpRW:   new Contract(deployment.contracts.PerpEngine,     PERP_ABI,  signer),
    limitRO:  new Contract(deployment.contracts.LimitEngine,    LIMIT_ABI, ws),
    limitRW:  new Contract(deployment.contracts.LimitEngine,    LIMIT_ABI, signer),
    ammRO:    new Contract(deployment.contracts.AMMEngine,      AMM_ABI,   ws),
    ammRW:    new Contract(deployment.contracts.AMMEngine,      AMM_ABI,   signer),
    darkRO:   new Contract(deployment.contracts.DarkpoolEngine, DARK_ABI,  ws),
    darkRW:   new Contract(deployment.contracts.DarkpoolEngine, DARK_ABI,  signer),
  };
}
