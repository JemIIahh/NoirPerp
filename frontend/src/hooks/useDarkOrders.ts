import { useReadContracts, useReadContract } from "wagmi";
import type { Abi } from "viem";
import { parseAbi } from "viem";
import { useDeployment } from "./useDeployment";
import { DARK_ABI } from "../lib/abis";

// parseAbi handles simple entries; getOrder has a named-tuple return that
// parseAbi cannot parse (viem limitation). Split into two ABIs: one for
// the simple entries (parseAbi), one JSON for getOrder.
const SIMPLE_ABI = parseAbi([
  "function nextOrderId() view returns (uint256)",
]);

const GET_ORDER_ABI: Abi = [
  {
    name: "getOrder",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "orderId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "owner",      type: "address" },
          { name: "marketId",   type: "uint8"   },
          { name: "isLong",     type: "bool"    },
          { name: "active",     type: "bool"    },
          { name: "size",       type: "bytes32" },
          { name: "collateral", type: "bytes32" },
          { name: "limitPrice", type: "bytes32" },
        ],
      },
    ],
  },
];

// Suppress unused import warning — DARK_ABI kept for reference / other hooks.
void (DARK_ABI as unknown);

export function useDarkOrders(owner: `0x${string}` | undefined, limit = 50) {
  const { data: deployment } = useDeployment();
  const dark = deployment?.contracts.DarkpoolEngine;

  const { data: nextId } = useReadContract({
    address: dark, abi: SIMPLE_ABI, functionName: "nextOrderId",
    query: { enabled: !!dark, refetchInterval: 15_000 },
  });

  const total = nextId ? Number(nextId) : 0;
  const fromId = Math.max(0, total - limit);
  const ids = Array.from({ length: total - fromId }, (_, i) => BigInt(fromId + i));

  const orders = useReadContracts({
    contracts: ids.map((id) => ({
      address: dark, abi: GET_ORDER_ABI,
      functionName: "getOrder", args: [id],
    })),
    query: { enabled: !!dark && !!owner && ids.length > 0 },
  });

  if (!owner || !orders.data) return [];

  return ids.flatMap((id, idx) => {
    const o = orders.data![idx]?.result as any;
    if (!o) return [];
    // viem decodes named tuple components as an object with named keys.
    // Fall back to indexed access if .owner is missing (parseAbi edge case).
    const orderOwner: string = o.owner ?? o[0];
    const marketId: number = o.marketId !== undefined ? Number(o.marketId) : Number(o[1]);
    const isLong: boolean = o.isLong !== undefined ? o.isLong : o[2];
    const active: boolean = o.active !== undefined ? o.active : o[3];
    const size: `0x${string}` = o.size ?? o[4];
    const collateral: `0x${string}` = o.collateral ?? o[5];
    const limitPrice: `0x${string}` = o.limitPrice ?? o[6];

    if (!orderOwner || orderOwner.toLowerCase() !== owner.toLowerCase()) return [];
    if (!active) return [];
    return [{
      id, marketId, isLong,
      sizeHandle: size, collateralHandle: collateral, limitPriceHandle: limitPrice,
    }];
  });
}
