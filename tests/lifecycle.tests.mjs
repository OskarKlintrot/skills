import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { test } from "node:test";
import { lifecycle } from "../com.github.copilot/extensions/addy-lifecycle/workflow.mjs";

const check = { command: "npm test", outcome: "passed", evidence: "All tests passed" };
const task = (id, dependsOn = []) => ({ id, title: id, acceptance: "Works", dependsOn });
const report = (extra = {}) => ({
    status: "ready", summary: "Ready", evidence: ["SPEC.md"], checks: [check], questions: [], ...extra,
});
const responses = () => ({
    Define: report(),
    Plan: report({ tasks: [task("second", ["first"]), task("first")] }),
    "Build:first": report(),
    "Build:second": report(),
    Verify: report(),
    "Review:code": report({ verdict: "GO", findings: [] }),
    "Review:security": report({ verdict: "GO", findings: [] }),
    "Review:tests": report({ verdict: "GO", findings: [] }),
    Ship: report({ verdict: "GO", rollback: "Revert the release and verify health" }),
});

function harness(overrides = {}, args = {
    goal: "Build a feature", specPath: join("tests", "fixtures", "lifecycle-spec.md"),
}) {
    const answers = { ...responses(), ...overrides };
    const journal = new Map();
    const checkpoints = new Set();
    const calls = [];
    const phases = [];
    const logs = [];
    const ctx = {
        args, runId: "test-run", log: (text) => logs.push(text),
        phase: (name) => phases.push(name),
        async agent(prompt, options) {
            const key = JSON.stringify({ prompt, options });
            if (journal.has(key)) return journal.get(key);
            calls.push({ prompt, ...options });
            const value = answers[options.label];
            assert.notEqual(value, undefined, `Unexpected agent ${options.label}`);
            journal.set(key, value);
            return value;
        },
        async pause(key) {
            if (!checkpoints.has(key)) {
                checkpoints.add(key);
                throw new Error(`PAUSED:${key}`);
            }
        },
        parallel: (thunks) => Promise.all(thunks.map((thunk) => thunk())),
        async step(key, producer) {
            if (!journal.has(key)) journal.set(key, await producer());
            return journal.get(key);
        },
    };
    return { ctx, calls, phases, logs };
}

async function approveSpec(h) {
    await assert.rejects(() => lifecycle.run(h.ctx), /PAUSED:approve-spec/);
}

async function approvePlan(h) {
    await approveSpec(h);
    await assert.rejects(() => lifecycle.run(h.ctx), /PAUSED:approve-plan/);
}

test("spec and plan pause before any implementation; resume reuses phase results", async () => {
    const h = harness();
    await approveSpec(h);
    assert.deepEqual(h.calls.map((c) => c.label), ["Define"]);
    await assert.rejects(() => lifecycle.run(h.ctx), /PAUSED:approve-plan/);
    assert.deepEqual(h.calls.map((c) => c.label), ["Define", "Plan"]);
    const result = await lifecycle.run(h.ctx);
    assert.equal(result.verdict, "GO");
    assert.deepEqual(h.calls.map((c) => c.label), [
        "Define", "Plan", "Build:first", "Build:second", "Verify",
        "Review:code", "Review:security", "Review:tests", "Ship",
    ]);
    assert.ok(h.calls.every((c) => !c.model && !c.reasoningEffort && !c.contextTier));
});

test("invalid arguments fail before spawning agents", async () => {
    for (const args of [{}, { goal: " " }, { goal: 4 }, null]) {
        const h = harness({}, args);
        await assert.rejects(() => lifecycle.run(h.ctx), /goal/);
        assert.equal(h.calls.length, 0);
    }
});

test("a goal alone cannot start unattended requirements discovery", async () => {
    const h = harness({}, { goal: "Build a feature" });
    await assert.rejects(() => lifecycle.run(h.ctx), /specPath/);
    assert.equal(h.calls.length, 0);
    assert.ok(lifecycle.meta.argsSchema.required.includes("specPath"));
});

test("workflow uses the same public name as its coordinator skill and command", () => {
    assert.equal(lifecycle.meta.name, "addy-lifecycle");
    assert.match(lifecycle.meta.description, /\/oskar-tools:addy-lifecycle/);
});

