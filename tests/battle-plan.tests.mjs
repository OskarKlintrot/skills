import assert from "node:assert/strict";
import { test } from "node:test";
import { battlePlan } from "../com.github.copilot/extensions/battle-plan/workflow.mjs";

const models = { plan: ["p1", "p2", "p3"], judge: "j-model" };

function reviewFor(label) {
    return { findings: [`${label} finding`] };
}

function planResult(plan, findings = []) {
    return JSON.stringify({ status: "ready", plan, reason: "", findings });
}

function judgmentFor(winner = 1) {
    return {
        winner,
        reason: `Plan ${winner} best meets the request`,
        takeFromOthers: [1, 2, 3].filter((branch) => branch !== winner).map((branch) => ({
            branch, reason: "Use its additional validation", additions: [{
                change: `Include plan ${branch}'s validation`,
                sourceSection: "Test Cases", rationale: "Covers a missing case",
            }],
        })),
    };
}

function ledgerFor(rounds) {
    return Array.from({ length: rounds }, (_, index) => ({ iteration: index + 1, findings: [] }));
}

function withLedgers(results) {
    return results.map((result) => ({
        ...result, ledger: ledgerFor(Number(result.plan.match(/:(\d+) result$/)[1])),
    }));
}

function resultFor({ stage, label }) {
    if (stage === "Review") return JSON.stringify(reviewFor(label));
    if (stage === "Plan") return planResult(`${label} result`);
    if (stage === "Judge") return JSON.stringify(judgmentFor());
    if (stage === "Synthesize") {
        return JSON.stringify({ status: "ready", plan: `${label} result`, reason: "" });
    }
    return `${label} result`;
}

function harness(args, handler = resultFor) {
    const calls = [];
    const phases = [];
    const ctx = {
        args,
        phase(title) { phases.push(title); },
        async agent(prompt, options) {
            const [instruction, json] = prompt.split("\n\n");
            const [stage] = instruction.split("\n");
            const call = { stage, instruction, context: JSON.parse(json), ...options };
            calls.push(call);
            return handler(call);
        },
        async parallel(thunks) {
            return Promise.all(thunks.map(async (thunk) => {
                try {
                    return await thunk();
                } catch {
                    return null;
                }
            }));
        },
    };
    return { calls, phases, run: () => battlePlan.run(ctx) };
}

test("three independent loops feed final results into judging and synthesis", async () => {
    assert.equal(battlePlan.meta.limits.maxAiCredits, 160);
    const h = harness({ question: "A question", iterations: 2, models });
    assert.equal(await h.run(), "Synthesize result");
    assert.equal(h.calls.length, 14);
    assert.deepEqual(h.phases, ["Plan / Review", "Judge", "Synthesize"]);
    assert.deepEqual(battlePlan.meta.phases.map(({ title }) => title), h.phases);
    assert.equal(new Set(h.calls.map(({ label }) => label)).size, h.calls.length);
    for (const [index, [model, reviewModel]] of [
        ["p1", "p3"],
        ["p2", "p1"],
        ["p3", "p2"],
    ].entries()) {
        const branch = index + 1;
        const find = (label) => h.calls.find((call) => call.label === label);
        for (const iteration of [1, 2]) {
            assert.equal(find(`Plan ${branch}:${iteration}`).model, model);
            assert.equal(find(`Review ${branch}:${iteration}`).model, reviewModel);
        }
        assert.deepEqual(find(`Plan ${branch}:1`).context, {
            question: "A question", plan: null, review: null, ledger: [],
        });
        assert.deepEqual(find(`Review ${branch}:1`).context, {
            question: "A question", plan: `Plan ${branch}:1 result`,
        });
        assert.deepEqual(find(`Plan ${branch}:2`).context, {
            question: "A question", plan: `Plan ${branch}:1 result`, review: reviewFor(`Review ${branch}:1`),
            ledger: ledgerFor(1),
        });
        assert.deepEqual(find(`Review ${branch}:2`).context, {
            question: "A question", plan: `Plan ${branch}:2 result`,
        });
    }
    const results = [1, 2, 3].map((branch) => ({
        branch,
        plan: `Plan ${branch}:2 result`, review: reviewFor(`Review ${branch}:2`),
        stopReason: "iteration_limit",
    }));
    const judge = h.calls.at(-2);
    assert.equal(judge.stage, "Judge");
    assert.equal(judge.label, "Judge");
    assert.equal(judge.model, "j-model");
    assert.deepEqual(judge.context, { question: "A question", results: withLedgers(results) });
    assert.match(judge.instruction, /remaining review findings/);
    assert.match(judge.instruction, /must not be described as approved/);
    const synthesis = h.calls.at(-1);
    assert.equal(synthesis.stage, "Synthesize");
    assert.equal(synthesis.label, "Synthesize");
    assert.equal(synthesis.model, "p1");
    assert.deepEqual(synthesis.context, { question: "A question", results, judgment: judgmentFor() });
    assert.match(synthesis.instruction, /report any remaining review findings by branch/);
    assert.match(synthesis.instruction, /iteration_limit/);
    assert.match(synthesis.instruction, /Do not describe a plan with unresolved findings as approved/);
});

