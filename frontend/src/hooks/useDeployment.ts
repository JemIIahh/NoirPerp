import { useQuery } from "@tanstack/react-query";
import { loadDeployment } from "../lib/deployment";

export function useDeployment() {
  return useQuery({
    queryKey: ["deployment"],
    queryFn: loadDeployment,
    staleTime: Infinity,
  });
}
