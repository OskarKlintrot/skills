export const battlePlan = {
    meta: {
        name: "battle-plan",
        description: "Three parallel plan/review loops, then judge which plan is best.",
        phases: [{ title: "Plan / Review" }, { title: "Judge" }],
        limits: { maxAiCredits: 160 },
        argsSchema: {
            type: "object",
            properties: {
                question: { type: "string" },
                iterations: { type: "integer" },
                models: {
                    type: "object",
                    properties: {
                        question: { type: "string" },
                        plan: { type: "array", items: { type: "string" } },
                        judge: { type: "string" },
                    },
                    required: ["plan", "judge"],
                },
            },
            required: ["question", "iterations", "models"],
        },
    },
    run: async (ctx) => {
        const { question, iterations, models } = ctx.args;
        const isName = (value) => typeof value === "string" && value.trim() !== "";
        if (!isName(question)) {
            throw new Error("question must be a non-empty string.");
        }
        if (!Number.isSafeInteger(iterations) || iterations < 1) {
            throw new Error("iterations must be a positive safe integer.");
        }
        if (!isName(models?.judge)
            || !Array.isArray(models?.plan) || models.plan.length !== 3 || !models.plan.every(isName)) {
            throw new Error("models must name three plan models and a judge model.");
        }

        const agent = async (stage, context, options) => {
            const result = await ctx.agent(`${stage}\n\n${JSON.stringify(context)}`, options);
            if (result === null) throw new Error(`${options.label} failed.`);
            return result;
        };

        ctx.phase("Plan / Review");
        // Each plan is reviewed by the previous branch's plan model, so no branch reviews itself.
        const results = await ctx.parallel(models.plan.map((planModel, index) => async () => {
            const branch = index + 1;
            const reviewModel = models.plan[(index + 2) % 3];
            let plan = null;
            let review = null;
            for (let iteration = 1; iteration <= iterations; iteration++) {
                plan = await agent("Plan", { question, plan, review }, { label: `Plan ${branch}:${iteration}`, model: planModel });
                review = await agent("Review", { question, plan }, { label: `Review ${branch}:${iteration}`, model: reviewModel });
            }
            return { plan, review };
        }));
        if (results.some((result) => result === null)) {
            throw new Error("A plan/review loop failed; judging was not run.");
        }

        ctx.phase("Judge");
        return agent("Judge", { question, results }, { label: "Judge", model: models.judge });
    },
};