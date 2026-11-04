import { defineWorkflow, joinSession } from "@github/copilot-sdk/extension";
import { exhaustiveTask } from "./workflow.mjs";

await joinSession({ workflows: [defineWorkflow(exhaustiveTask)] });
