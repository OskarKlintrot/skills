import { defineWorkflow, joinSession } from "@github/copilot-sdk/extension";

const helloWorld = defineWorkflow({
    meta: {
        name: "hello-world",
        description:
            "Minimal workflow that verifies dynamic workflows load from the oskar-tools plugin. " +
            "Spawns no subagents. args: { name?: string } - who to greet (defaults to \"world\").",
        phases: [{ title: "Greet" }],
        argsSchema: {
            type: "object",
            properties: {
                name: { type: "string" },
            },
        },
    },
    run: async (ctx) => {
        ctx.phase("Greet");
        const name =
            typeof ctx.args.name === "string" && ctx.args.name.trim() ? ctx.args.name.trim() : "world";
        const greeting = await ctx.step("greeting", () => `Hello, ${name}!`);
        ctx.log(greeting);
        return { greeting, source: "oskar-tools plugin" };
    },
});

await joinSession({ workflows: [helloWorld] });
