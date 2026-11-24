import assert from "node:assert/strict";
import { test } from "node:test";
import { battlePlan } from "../com.github.copilot/extensions/battle-plan/workflow.mjs";

const models = { plan: ["p1", "p2", "p3"], judge: "j-model" };

function harness(args, handler = ({ label }) => `${label} result`) {
    const calls = [];
    const phases = [];
    const ctx = {
        args,
        phase(title) { phases.push(title); },
        async agent(prompt, options) {
            const [stage, json] = prompt.split("\n\n");
            const call = { stage, context: JSON.parse(json), ...options };
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
        stage: "Judge", label: "Judge", model: "j-model",
        context: { question: "A question", results },
    });
    assert.deepEqual(h.calls.at(-1), {
        stage: "Synthesize", label: "Synthesize", model: "p1",
        context: { question: "A question", results, judgment: "Judge result" },
    });
});

test("branches run concurrently and advance without waiting for another branch's review", async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let started;
    const h = harness({ question: "A question", iterations: 2, models }, async ({ label }) => {
        if (label === "Plan 3:1") started = h.calls.map((call) => call.label);
        if (label === "Plan 1:1") await gate;
        if (label === "Review 3:2") release();
        return `${label} result`;
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
        const h = harness({ question: "Q", iterations: 1, models }, ({ label }) =>
            label === failed ? null : `${label} result`);
        await assert.rejects(h.run, /loop failed/);
        assert.ok(!h.calls.some(({ stage }) => stage === "Judge"));
        assert.ok(!h.calls.some(({ stage }) => stage === "Synthesize"));
        if (failed.startsWith("Plan")) {
            assert.ok(!h.calls.some(({ label }) => label === "Review 2:1"));
        }
    }
});

test("a failed judgment blocks synthesis", async () => {
    const h = harness({ question: "Q", iterations: 1, models }, ({ label }) =>
        label === "Judge" ? null : `${label} result`);
    await assert.rejects(h.run, /Judge failed/);
    assert.ok(!h.calls.some(({ stage }) => stage === "Synthesize"));
});

test("a failed synthesis is not reported as success", async () => {
    const h = harness({ question: "Q", iterations: 1, models }, ({ label }) =>
        label === "Synthesize" ? null : `${label} result`);
    await assert.rejects(h.run, /Synthesize failed/);
});
