const planResultInstruction =
    "Return exactly one JSON object with string fields status, plan, and reason, and a findings array; " +
    "do not use Markdown fences or surrounding prose. On success, return status ready, " +
    "the complete Markdown plan in plan (not a summary or file path), and an empty reason. " +
    "If the plan cannot be completed, return status blocked with an empty plan and a clear reason. " +
    "Record investigation findings separately from the plan in findings. Each finding must have " +
    "non-empty string fields id, finding, and reason, a non-empty evidence array of non-empty " +
    "source strings (file/symbol references, documentation, or observed command output), and status " +
    "active, resolved, or rejected. Use stable IDs within this branch; reuse an ID to update a finding " +
    "and explain the change in reason. Return only new or updated findings, or [] if there are none. " +
    "The workflow appends each round to your private ledger; earlier rounds are preserved. " +
    "Keep ledger entries and history out of the Markdown plan; include the evidence needed to " +
    "understand the plan itself. Do not write ledger files or implement changes.";

const planChangeInstruction =
    "Use the installed plan-change skill by invoking it with the skill tool before planning. " +
    "Follow its full template, tone, evidence requirements, scope rules, and merge-risk guidance. " +
    "If the skill is unavailable or cannot be loaded, return " +
    "status blocked, an empty plan, and a clear reason; do not substitute a generic plan. ";

const firstPlanInstruction = planChangeInstruction + planResultInstruction;

const reviewInstruction =
    "Review the complete plan against the original question: check that it satisfies every " +
    "requirement without adding unrequested scope. Look for gaps, errors, contradictions, " +
    "ambiguities, unsupported assumptions, and missing validation. Report concrete problems " +
    "and what needs to be corrected; do not rewrite the plan or implement changes. " +
    'Return exactly one JSON object with a findings field containing an array of non-empty strings, ' +
    'without Markdown fences or surrounding prose. Return {"findings":[]} only if no problems remain.';

const revisePlanInstruction =
    "Revise the complete plan to address the review findings while preserving the original " +
    "question's requirements and scope. Consult your branch's ledger and update findings whose " +
    "evidence or conclusions changed. Return the complete updated Markdown plan in plan, not a summary, " +
    "diff, or file path. Do not implement changes. " + planResultInstruction;

const judgeInstruction =
    "Compare the plans against the original question and choose the most suitable plan. " +
    "Use all three complete plans and their accumulated ledgers, checking claims against available " +
    "repository code and documentation rather than treating ledger entries as facts. Use the latest " +
    "entry for each branch-local finding ID while considering its history and status. " +
    "Weigh the remaining review findings and each branch's stopReason; a plan at iteration_limit " +
    "still has unresolved findings and must not be described as approved. " +
    "Decide what concrete additions to take from each of the other two plans. " +
    "Return exactly one JSON object with winner (an integer branch number 1-3), reason (a non-empty " +
    "string), and takeFromOthers (exactly one entry for each other branch). Each entry must have " +
    "branch, reason (a non-empty rationale, including why nothing should be taken if additions is " +
    "empty), and additions (an array of objects with non-empty string fields change, sourceSection, " +
    "and rationale). Reference sections of the supplied plans so Synthesize can use them directly. " +
    "Return only the decision and supporting rationale, not raw ledger entries, IDs, or history. " +
    "Do not use Markdown fences, write files, or implement changes.";

const synchronizeInstruction =
    "Combine the plans into one complete Markdown draft using the original question, all three " +
    "complete plans, reviews, and judgment. Use judgment.winner as the base and apply the additions " +
    "selected in judgment.takeFromOthers from the referenced plan sections. Follow Judge's decision; " +
    "do not choose the winner again. Reconcile overlapping selected additions and explicitly report " +
    "any contradiction you cannot reconcile without changing that decision. " +
    "Explicitly report any remaining review findings by branch, including those from branches " +
    "that reached iteration_limit. Do not describe a plan with unresolved findings as approved. " +
    "Return only the complete Markdown draft, not a summary or file path. " +
    "Do not write files or implement changes.";