test("first plans use plan-change and pass complete Markdown to review", async () => {
    const planFor = (label) => `## Summary\n\n- ${label}\n\n## Evidence\n\n` +
        "`C:\\repo\\file`\n\n## Test Cases\n\n1. Check the plan.\n\n" +
        "## Out-of-Scope\n\n- Other changes.\n\n## Merge Danger\n\nTwo-way.\n";
    const h = harness({ question: "A question", iterations: 2, models }, (call) => {
        if (call.stage === "Plan") {
            return planResult(planFor(call.label));
        }
        return resultFor(call);
    });
    await h.run();
    const find = (label) => h.calls.find((call) => call.label === label);
    for (const branch of [1, 2, 3]) {
        const first = find(`Plan ${branch}:1`);
        assert.match(first.instruction, /plan-change/);
        assert.match(first.instruction, /skill tool/i);
        assert.match(first.instruction, /complete Markdown plan/i);
        assert.match(first.instruction, /unavailable|cannot be loaded/i);
        assert.match(first.instruction, /exactly one JSON object/i);
        assert.match(first.instruction, /status, plan, and reason, and a findings array/);
        assert.equal(first.schema, undefined);
        const review = find(`Review ${branch}:1`);
        assert.deepEqual(review.context, { question: "A question", plan: planFor(first.label) });
        assert.match(review.instruction, /complete plan against the original question/);
        assert.match(review.instruction, /every requirement/);
        assert.match(review.instruction, /unrequested scope/);
        assert.match(review.instruction, /gaps, errors, contradictions, ambiguities/);
        assert.match(review.instruction, /unsupported assumptions, and missing validation/);
        assert.match(review.instruction, /do not rewrite the plan or implement changes/);
        assert.match(review.instruction, /exactly one JSON object/);
        assert.match(review.instruction, /array of non-empty strings/);
        const later = find(`Plan ${branch}:2`);
        assert.match(later.instruction, /Revise the complete plan to address the review findings/);
        assert.match(later.instruction, /preserving the original question's requirements and scope/);
        assert.match(later.instruction, /complete updated Markdown plan/);
        assert.match(later.instruction, /Do not implement changes/);
        assert.equal(later.schema, undefined);
        assert.deepEqual(later.context, {
            question: "A question",
            plan: planFor(first.label),
            review: reviewFor(`Review ${branch}:1`),
            ledger: ledgerFor(1),
        });
        assert.deepEqual(find(`Review ${branch}:2`).context, {
            question: "A question", plan: planFor(later.label),
        });
    }
});

test("synthesis loads plan-change and returns the complete final plan verbatim", async () => {
    const finalPlan = [
        "## Summary",
        "",
        "```diff",
        " Plan / Review",
        " Judge",
        " Synthesize",
        "+  use plan-change",
        "```",
        "",
        "## Evidence",
        "",
        "- **Before:** Synthesize returns unformatted text.",
        "  **After:** The regression test will check the complete final plan.",
        "",
        "## Test Cases",
        "",
        "1. Preserve the final plan, including whitespace and code blocks.",
        "",
        "## Out-of-Scope",
        "",
        "- Implementing the generated plan.",
        "",
        "**Edge Cases:** Changes to other workflows.",
        "",
        "## Merge Danger",
        "",
        "**Door:** two-way",
        "",
        "**Blast Radius:** workflow",
        "",
    ].join("\r\n");
    const h = harness({ question: "Q", iterations: 1, models }, (call) =>
        call.stage === "Synthesize"
            ? JSON.stringify({ status: "ready", plan: finalPlan, reason: "" })
            : resultFor(call));
    assert.equal(await h.run(), finalPlan);
    assert.deepEqual(h.phases, ["Plan / Review", "Judge", "Synthesize"]);
    assert.equal(h.calls.length, 8);
    const synthesis = h.calls.at(-1);
    assert.equal(synthesis.stage, "Synthesize");
    assert.match(synthesis.instruction, /plan-change/);
    assert.match(synthesis.instruction, /skill tool/i);
    assert.match(synthesis.instruction, /template, tone, evidence/);
    assert.match(synthesis.instruction, /unavailable|cannot be loaded/);
    assert.match(synthesis.instruction, /exactly one JSON object/);
    assert.match(synthesis.instruction, /complete final Markdown plan/);
    assert.equal(synthesis.schema, undefined);
});

test("empty findings stop all branches after their first review", async () => {
    const h = harness({ question: "Q", models }, (call) =>
        call.stage === "Review" ? JSON.stringify({ findings: [] }) : resultFor(call));
    assert.equal(await h.run(), "Synthesize result");
    assert.equal(h.calls.length, 8);
    assert.ok(!h.calls.some(({ label }) => label.endsWith(":2")));
    const results = [1, 2, 3].map((branch) => ({
        branch,
        plan: `Plan ${branch}:1 result`, review: { findings: [] }, stopReason: "approved",
    }));
    assert.deepEqual(h.calls.at(-2).context, { question: "Q", results: withLedgers(results) });
    assert.deepEqual(h.calls.at(-1).context, { question: "Q", results, judgment: judgmentFor() });
});

test("omitted iterations default to three reviews per branch", async () => {
    const h = harness({ question: "Q", models });
    assert.equal(await h.run(), "Synthesize result");
    assert.equal(h.calls.length, 20);
    assert.ok(!battlePlan.meta.argsSchema.required.includes("iterations"));
    for (const branch of [1, 2, 3]) {
        assert.ok(h.calls.some(({ label }) => label === `Review ${branch}:3`));
        assert.ok(!h.calls.some(({ label }) => label === `Plan ${branch}:4`));
    }
    assert.deepEqual(h.calls.at(-2).context.results, withLedgers([1, 2, 3].map((branch) => ({
        branch,
        plan: `Plan ${branch}:3 result`,
        review: reviewFor(`Review ${branch}:3`),
        stopReason: "iteration_limit",
    }))));
});

test("an explicit single round forwards unresolved findings without an unreviewed revision", async () => {
    const h = harness({ question: "Q", iterations: 1, models }, (call) =>
        call.label === "Review 1:1" ? JSON.stringify({ findings: [] }) : resultFor(call));
    assert.equal(await h.run(), "Synthesize result");
    assert.equal(h.calls.length, 8);
    assert.ok(!h.calls.some(({ label }) => label.endsWith(":2")));
    assert.deepEqual(h.calls.at(-2).context.results, withLedgers([1, 2, 3].map((branch) => ({
        branch,
        plan: `Plan ${branch}:1 result`,
        review: branch === 1 ? { findings: [] } : reviewFor(`Review ${branch}:1`),
        stopReason: branch === 1 ? "approved" : "iteration_limit",
    }))));
});

test("branches stop at different rounds and preserve their latest reviewed plans", async () => {
    const h = harness({ question: "Q", iterations: 3, models }, (call) => {
        if (call.label === "Review 1:1" || call.label === "Review 2:2") {
            return JSON.stringify({ findings: [] });
        }
        return resultFor(call);
    });
    await h.run();
    assert.equal(h.calls.length, 14);
    assert.ok(!h.calls.some(({ label }) => label === "Plan 1:2" || label === "Plan 2:3"));
    assert.deepEqual(h.calls.at(-2).context.results, withLedgers([
        { branch: 1, plan: "Plan 1:1 result", review: { findings: [] }, stopReason: "approved" },
        { branch: 2, plan: "Plan 2:2 result", review: { findings: [] }, stopReason: "approved" },
        { branch: 3, plan: "Plan 3:3 result", review: reviewFor("Review 3:3"), stopReason: "iteration_limit" },
    ]));
});

test("branches run concurrently and advance without waiting for another branch's review", async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let started;
    const h = harness({ question: "A question", iterations: 2, models }, async (call) => {
        const { label } = call;
        if (label === "Plan 3:1") started = h.calls.map((call) => call.label);
        if (label === "Plan 1:1") await gate;
        if (label === "Review 3:2") release();
        return resultFor(call);
    });
    assert.equal(await h.run(), "Synthesize result");
    assert.deepEqual(started, ["Plan 1:1", "Plan 2:1", "Plan 3:1"]);
    const index = (label) => h.calls.findIndex((call) => call.label === label);
    assert.ok(index("Review 3:2") < index("Review 1:1"));
    assert.ok(index("Judge") > index("Review 1:2"));
    assert.ok(index("Synthesize") > index("Judge"));
});

