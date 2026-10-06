// Shared settings. Foundry is taken from PATH unless FOUNDRY_BIN points at a directory holding forge/cast/anvil.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const OUT_DIR = process.env.GLAMCHECK_OUT ?? join(process.cwd(), "glamcheck-out");

export const foundryTool = (tool: "forge" | "cast" | "anvil") => (process.env.FOUNDRY_BIN ? join(process.env.FOUNDRY_BIN, tool) : tool);

// Execution-only Amsterdam flags (forge 1.8.3+). --hardfork changes the runtime rules without changing the
// compile target; cast run takes --evm-version.
export const AMSTERDAM = {
  forgeRuntime: ["--hardfork", "amsterdam"],
  castRun: ["--evm-version", "amsterdam"],
  anvil: ["--hardfork", "amsterdam"],
} as const;

// Read-only RPC endpoints. Defaults are public ethpandaops endpoints; override with env vars.
export const RPC = {
  sepolia: (process.env.SEPOLIA_RPC ?? "https://rpc.sepolia.ethpandaops.io").split(",").map((s) => s.trim()).filter(Boolean),
};
