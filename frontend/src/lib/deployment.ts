import type { Deployment } from "./types";

export async function loadDeployment(): Promise<Deployment> {
  const network = import.meta.env.VITE_DEPLOYMENT_NETWORK ?? "local";
  try {
    const mod = await import(`@deployments/${network}.json`);
    return mod.default as Deployment;
  } catch {
    const res = await fetch(`/deployment.${network}.json`);
    if (!res.ok) throw new Error(`No deployment.json for network=${network}`);
    return (await res.json()) as Deployment;
  }
}
