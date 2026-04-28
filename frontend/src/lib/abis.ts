// Hand-curated wagmi ABIs. Most entries are human-readable strings
// fed through viem's `parseAbi`. Entries that involve named-component
// tuples (e.g., `getPosition`, `getOrder`) live in their consumer
// hooks as inline JSON ABI — abitype's parser rejects the
// `tuple(name1 type1, name2 type2, ...)` form.
//
// `DARK_ABI` is an `Abi` already (mix of parsed strings + a JSON
// `submitOrder` entry with a nested tuple input). Pass it directly
// to wagmi without re-running it through `parseAbi`.

import { parseAbi, type Abi } from "viem";

export const ERC7984_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function balanceOf(address) view returns (bytes32)",
  "function setOperator(address operator, uint48 until) external",
  "function isOperator(address holder, address operator) view returns (bool)",
  "function mintPlaintext(address to, uint64 amount) external",
] as const;

export const VAULT_ABI = [
  "function getBalance(address user) view returns (bytes32)",
  "function deposit(uint64 amount) external",
  "function nextPositionId() view returns (uint256)",
  "event PositionOpened(uint256 indexed positionId, address indexed owner, uint8 marketId)",
  "event PositionClosed(uint256 indexed positionId)",
] as const;

export const ORACLE_ABI = [
  "function getPrice(uint8 marketId) view returns (uint64 price, bool fresh)",
] as const;

export const COMPLIANCE_ABI = [
  "function verify(address user, bytes32[] calldata proof) view returns (bool)",
  "function merkleRoot() view returns (bytes32)",
] as const;

export const PERP_ABI = [
  "function openPosition(bytes32 eSize, bytes sizeProof, bytes32 eCollateral, bytes collateralProof, bool isLong, uint8 marketId, bytes32[] complianceProof) external returns (uint256 positionId)",
  "function closePosition(uint256 positionId) external",
] as const;

export const AMM_ABI = [
  "function totalShares() view returns (uint64)",
  "function totalReserveUsdcx() view returns (uint64)",
  "function userShares(address) view returns (bytes32)",
  "function addLiquidity(uint64 amount) external",
  "function requestWithdraw(uint64 shares) external returns (uint256 requestId)",
] as const;

// Pre-built Abi: parseable strings + the JSON `submitOrder` entry.
// Pass `DARK_ABI` directly to wagmi; do not wrap with parseAbi.
export const DARK_ABI: Abi = [
  ...parseAbi([
    "function nextOrderId() view returns (uint256)",
    "function cancelOrder(uint256 orderId) external",
    "event OrderSubmitted(uint256 indexed orderId, address indexed owner, uint8 marketId)",
    "event OrderSubmittedForPair(uint256 indexed orderId, address indexed owner, uint8 marketId, bool isLong)",
    "event OrderCancelled(uint256 indexed orderId, address indexed owner)",
    "event OrderClosed(uint256 indexed orderId, string reason)",
    "event MatchProposed(uint256 indexed requestId, uint256 indexed buyId, uint256 indexed sellId, address requester, bytes32[] handles)",
    "event MatchSettled(uint256 indexed requestId, uint256 indexed buyId, uint256 indexed sellId, address settler)",
    "event MatchRejected(uint256 indexed requestId, uint256 indexed buyId, uint256 indexed sellId)",
    "event MatchAborted(uint256 indexed requestId, uint256 indexed buyId, uint256 indexed sellId, string reason)",
  ] as const),
  {
    name: "submitOrder",
    type: "function",
    inputs: [
      {
        name: "inputs",
        type: "tuple",
        components: [
          { name: "eSize",          type: "bytes32" },
          { name: "sizeProof",      type: "bytes"   },
          { name: "eCollateral",    type: "bytes32" },
          { name: "collateralProof",type: "bytes"   },
          { name: "eLimitPrice",    type: "bytes32" },
          { name: "limitProof",     type: "bytes"   },
        ],
      },
      { name: "marketId",       type: "uint8"    },
      { name: "isLong",         type: "bool"     },
      { name: "complianceProof",type: "bytes32[]" },
    ],
    outputs: [{ name: "orderId", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  // Phase 11 — pair-eligible submit. Same shape as `submitOrder` but the
  // middle ciphertext is `eCollateralPerUnit` (= total / size, computed
  // off-chain at submit time so the engine never needs ciphertext-÷-ciphertext).
  {
    name: "submitOrderForPairMatch",
    type: "function",
    inputs: [
      {
        name: "inputs",
        type: "tuple",
        components: [
          { name: "eSize",                  type: "bytes32" },
          { name: "sizeProof",              type: "bytes"   },
          { name: "eCollateralPerUnit",     type: "bytes32" },
          { name: "collateralPerUnitProof", type: "bytes"   },
          { name: "eLimitPrice",            type: "bytes32" },
          { name: "limitProof",             type: "bytes"   },
        ],
      },
      { name: "marketId",       type: "uint8"    },
      { name: "isLong",         type: "bool"     },
      { name: "complianceProof",type: "bytes32[]" },
    ],
    outputs: [{ name: "orderId", type: "uint256" }],
    stateMutability: "nonpayable",
  },
];