test("missing spec files, directories and paths outside the worktree stop before any phase agent", async () => {
    for (const specPath of [join("tests", "fixtures", "missing-spec.md"), ".", ".."]) {
        const h = harness({}, { goal: "Build a feature", specPath });
        const result = await lifecycle.run(h.ctx);
        assert.equal(result.verdict, "NO-GO");
        assert.equal(h.calls.length, 0);
        assert.match(result.reason, /spec/i);
    }
});

test("empty or changed spec cannot bypass preparation or reuse stale approval", async () => {
    const directory = await mkdtemp(resolve("tests", "fixtures", "lifecycle-"));
    const path = join(directory, "SPEC.md");
    const args = { goal: "Build a feature", specPath: relative(process.cwd(), path) };
    try {
        await writeFile(path, " ");
        const empty = harness({}, args);
        assert.equal((await lifecycle.run(empty.ctx)).verdict, "NO-GO");
        assert.equal(empty.calls.length, 0);
        await writeFile(path, await readFile(join("tests", "fixtures", "lifecycle-spec.md")));
        const h = harness({}, args);
        await approveSpec(h);
        await writeFile(path, "# Changed scope after approval");
        const result = await lifecycle.run(h.ctx);
        assert.equal(result.verdict, "NO-GO");
        assert.match(result.reason, /Spec changed/);
        assert.deepEqual(h.calls.map((c) => c.label), ["Define"]);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("every phase routes unanswered questions to the main session without advancing", async () => {
    for (const phase of Object.keys(responses())) {
        const base = responses()[phase];
        const h = harness({
            [phase]: { ...base, questions: ["Which retention period should apply?"] },
        });
        if (phase === "Plan") {
            await approveSpec(h);
        } else if (phase !== "Define") {
            await approvePlan(h);
        }
        const result = await lifecycle.run(h.ctx);
        assert.equal(result.verdict, "NO-GO", phase);
        assert.deepEqual(result.needsInput, [{
            phase, question: "Which retention period should apply?",
        }]);
        if (!phase.startsWith("Review:")) assert.equal(h.calls.at(-1).label, phase);
        else assert.equal(h.calls.some((c) => c.label === "Ship"), false);
    }
});

test("all phase prompts prohibit interactive skills and hand questions back", async () => {
    const h = harness();
    await approvePlan(h);
    await lifecycle.run(h.ctx);
    for (const call of h.calls) {
        assert.match(call.prompt, /Do not call ask_user/);
        assert.match(call.prompt, /Do not invoke.*interview-me/);
        assert.match(call.prompt, /questions/);
        assert.ok(call.schema.required.includes("questions"));
    }
    assert.match(h.calls.find((c) => c.label === "Define").prompt, /Read-only/);
    assert.doesNotMatch(h.calls.find((c) => c.label === "Define").prompt, /Clarify the goal using available user-input/);
    assert.match(h.calls.find((c) => c.label === "Plan").prompt, /Do not wait/);
    assert.match(h.calls.find((c) => c.label === "Verify").prompt, /assessment only/i);
    assert.match(h.calls.find((c) => c.label === "Verify").prompt, /Do not fix code/);
    assert.match(h.calls.find((c) => c.label === "Review:tests").prompt, /do not run builds\/tests/i);
    assert.match(h.calls.find((c) => c.label === "Ship").prompt, /assessment only/i);
    assert.match(h.calls.find((c) => c.label === "Ship").prompt, /Do not run deployment or rollback commands/);
});

test("missing spec output stops closed", async () => {
    const h = harness({ Define: null });
    const result = await lifecycle.run(h.ctx);
    assert.equal(result.verdict, "NO-GO");
    assert.equal(result.phase, "Define");
    assert.equal(h.calls.length, 1);
});

test("invalid dependency graphs never reach the plan approval gate", async () => {
    for (const tasks of [
        [], [task("a"), task("a")], [task("a", ["missing"])],
        [task("a", ["b"]), task("b", ["a"])], [task("a", ["a"])],
        [task("../bad")], [task("a", ["b", "b"]), task("b")],
    ]) {
        const h = harness({ Plan: report({ tasks }) });
        await approveSpec(h);
        const result = await lifecycle.run(h.ctx);
        assert.equal(result.verdict, "NO-GO");
        assert.equal(result.phase, "Plan");
        assert.equal(h.calls.length, 2);
    }
});

test("blocked build or absent verification stops before subsequent work", async () => {
    for (const value of [
        null, report({ status: "blocked" }), report({ checks: [] }),
        report({ checks: [{ ...check, outcome: "failed" }] }),
        report({ checks: [{ ...check, evidence: "" }] }),
    ]) {
        const h = harness({ "Build:first": value });
        await approvePlan(h);
        const result = await lifecycle.run(h.ctx);
        assert.equal(result.verdict, "NO-GO");
        assert.equal(result.phase, "Build:first");
        assert.equal(h.calls.at(-1).label, "Build:first");
    }
});

test("verification failures prevent review fan-out", async () => {
    const h = harness({ Verify: report({ checks: [{ ...check, outcome: "not-run" }] }) });
    await approvePlan(h);
    assert.equal((await lifecycle.run(h.ctx)).verdict, "NO-GO");
    assert.equal(h.calls.at(-1).label, "Verify");
});

test("missing, blocked, or blocking specialist reports prevent ship", async () => {
    for (const value of [
        null, report({ status: "blocked", verdict: "GO", findings: [] }),
        report({ verdict: "NO-GO", findings: [] }),
        report({ verdict: "GO", findings: [{ severity: "Required", detail: "Fix this", location: "a:1" }] }),
        report({ verdict: "GO", findings: [{ severity: "High", detail: "Fix this", location: "a:1" }] }),
        report({ verdict: "GO", findings: [], checks: [{ ...check, outcome: "failed" }] }),
    ]) {
        const h = harness({ "Review:security": value });
        await approvePlan(h);
        const result = await lifecycle.run(h.ctx);
        assert.equal(result.verdict, "NO-GO");
        assert.equal(result.phase, "Review");
        assert.equal(h.calls.some((c) => c.label === "Ship"), false);
    }
});

test("ship requires evidence and rollback, not just a GO string", async () => {
    for (const value of [
        null, report({ verdict: "NO-GO", rollback: "Revert" }),
        report({ verdict: "GO", rollback: "" }),
        report({ verdict: "GO", rollback: "Revert", evidence: [] }),
        report({ verdict: "GO", rollback: "Revert", checks: [{ ...check, outcome: "not-run" }] }),
    ]) {
        const h = harness({ Ship: value });
        await approvePlan(h);
        assert.equal((await lifecycle.run(h.ctx)).verdict, "NO-GO");
    }
});

test("prompts enforce skills, shared-worktree safety and no release actions", async () => {
    const h = harness();
    await approvePlan(h);
    await lifecycle.run(h.ctx);
    for (const call of h.calls) {
        assert.match(call.prompt, /missing.*skill|skill.*unavailable/i);
        assert.match(call.prompt, /Do not delegate/);
        assert.match(call.prompt, /Do not commit, push, merge, or deploy/);
        assert.match(call.prompt, /pre-existing/);
    }
    assert.match(h.calls.find((c) => c.label === "Build:first").prompt, /RED.*GREEN/);
    assert.match(h.calls.find((c) => c.label === "Review:code").prompt, /Read-only/);
    assert.match(h.calls.find((c) => c.label === "Ship").prompt, /rollback/i);
});

test("review fan-out starts all specialists before the shared barrier", async () => {
    const h = harness();
    const agent = h.ctx.agent;
    const started = [];
    let release;
    const barrier = new Promise((resolve) => { release = resolve; });
    h.ctx.agent = async (prompt, options) => {
        if (options.label.startsWith("Review:")) {
            started.push(options.label);
            if (started.length === 3) release();
            await barrier;
        }
        return agent(prompt, options);
    };
    await approvePlan(h);
    assert.equal((await lifecycle.run(h.ctx)).verdict, "GO");
    assert.equal(started.length, 3);
});

test("hard runtime failures propagate instead of becoming successful reports", async () => {
    const h = harness();
    await approvePlan(h);
    const agent = h.ctx.agent;
    h.ctx.agent = async (prompt, options) => {
        if (options.label === "Build:first") throw new Error("workflow_limit_reached");
        return agent(prompt, options);
    };
    await assert.rejects(() => lifecycle.run(h.ctx), /workflow_limit_reached/);
    assert.equal(h.calls.at(-1).label, "Plan");
});
