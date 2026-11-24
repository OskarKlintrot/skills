import { defineWorkflow, joinSession } from "@github/copilot-sdk/extension";
import { battlePlan } from "./workflow.mjs";

await joinSession({ workflows: [defineWorkflow(battlePlan)] });
