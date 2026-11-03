import { defineWorkflow, joinSession } from "@github/copilot-sdk/extension";
import { lifecycle } from "./workflow.mjs";

await joinSession({ workflows: [defineWorkflow(lifecycle)] });
