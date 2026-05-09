import { useReadContracts, useReadContract } from "wagmi";
import type { Abi } from "viem";
import { parseAbi } from "viem";
import { useDeployment } from "./useDeployment";

// `getPosition` has a named-component tuple return that abitype's
// human-readable parser cannot parse. Use one parsed ABI for
// `nextPositionId` and one JSON-form ABI for `getPosition`.
const SIMPLE_ABI = parseAbi([
  "function nextPositionId() view returns (uint256)",
]);

const GET_POSITION_ABI: Abi = [
  {
    name: "getPosition",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "positionId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "size",       type: "bytes32" },
          { name: "entryPrice", type: "bytes32" },
          { name: "collateral", type: "bytes32" },
          { name: "isLong",     type: "bool"    },
          { name: "marketId",   type: "uint8"   },
          { name: "owner",      type: "address" },
          { name: "active",     type: "bool"    },
        ],
      },
    ],
  },
];

export function usePositions(owner: `0x${string}` | undefined, limit = 50) {
  const { data: deployment } = useDeployment();
  const { data: nextId } = useReadContract({
    address: deployment?.contracts.NoirVault, abi: SIMPLE_ABI, functionName: "nextPositionId",
    query: { enabled: !!deployment, refetchInterval: 15_000 },
  });
  const total = nextId ? Number(nextId) : 0;
  const fromId = Math.max(0, total - limit);
  const ids = Array.from({ length: total - fromId }, (_, i) => BigInt(fromId + i));

  const positions = useReadContracts({
    contracts: ids.map((id) => ({
      address: deployment?.contracts.NoirVault, abi: GET_POSITION_ABI,
      functionName: "getPosition", args: [id],
    })),
    query: { enabled: !!deployment && !!owner && ids.length > 0 },
  });

  if (!owner || !positions.data) return [];

  return ids.flatMap((id, idx) => {
    // viem infers `unknown` for JSON-ABI tuple results; narrowed immediately below.
    const p = positions.data![idx]?.result as any;
    if (!p) return [];
    // viem decodes named tuple components as an object with named keys.
    // Fall back to indexed access if .owner is missing (parseAbi edge case).
    const posOwner: string = p.owner ?? p[5];
    const marketId: number = p.marketId !== undefined ? Number(p.marketId) : Number(p[4]);
    const isLong: boolean = p.isLong !== undefined ? p.isLong : p[3];
    const active: boolean = p.active !== undefined ? p.active : p[6];
    const size: `0x${string}` = p.size ?? p[0];
    const entryPrice: `0x${string}` = p.entryPrice ?? p[1];
    const collateral: `0x${string}` = p.collateral ?? p[2];

    if (!posOwner || posOwner.toLowerCase() !== owner.toLowerCase()) return [];
    if (!active) return [];
    return [{
      id, owner: posOwner, marketId, isLong,
      sizeHandle: size, entryPriceHandle: entryPrice, collateralHandle: collateral,
    }];
  });
}