test("invalid inputs fail before spawning agents", async () => {
    for (const args of [
        {}, { question: "", iterations: 1, models }, { question: " ", iterations: 1, models },
        { question: 1, iterations: 1, models },
        ...[0, -1, 1.5, "2", null, Number.MAX_SAFE_INTEGER + 1].map((iterations) => ({
            question: "Q", iterations, models,
        })),
        ...[undefined, {}, { ...models, judge: 1 },
            { ...models, plan: ["p1", "p2"] }, { ...models, plan: ["p1", "p2", " "] }].map((bad) => ({
            question: "Q", iterations: 1, models: bad,
        })),
    ]) {
        const h = harness(args);
        await assert.rejects(h.run);
        assert.equal(h.calls.length, 0);
    }
});

test("a failed plan or review blocks judging", async () => {
    for (const failed of ["Plan 2:1", "Review 2:1"]) {
        const h = harness({ question: "Q", iterations: 1, models }, (call) =>
            call.label === failed ? null : resultFor(call));
        await assert.rejects(h.run, new RegExp(`${failed} failed`));
        assert.ok(!h.calls.some(({ stage }) => stage === "Judge"));
        assert.ok(!h.calls.some(({ stage }) => stage === "Synthesize"));
        if (failed.startsWith("Plan")) {
            assert.ok(!h.calls.some(({ label }) => label === "Review 2:1"));
        }
    }
});

