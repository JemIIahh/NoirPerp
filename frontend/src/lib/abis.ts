// Hand-curated wagmi ABIs (human-readable). Keep minimal so the bundle
// stays small and the surface is auditable. wagmi v2 / viem accept
// these strings via parseAbi(...).

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
  "function getPosition(uint256 positionId) view returns (tuple(address owner, uint8 marketId, bool isLong, bool active, bytes32 size, bytes32 entryPrice, bytes32 collateral))",
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

export const LIMIT_ABI = [
  "function getOrder(uint256 orderId) view returns (tuple(address owner, uint8 orderType, uint8 marketId, bool isLong, bool active, uint256 positionId, bytes32 triggerPrice, bytes32 size, bytes32 collateral))",
  "function cancelOrder(uint256 orderId) external",
] as const;

export const DARK_ABI = [
  "function getOrder(uint256 orderId) view returns (tuple(address owner, uint8 marketId, bool isLong, bool active, bytes32 size, bytes32 collateral, bytes32 limitPrice))",
  "function nextOrderId() view returns (uint256)",
  "function cancelOrder(uint256 orderId) external",
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
] as const;
