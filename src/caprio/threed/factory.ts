import { LocalPrimitiveProvider } from "@/caprio/threed/local-provider";
import { SondialMeshProvider } from "@/caprio/threed/sondial-mesh-provider";
import type { ThreeDProvider } from "@/caprio/threed/provider";

/**
 * Follows Sondial's MESH_PROVIDER. `mock` maps to Caprio's local primitives
 * rather than Sondial's single placeholder mesh, because the component layer
 * needs a distinct shape per part kind (a seat slab is not a leg).
 */
export function createThreeDProvider(override?: ThreeDProvider): ThreeDProvider {
  if (override) return override;
  const explicit = process.env.CAPRIO_MESH_PROVIDER?.trim().toLowerCase();
  const name = explicit || process.env.MESH_PROVIDER?.trim().toLowerCase() || "mock";
  if (name === "local" || name === "mock") {
    return new LocalPrimitiveProvider();
  }
  return new SondialMeshProvider();
}