test("malformed reviews block their branch and judging rather than counting as approval", async () => {
    for (const response of [
        undefined, "", "not JSON", '```json\n{"findings":[]}\n```',
        ...[null, [], {}, { findings: null }, { findings: "none" }, { findings: [1] },
            { findings: [""] }, { findings: [" \n "] }, { findings: ["A problem", null] },
        ].map((value) => JSON.stringify(value)),
    ]) {
        const h = harness({ question: "Q", iterations: 2, models }, (call) =>
            call.label === "Review 2:1" ? response : resultFor(call));
        await assert.rejects(h.run, /Review 2:1.*(valid review|invalid JSON|invalid review findings)/);
        assert.ok(!h.calls.some(({ label }) => label === "Plan 2:2"));
        assert.ok(!h.calls.some(({ stage }) => stage === "Judge" || stage === "Synthesize"));
    }
});

test("malformed or empty revised plans block another review and judging", async () => {
    for (const response of ["", " \n ", undefined, {}, [], planResult(" "), planResult(null)]) {
        const h = harness({ question: "Q", iterations: 2, models }, (call) =>
            call.label === "Plan 2:2" ? response : resultFor(call));
        await assert.rejects(h.run, /Plan 2:2.*(valid revised plan result|invalid|empty)/);
        assert.ok(!h.calls.some(({ label }) => label === "Review 2:2"));
        assert.ok(!h.calls.some(({ stage }) => stage === "Judge" || stage === "Synthesize"));
    }
});

