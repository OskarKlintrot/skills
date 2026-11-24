import assert from "node:assert/strict";
import { test } from "node:test";
import { battlePlan } from "../com.github.copilot/extensions/battle-plan/workflow.mjs";

const models = { plan: ["p1", "p2", "p3"], judge: "j-model" };

function resultFor({ label, instruction }) {
    return instruction.includes("plan-change")
        ? JSON.stringify({ status: "ready", plan: `${label} result`, reason: "" })
        : `${label} result`;
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
            question: "A question", plan: null, review: null,
        });
        assert.deepEqual(find(`Review ${branch}:1`).context, {
            question: "A question", plan: `Plan ${branch}:1 result`,
        });
        assert.deepEqual(find(`Plan ${branch}:2`).context, {
            question: "A question", plan: `Plan ${branch}:1 result`, review: `Review ${branch}:1 result`,
        });
        assert.deepEqual(find(`Review ${branch}:2`).context, {
            question: "A question", plan: `Plan ${branch}:2 result`,
        });
    }
    const results = [1, 2, 3].map((branch) => ({
        plan: `Plan ${branch}:2 result`, review: `Review ${branch}:2 result`,
    }));
    assert.deepEqual(h.calls.at(-2), {
        stage: "Judge", instruction: "Judge", label: "Judge", model: "j-model",
        context: { question: "A question", results },
    });
    assert.deepEqual(h.calls.at(-1), {
        stage: "Synthesize", instruction: "Synthesize", label: "Synthesize", model: "p1",
        context: { question: "A question", results, judgment: "Judge result" },
    });
});

test("first plans use plan-change and pass complete Markdown to review", async () => {
    const planFor = (label) => `## Summary\n\n- ${label}\n\n## Evidence\n\n` +
        "`C:\\repo\\file`\n\n## Test Cases\n\n1. Check the plan.\n\n" +
        "## Out-of-Scope\n\n- Other changes.\n\n## Merge Danger\n\nTwo-way.\n";
    const h = harness({ question: "A question", iterations: 2, models }, (call) => {
        if (call.label.startsWith("Plan ") && call.label.endsWith(":1")) {
            return JSON.stringify({ status: "ready", plan: planFor(call.label), reason: "" });
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
        assert.match(first.instruction, /status, plan, and reason/);
        assert.equal(first.schema, undefined);
        assert.equal(find(`Review ${branch}:1`).context.plan, planFor(first.label));
        const later = find(`Plan ${branch}:2`);
        assert.equal(later.instruction, "Plan");
        assert.equal(later.schema, undefined);
        assert.deepEqual(later.context, {
            question: "A question",
            plan: planFor(first.label),
            review: `Review ${branch}:1 result`,
        });
    }
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
        { question: 1, iterations: 1, models }, { question: "Q", models },
        ...[0, -1, 1.5, "2", Number.MAX_SAFE_INTEGER + 1].map((iterations) => ({
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
        await assert.rejects(h.run, failed.startsWith("Plan") ? /Plan 2:1 failed/ : /loop failed/);
        assert.ok(!h.calls.some(({ stage }) => stage === "Judge"));
        assert.ok(!h.calls.some(({ stage }) => stage === "Synthesize"));
        if (failed.startsWith("Plan")) {
            assert.ok(!h.calls.some(({ label }) => label === "Review 2:1"));
        }
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
