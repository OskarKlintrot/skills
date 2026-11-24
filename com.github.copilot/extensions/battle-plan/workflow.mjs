const firstPlanInstruction =
    "Use the installed plan-change skill by invoking it with the skill tool before planning. " +
    "Return exactly one JSON object with string fields status, plan, and reason; do not use " +
    "Markdown fences or surrounding prose. If the skill is unavailable or cannot be loaded, return " +
    "status blocked, an empty plan, and a clear reason; do not substitute a generic plan. If the " +
    "plan cannot be completed, return status blocked with a reason. On success, return status ready, " +
    "the complete Markdown plan in plan (not a summary or file path), and an empty reason.";

export const battlePlan = {
    meta: {
        name: "battle-plan",
        description: "Three parallel plan/review loops, then judge and synthesize the plans.",
        phases: [{ title: "Plan / Review" }, { title: "Judge" }, { title: "Synthesize" }],
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
                const options = { label: `Plan ${branch}:${iteration}`, model: planModel };
                const context = { question, plan, review };
                if (iteration === 1) {
                    const response = await ctx.agent(
                        `Plan\n${firstPlanInstruction}\n\n${JSON.stringify(context)}`,
                        options,
                    );
                    if (typeof response !== "string") {
                        return { failure: `${options.label} failed to return a valid plan-change result.` };
                    }
                    let result;
                    try {
                        result = JSON.parse(response);
                    } catch {
                        return { failure: `${options.label} returned invalid JSON for its plan-change result.` };
                    }
                    if (result === null || typeof result !== "object" || Array.isArray(result)
                        || typeof result.status !== "string" || typeof result.plan !== "string"
                        || typeof result.reason !== "string") {
                        return { failure: `${options.label} returned an invalid plan-change result.` };
                    }
                    if (result.status === "blocked") {
                        const reason = isName(result.reason) ? result.reason : "plan-change was blocked without a reason.";
                        return { failure: `${options.label} blocked: ${reason}` };
                    }
                    if (result.status !== "ready" || !isName(result.plan)) {
                        return { failure: `${options.label} returned an empty or invalid plan-change plan.` };
                    }
                    if (isName(result.reason)) {
                        return { failure: `${options.label} reported a problem: ${result.reason}` };
                    }
                    plan = result.plan;
                } else {
                    plan = await agent("Plan", context, options);
                }
                review = await agent("Review", { question, plan }, { label: `Review ${branch}:${iteration}`, model: reviewModel });
            }
            return { plan, review };
        }));
        const failedPlan = results.find((result) => result?.failure);
        if (failedPlan) {
            throw new Error(failedPlan.failure);
        }
        if (results.some((result) => result === null)) {
            throw new Error("A plan/review loop failed; judging was not run.");
        }

        ctx.phase("Judge");
        const judgment = await agent("Judge", { question, results }, { label: "Judge", model: models.judge });

        ctx.phase("Synthesize");
        return agent("Synthesize", { question, results, judgment }, { label: "Synthesize", model: models.plan[0] });
    },
};