const synthesizeInstruction = planChangeInstruction +
    "Compose the complete final Markdown plan from the original question, all three complete " +
    "plans, reviews, judgment, and the synchronized draft. Keep the content of the synchronized " +
    "draft, which already applies Judge's decision; do not choose the winner again or add changes " +
    "Judge did not select. Use the other inputs only to resolve gaps or ambiguities in the draft. " +
    "Keep any contradictions the draft reports and explicitly report any remaining review findings " +
    "by branch, including those from branches that reached iteration_limit. Do not describe a plan " +
    "with unresolved findings as approved. " +
    "Keep the skill's template headings and markers; write the prose in the original question's language. " +
    "Return exactly one JSON object with string fields status, plan, and reason, without Markdown " +
    "fences or surrounding prose. On success, return status ready, the complete final Markdown plan " +
    "in plan (not a summary or file path), and an empty reason. If the skill cannot be loaded or " +
    "the plan cannot be completed, return status blocked with an empty plan and a clear reason. " +
    "Do not write files or implement changes.";

export const battlePlan = {
    meta: {
        name: "battle-plan",
        description: "Three parallel plan/review loops, then judge, synchronize, and synthesize the plans.",
        phases: [{ title: "Plan / Review" }, { title: "Judge" }, { title: "Synchronize" }, { title: "Synthesize" }],
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

        const parseObject = (response, label, kind) => {
            if (typeof response !== "string") {
                throw new Error(`${label} failed to return a valid ${kind}.`);
            }
            let result;
            try {
                result = JSON.parse(response);
            } catch {
                throw new Error(`${label} returned invalid JSON for its ${kind}.`);
            }
            if (result === null || typeof result !== "object" || Array.isArray(result)) {
                throw new Error(`${label} returned an invalid ${kind}.`);
            }
            return result;
        };
        const validFinding = (finding) => finding !== null && typeof finding === "object"
            && !Array.isArray(finding) && isName(finding.id) && isName(finding.finding)
            && isName(finding.reason) && ["active", "resolved", "rejected"].includes(finding.status)
            && Array.isArray(finding.evidence) && finding.evidence.length > 0
            && finding.evidence.every(isName);

        ctx.phase("Plan / Review");
        // Each plan is reviewed by the previous branch's plan model, so no branch reviews itself.
        const results = await ctx.parallel(models.plan.map((planModel, index) => async () => {
            const branch = index + 1;
            const reviewModel = models.plan[(index + 2) % 3];
            let plan = null;
            let review = null;
            const ledger = [];
            for (let iteration = 1; iteration <= iterations; iteration++) {
                const options = { label: `Plan ${branch}:${iteration}`, model: planModel };
                const context = { question, plan, review, ledger };
                try {
                    const response = await ctx.agent(
                        `Plan\n${iteration === 1 ? firstPlanInstruction : revisePlanInstruction}\n\n${JSON.stringify(context)}`,
                        options,
                    );
                    const kind = iteration === 1 ? "plan-change result" : "revised plan result";
                    const result = parseObject(response, options.label, kind);
                    if (typeof result.status !== "string" || typeof result.plan !== "string"
                        || typeof result.reason !== "string") {
                        return { failure: `${options.label} returned an invalid ${kind}.` };
                    }
                    if (result.status === "blocked") {
                        const reason = isName(result.reason) ? result.reason : "plan-change was blocked without a reason.";
                        return { failure: `${options.label} blocked: ${reason}` };
                    }
                    if (result.status !== "ready" || !isName(result.plan)) {
                        return { failure: `${options.label} returned an empty or invalid plan.` };
                    }
                    if (isName(result.reason)) {
                        return { failure: `${options.label} reported a problem: ${result.reason}` };
                    }
                    if (!Array.isArray(result.findings) || !result.findings.every(validFinding)
                        || new Set(result.findings.map(({ id }) => id)).size !== result.findings.length) {
                        return { failure: `${options.label} returned invalid ledger findings.` };
                    }
                    // Store only the defined fields; agent-added data never becomes downstream context.
                    const findings = result.findings.map(({ id, finding, evidence, status, reason }) => ({
                        id, finding, evidence, status, reason,
                    }));
                    ledger.push({ iteration, findings });
                    plan = result.plan;
                } catch (error) {
                    return { failure: `${options.label} failed: ${error.message}` };
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
                    return { branch, plan, review: { findings: review.findings }, stopReason: "approved", ledger };
                }
            }
            return { branch, plan, review: { findings: review.findings }, stopReason: "iteration_limit", ledger };
        }));
        const failedPlan = results.find((result) => result?.failure);
        if (failedPlan) {
            throw new Error(failedPlan.failure);
        }
        if (results.some((result) => result === null)) {
            throw new Error("A plan/review loop failed; judging was not run.");
        }

        ctx.phase("Judge");
        const response = await agent(`Judge\n${judgeInstruction}`, { question, results }, { label: "Judge", model: models.judge });
        const decision = parseObject(response, "Judge", "judgment");
        const validAddition = (addition) => addition !== null && typeof addition === "object"
            && !Array.isArray(addition) && isName(addition.change)
            && isName(addition.sourceSection) && isName(addition.rationale);
        if (![1, 2, 3].includes(decision.winner) || !isName(decision.reason)
            || !Array.isArray(decision.takeFromOthers) || decision.takeFromOthers.length !== 2
            || !decision.takeFromOthers.every((entry) => entry !== null && typeof entry === "object"
                && !Array.isArray(entry) && [1, 2, 3].includes(entry.branch)
                && entry.branch !== decision.winner && isName(entry.reason)
                && Array.isArray(entry.additions) && entry.additions.every(validAddition))
            || new Set(decision.takeFromOthers.map(({ branch }) => branch)).size !== 2) {
            throw new Error("Judge returned an invalid judgment.");
        }
        const judgment = {
            winner: decision.winner,
            reason: decision.reason,
            takeFromOthers: decision.takeFromOthers.map(({ branch, reason, additions }) => ({
                branch,
                reason,
                additions: additions.map(({ change, sourceSection, rationale }) => ({
                    change, sourceSection, rationale,
                })),
            })),
        };

        ctx.phase("Synchronize");
        const plans = results.map(({ branch, plan, review, stopReason }) => ({
            branch, plan, review, stopReason,
        }));
        const synchronized = await agent(`Synchronize\n${synchronizeInstruction}`, { question, results: plans, judgment }, { label: "Synchronize", model: models.plan[0] });
        if (!isName(synchronized)) throw new Error("Synchronize returned an empty or invalid plan.");

        ctx.phase("Synthesize");
        const synthesisResponse = await agent(`Synthesize\n${synthesizeInstruction}`, { question, results: plans, judgment, synchronized }, { label: "Synthesize", model: models.plan[0] });
        const synthesis = parseObject(synthesisResponse, "Synthesize", "plan-change result");
        if (typeof synthesis.status !== "string" || typeof synthesis.plan !== "string"
            || typeof synthesis.reason !== "string") {
            throw new Error("Synthesize returned an invalid plan-change result.");
        }
        if (synthesis.status === "blocked") {
            const reason = isName(synthesis.reason) ? synthesis.reason : "plan-change was blocked without a reason.";
            throw new Error(`Synthesize blocked: ${reason}`);
        }
        if (synthesis.status !== "ready" || !isName(synthesis.plan)) {
            throw new Error("Synthesize returned an empty or invalid plan.");
        }
        if (isName(synthesis.reason)) {
            throw new Error(`Synthesize reported a problem: ${synthesis.reason}`);
        }
        return synthesis.plan;
    },
};