test("a missing plan-change skill stops its branch and preserves the reason", async () => {
    const reason = "plan-change is unavailable";
    const h = harness({ question: "Q", iterations: 2, models }, (call) =>
        call.label === "Plan 2:1"
            ? JSON.stringify({ status: "blocked", plan: "", reason })
            : resultFor(call));
    await assert.rejects(h.run, /Plan 2:1.*plan-change is unavailable/);
    assert.ok(!h.calls.some(({ label }) => label === "Review 2:1" || label === "Plan 2:2"));
    assert.ok(h.calls.some(({ label }) => label === "Review 1:2"));
    assert.ok(h.calls.some(({ label }) => label === "Review 3:2"));
    assert.ok(!h.calls.some(({ stage }) => stage === "Judge" || stage === "Synthesize"));
});

test("invalid or empty first plans stop their branch before review", async () => {
    for (const { result, message } of [
        { result: null, message: /failed to return a valid/ },
        { result: "not JSON", message: /invalid JSON/ },
        { result: JSON.stringify({ status: "ready", plan: " \n ", reason: "" }), message: /empty or invalid/ },
        { result: JSON.stringify({ status: "ready", plan: null, reason: "" }), message: /invalid plan-change result/ },
        { result: JSON.stringify({ status: "ready", plan: "A fallback plan", reason: "plan-change is unavailable" }),
            message: /plan-change is unavailable/ },
        { result: JSON.stringify({ status: "ready", plan: "A plan" }), message: /invalid plan-change result/ },
        { result: JSON.stringify({ status: "blocked", plan: "", reason: "" }), message: /blocked without a reason/ },
        { result: JSON.stringify({ status: "invalid", plan: "A plan", reason: "" }), message: /empty or invalid/ },
    ]) {
        const h = harness({ question: "Q", iterations: 1, models }, (call) =>
            call.label === "Plan 1:1" ? result : resultFor(call));
        await assert.rejects(h.run, (error) => {
            assert.match(error.message, /Plan 1:1/);
            assert.match(error.message, message);
            return true;
        });
        assert.ok(!h.calls.some(({ label }) => label === "Review 1:1"));
        assert.ok(!h.calls.some(({ stage }) => stage === "Judge" || stage === "Synthesize"));
    }
});

test("a failed judgment blocks synthesis", async () => {
    const h = harness({ question: "Q", iterations: 1, models }, (call) =>
        call.label === "Judge" ? null : resultFor(call));
    await assert.rejects(h.run, /Judge failed/);
    assert.ok(!h.calls.some(({ stage }) => stage === "Synthesize"));
});

test("a failed synthesis is not reported as success", async () => {
    const h = harness({ question: "Q", iterations: 1, models }, (call) =>
        call.label === "Synthesize" ? null : resultFor(call));
    await assert.rejects(h.run, /Synthesize failed/);
});

