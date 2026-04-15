import type { BioTimeClient } from "./client";
import type { BioTimeTerminal } from "./types";

/** Fetch the list of terminals (clock devices) from BioTime. */
export async function getTerminals(
  client: BioTimeClient,
): Promise<BioTimeTerminal[]> {
  return client.fetchAllPages<BioTimeTerminal>("/iclock/api/terminals/");
}
