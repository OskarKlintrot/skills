const firstPlanInstruction =
    "Use the installed plan-change skill by invoking it with the skill tool before planning. " +
    "Return exactly one JSON object with string fields status, plan, and reason; do not use " +
    "Markdown fences or surrounding prose. If the skill is unavailable or cannot be loaded, return " +
    "status blocked, an empty plan, and a clear reason; do not substitute a generic plan. If the " +
    "plan cannot be completed, return status blocked with a reason. On success, return status ready, " +
    "the complete Markdown plan in plan (not a summary or file path), and an empty reason.";

const reviewInstruction =
    "Review the complete plan against the original question: check that it satisfies every " +
    "requirement without adding unrequested scope. Look for gaps, errors, contradictions, " +
    "ambiguities, unsupported assumptions, and missing validation. Report concrete problems " +
    "and what needs to be corrected; do not rewrite the plan or implement changes. " +
    'Return exactly one JSON object with a findings field containing an array of non-empty strings, ' +
    'without Markdown fences or surrounding prose. Return {"findings":[]} only if no problems remain.';

const revisePlanInstruction =
    "Revise the complete plan to address the review findings while preserving the original " +
    "question's requirements and scope. Return the complete updated Markdown plan, not a summary, " +
    "diff, or file path. Do not implement changes.";

const judgeInstruction =
    "Compare the plans against the original question and choose the most suitable plan. " +
    "Weigh the remaining review findings and each branch's stopReason; a plan at iteration_limit " +
    "still has unresolved findings and must not be described as approved.";

const synthesizeInstruction =
    "Produce the complete final plan using the original question, plans, reviews, and judgment. " +
    "Explicitly report any remaining review findings by branch, including those from branches " +
    "that reached iteration_limit. Do not describe a plan with unresolved findings as approved. " +
    "Do not implement changes.";

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
            required: ["question", "models"],
        },
    },
    run: async (ctx) => {
        const { question, iterations = 3, models } = ctx.args;
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
                    plan = await agent(`Plan\n${revisePlanInstruction}`, context, options);
                    if (!isName(plan)) {
                        return { failure: `${options.label} returned an empty or invalid revised plan.` };
                    }
                }
                const reviewOptions = { label: `Review ${branch}:${iteration}`, model: reviewModel };
                const response = await ctx.agent(
                    `Review\n${reviewInstruction}\n\n${JSON.stringify({ question, plan })}`,
                    reviewOptions,
                );
                if (typeof response !== "string") {
                    return { failure: `${reviewOptions.label} failed to return a valid review.` };
                }
                try {
                    review = JSON.parse(response);
                } catch {
                    return { failure: `${reviewOptions.label} returned invalid JSON for its review.` };
                }
                if (review === null || typeof review !== "object" || Array.isArray(review)
                    || !Array.isArray(review.findings) || !review.findings.every(isName)) {
                    return { failure: `${reviewOptions.label} returned invalid review findings.` };
                }
                if (review.findings.length === 0) {
                    return { plan, review, stopReason: "approved" };
                }
            }
            return { plan, review, stopReason: "iteration_limit" };
        }));
        const failedPlan = results.find((result) => result?.failure);
        if (failedPlan) {
            throw new Error(failedPlan.failure);
        }
        if (results.some((result) => result === null)) {
            throw new Error("A plan/review loop failed; judging was not run.");
        }

        ctx.phase("Judge");
        const judgment = await agent(`Judge\n${judgeInstruction}`, { question, results }, { label: "Judge", model: models.judge });

        ctx.phase("Synthesize");
        return agent(`Synthesize\n${synthesizeInstruction}`, { question, results, judgment }, { label: "Synthesize", model: models.plan[0] });
    },
};