test("branch ledgers accumulate sourced finding updates and stay out of review and synthesis", async () => {
    const findingFor = (branch, iteration) => ({
        id: "shared-id",
        finding: `PRIVATE_LEDGER_${branch}`,
        evidence: [`src\\branch-${branch}.mjs:10`],
        status: ["active", "resolved", "rejected"][iteration - 1],
        reason: `PRIVATE_REASON_${branch}_${iteration}`,
    });
    const h = harness({ question: "Q", iterations: 3, models }, (call) => {
        if (call.stage === "Plan") {
            const [, branch, iteration] = call.label.match(/Plan (\d):(\d)/).map(Number);
            return planResult(`${call.label} result`, [findingFor(branch, iteration)]);
        }
        return resultFor(call);
    });
    await h.run();
    const judge = h.calls.find(({ stage }) => stage === "Judge");
    for (const branch of [1, 2, 3]) {
        const ledger = [1, 2, 3].map((iteration) => ({
            iteration, findings: [findingFor(branch, iteration)],
        }));
        const result = judge.context.results.find((result) => result.branch === branch);
        assert.deepEqual(result.ledger, ledger);
        for (const iteration of [1, 2, 3]) {
            const plan = h.calls.find(({ label }) => label === `Plan ${branch}:${iteration}`);
            assert.deepEqual(plan.context.ledger, ledger.slice(0, iteration - 1));
            assert.match(plan.instruction, /Do not write ledger files/);
            assert.match(plan.instruction, /Keep ledger entries and history out of the Markdown plan/);
        }
    }
    for (const call of h.calls.filter(({ stage }) => stage === "Review" || stage === "Synthesize")) {
        assert.doesNotMatch(JSON.stringify(call.context), /ledger|PRIVATE_/i);
    }
    assert.match(judge.instruction, /checking claims against available repository code and documentation/);
    assert.match(judge.instruction, /not raw ledger entries, IDs, or history/);
    const synthesis = h.calls.at(-1);
    assert.match(synthesis.instruction, /Follow Judge's decision/);
    assert.match(synthesis.instruction, /contradiction you cannot reconcile/);
});

test("a round without finding updates does not drop earlier ledger entries", async () => {
    const finding = {
        id: "source", finding: "A verified fact", evidence: ["file.mjs:4"],
        status: "active", reason: "Constrains the approach",
    };
    const h = harness({ question: "Q", iterations: 2, models }, (call) =>
        call.label === "Plan 1:1" ? planResult("Plan 1:1 result", [finding]) : resultFor(call));
    await h.run();
    assert.deepEqual(h.calls.at(-2).context.results[0].ledger, [
        { iteration: 1, findings: [finding] }, { iteration: 2, findings: [] },
    ]);
});

test("each winner forwards all three complete plans and selected or rejected additions", async () => {
    const planFor = (branch) => [
        "", "## Summary", `Plan ${branch}  `, "", "```diff",
        "- old", `+ branch ${branch}`, "```", "", "## Evidence",
        "`C:\\repo\\file.mjs:4`", "", "## Test Cases", `Full case ${branch}`, "",
    ].join("\r\n");
    for (const winner of [1, 2, 3]) {
        const decision = judgmentFor(winner);
        decision.takeFromOthers[1].additions = [];
        decision.takeFromOthers[1].reason = "No useful additions";
        const h = harness({ question: "Q", iterations: 1, models }, (call) => {
            if (call.stage === "Plan") return planResult(planFor(Number(call.label[5])));
            if (call.stage === "Judge") return JSON.stringify(decision);
            return resultFor(call);
        });
        await h.run();
        const judge = h.calls.at(-2);
        const synthesis = h.calls.at(-1);
        assert.deepEqual(synthesis.context.judgment, decision);
        for (const branch of [1, 2, 3]) {
            const review = h.calls.find(({ label }) => label === `Review ${branch}:1`);
            assert.equal(review.context.plan, planFor(branch));
            for (const call of [judge, synthesis]) {
                assert.equal(call.context.results[branch - 1].branch, branch);
                assert.equal(call.context.results[branch - 1].plan, planFor(branch));
            }
        }
    }
});

test("only defined fields from agent JSON become downstream inputs", async () => {
    const finding = {
        id: "f", finding: "Fact", evidence: ["file.mjs:2"], status: "active", reason: "Relevant",
    };
    const decision = judgmentFor();
    const h = harness({ question: "Q", iterations: 1, models }, (call) => {
        if (call.stage === "Plan") return JSON.stringify({
            ...JSON.parse(planResult(`${call.label} result`, [{ ...finding, extra: "DROP_ME" }])),
            extra: "DROP_ME",
        });
        if (call.stage === "Review") return JSON.stringify({ findings: [], ledger: "DROP_ME" });
        if (call.stage === "Judge") return JSON.stringify({
            ...decision, ledger: "DROP_ME",
            takeFromOthers: decision.takeFromOthers.map((entry) => ({
                ...entry, ledger: "DROP_ME",
                additions: entry.additions.map((addition) => ({ ...addition, ledger: "DROP_ME" })),
            })),
        });
        return resultFor(call);
    });
    await h.run();
    assert.doesNotMatch(JSON.stringify(h.calls.at(-2).context), /DROP_ME/);
    assert.doesNotMatch(JSON.stringify(h.calls.at(-1).context), /DROP_ME|ledger/);
    assert.deepEqual(h.calls.at(-1).context.judgment, decision);
});

test("malformed ledger findings in any plan round block its review and Judge", async () => {
    const finding = {
        id: "f", finding: "Fact", evidence: ["file.mjs:2"], status: "active", reason: "Relevant",
    };
    for (const iteration of [1, 2]) {
        for (const findings of [
            undefined, null, {}, "none", [null], [[]], [1], [finding, finding],
            ...["id", "finding", "reason"].flatMap((key) => [
                [{ ...finding, [key]: "" }], [{ ...finding, [key]: 1 }],
            ]),
            [{ ...finding, status: "unknown" }],
            ...[undefined, [], [""], [1], "file.mjs:2"].map((evidence) => [{ ...finding, evidence }]),
        ]) {
            const h = harness({ question: "Q", iterations: 2, models }, (call) =>
                call.label === `Plan 2:${iteration}`
                    ? JSON.stringify({ status: "ready", plan: "A plan", reason: "", findings })
                    : resultFor(call));
            await assert.rejects(h.run, new RegExp(`Plan 2:${iteration} returned invalid ledger findings`));
            assert.ok(!h.calls.some(({ label }) => label === `Review 2:${iteration}`));
            assert.ok(!h.calls.some(({ stage }) => stage === "Judge" || stage === "Synthesize"));
        }
    }
});

test("invalid judgments block Synthesize", async () => {
    const decision = judgmentFor();
    const [alternative] = decision.takeFromOthers;
    for (const response of [
        undefined, "", "not JSON", '```json\n{}\n```',
        ...[
            null, [], {}, ...[0, 4, "1", null].map((winner) => ({ ...decision, winner })),
            { ...decision, reason: " " },
            ...[undefined, null, [], [alternative], [alternative, alternative]].map((takeFromOthers) => ({
                ...decision, takeFromOthers,
            })),
            ...[null, [], { ...alternative, branch: 1 }, { ...alternative, branch: 4 },
                { ...alternative, reason: "" }, { ...alternative, additions: null },
                { ...alternative, additions: [null] },
                ...["change", "sourceSection", "rationale"].map((key) => ({
                    ...alternative, additions: [{ ...alternative.additions[0], [key]: "" }],
                })),
            ].map((entry) => ({ ...decision, takeFromOthers: [entry, decision.takeFromOthers[1]] })),
        ].map((value) => JSON.stringify(value)),
    ]) {
        const h = harness({ question: "Q", iterations: 1, models }, (call) =>
            call.stage === "Judge" ? response : resultFor(call));
        await assert.rejects(h.run, /Judge.*(valid judgment|invalid JSON)/);
        assert.ok(!h.calls.some(({ stage }) => stage === "Synthesize"));
    }
});

test("invalid synthesis results are not reported as a final plan", async () => {
    for (const response of [
        "", " \n ", undefined, {}, [], "A generic fallback plan",
        '```json\n{"status":"ready","plan":"A plan","reason":""}\n```',
        ...[
            null, [], {}, { status: "ready", plan: "A plan" },
            { status: "ready", plan: "A plan", reason: null },
            { status: "invalid", plan: "A plan", reason: "" },
            ...["", " \r\n ", null, 1].map((plan) => ({ status: "ready", plan, reason: "" })),
            { status: "ready", plan: "A fallback plan", reason: "plan-change is unavailable" },
            { status: "blocked", plan: "", reason: "" },
        ].map((value) => JSON.stringify(value)),
    ]) {
        const h = harness({ question: "Q", iterations: 1, models }, (call) =>
            call.stage === "Synthesize" ? response : resultFor(call));
        await assert.rejects(h.run, /Synthesize.*(invalid|valid|blocked|unavailable)/);
    }
});

test("a missing plan-change skill during synthesis preserves the blocker instead of returning a plan", async () => {
    const h = harness({ question: "Q", iterations: 1, models }, (call) =>
        call.stage === "Synthesize"
            ? JSON.stringify({ status: "blocked", plan: "", reason: "plan-change cannot be loaded" })
            : resultFor(call));
    await assert.rejects(h.run, /Synthesize blocked: plan-change cannot be loaded/);
});
