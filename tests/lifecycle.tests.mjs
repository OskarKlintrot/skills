import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { test } from "node:test";
import { lifecycle } from "../com.github.copilot/extensions/addy-lifecycle/workflow.mjs";

const check = { command: "npm test", outcome: "passed", evidence: "All tests passed" };
const commit = "a".repeat(40);
const task = (id, dependsOn = []) => ({ id, title: id, acceptance: "Works", dependsOn });
const report = (extra = {}) => ({
    status: "ready", summary: "Ready", evidence: ["SPEC.md"], checks: [check], questions: [], ...extra,
});
const responses = () => ({
    Define: report(),
    "Commit:spec": report({ commit }),
    Plan: report({ tasks: [task("second", ["first"]), task("first")], completed: [] }),
    "Commit:plan": report({ commit }),
    "Build:first": report({ commit }),
    "Build:second": report({ commit }),
    Verify: report(),
    "Review:code": report({ verdict: "GO", findings: [] }),
    "Review:security": report({ verdict: "GO", findings: [] }),
    "Review:tests": report({ verdict: "GO", findings: [] }),
    Ship: report({ verdict: "GO", rollback: "Revert the release and verify health" }),
});

function harness(overrides = {}, args = {
    goal: "Build a feature", specPath: join("tests", "fixtures", "lifecycle-spec.md"),
    baselinePath: "session-baseline.json",
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
    assert.deepEqual(h.calls.map((c) => c.label), ["Define", "Commit:spec", "Plan"]);
    const result = await lifecycle.run(h.ctx);
    assert.equal(result.verdict, "GO");
    assert.deepEqual(h.calls.map((c) => c.label), [
        "Define", "Commit:spec", "Plan", "Commit:plan", "Build:first", "Build:second", "Verify",
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

test("review steps select packaged Addy personas without changing other agents or models", async () => {
    const h = harness();
    await approvePlan(h);
    await lifecycle.run(h.ctx);
    const personas = {
        "Review:code": "oskar-tools:code-reviewer",
        "Review:security": "oskar-tools:security-auditor",
        "Review:tests": "oskar-tools:test-engineer",
    };
    for (const call of h.calls) {
        assert.equal(call.agent, personas[call.label], call.label);
        assert.equal(call.model, undefined);
        if (personas[call.label]) {
            assert.match(call.prompt, /structured report.*persona.*template/i);
        }
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
        const h = harness({}, { goal: "Build a feature", specPath, baselinePath: "session-baseline.json" });
        const result = await lifecycle.run(h.ctx);
        assert.equal(result.verdict, "NO-GO");
        assert.equal(h.calls.length, 0);
        assert.match(result.reason, /spec/i);
    }
});

test("empty or changed spec cannot bypass preparation or reuse stale approval", async () => {
    const directory = await mkdtemp(resolve("tests", "fixtures", "lifecycle-"));
    const path = join(directory, "SPEC.md");
    const args = {
        goal: "Build a feature", specPath: relative(process.cwd(), path), baselinePath: "session-baseline.json",
    };
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
        if (phase === "Plan" || phase === "Commit:spec") {
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
        const h = harness({ Plan: report({ tasks, completed: [] }) });
        await approveSpec(h);
        const result = await lifecycle.run(h.ctx);
        assert.equal(result.verdict, "NO-GO");
        assert.equal(result.phase, "Plan");
        assert.equal(h.calls.length, 3);
    }
});

test("a fresh recovery run uses completed prerequisites without rebuilding them", async () => {
    const completed = [{ task: task("first"), report: report({ commit }) }];
    const h = harness({ Plan: report({ tasks: [task("second", ["first"])], completed }) });
    await approvePlan(h);
    assert.equal((await lifecycle.run(h.ctx)).verdict, "GO");
    const planning = h.calls.find((c) => c.label === "Plan");
    assert.ok(planning.schema.required.includes("completed"));
    assert.match(planning.prompt, /verify its commit exists/);
    assert.equal(h.calls.some((c) => c.label === "Build:first"), false);
    for (const label of ["Build:second", "Verify", "Review:code", "Ship"]) {
        const context = JSON.parse(h.calls.find((c) => c.label === label).prompt.split("Context (JSON):\n")[1]);
        assert.deepEqual(context.completed[0], completed[0]);
    }
});

test("recovery after post-build NO-GO can reassess without new Build calls", async () => {
    const initial = harness({ Verify: report({ status: "blocked" }) });
    await approvePlan(initial);
    const stopped = await lifecycle.run(initial.ctx);
    assert.equal(stopped.phase, "Verify");
    const completed = [
        { task: task("first"), report: stopped.reports["Build:first"] },
        { task: task("second", ["first"]), report: stopped.reports["Build:second"] },
    ];
    const h = harness({ Plan: report({ tasks: [], completed }) });
    await approvePlan(h);
    assert.equal((await lifecycle.run(h.ctx)).verdict, "GO");
    assert.equal(h.calls.some((c) => c.label.startsWith("Build:")), false);
    assert.ok(h.calls.some((c) => c.label === "Commit:plan"));
    const context = JSON.parse(h.calls.find((c) => c.label === "Verify").prompt.split("Context (JSON):\n")[1]);
    assert.deepEqual(context.completed, completed);
});

test("invalid completed work cannot bypass the plan gate", async () => {
    const done = (id = "first", dependsOn = [], extra = {}) => ({
        task: task(id, dependsOn), report: report({ commit, ...extra }),
    });
    for (const plan of [
        { tasks: [], completed: [] },
        { tasks: [], completed: [done("first", [], { commit: "" })] },
        { tasks: [], completed: [done("first", [], { checks: [] })] },
        { tasks: [], completed: [done("first", [], { checks: [{ ...check, outcome: "failed" }] })] },
        { tasks: [], completed: [done("first", [], { status: "blocked" })] },
        { tasks: [], completed: [done("first", [], { questions: ["Which scope?"] })] },
        { tasks: [], completed: [done("first", ["missing"])] },
        { tasks: [], completed: [done(), done()] },
        { tasks: [], completed: [done("first", ["second"]), done("second", ["first"])] },
        { tasks: [task("first")], completed: [done()] },
        { tasks: [task("second")], completed: [done("first", ["second"])] },
        { tasks: [], completed: [null] },
        { tasks: [], completed: [{ task: null, report: report({ commit }) }] },
        { tasks: [], completed: null },
        { tasks: [task("first")] },
    ]) {
        const h = harness({ Plan: report(plan) });
        await approveSpec(h);
        const result = await lifecycle.run(h.ctx);
        assert.equal(result.phase, "Plan");
        assert.equal(result.verdict, "NO-GO");
        assert.equal(h.calls.at(-1).label, "Plan");
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
        assert.match(call.prompt, /Do not push, merge, or deploy/);
        assert.match(call.prompt, /pre-existing/);
    }
    assert.match(h.calls.find((c) => c.label === "Build:first").prompt, /RED.*GREEN/);
    assert.match(h.calls.find((c) => c.label === "Review:code").prompt, /Read-only/);
    for (const call of h.calls.filter((c) => c.label.startsWith("Review:"))) {
        assert.match(call.prompt, /completed-task commits, not only the working-tree diff/);
        assert.match(call.prompt, /"specCommit":/);
        assert.match(call.prompt, /"planCommit":/);
    }
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
    assert.equal(h.calls.at(-1).label, "Commit:plan");
});

test("spec and plan commits happen only after their own approvals", async () => {
    const h = harness();
    await approveSpec(h);
    assert.equal(h.calls.some((c) => c.label.startsWith("Commit:")), false);
    await assert.rejects(() => lifecycle.run(h.ctx), /PAUSED:approve-plan/);
    assert.equal(h.calls.some((c) => c.label === "Commit:spec"), true);
    assert.equal(h.calls.some((c) => c.label === "Commit:plan"), false);
    await lifecycle.run(h.ctx);
    for (const label of ["Commit:spec", "Commit:plan", "Build:first", "Build:second"]) {
        const call = h.calls.find((c) => c.label === label);
        assert.match(call.prompt, /agent-skills:git-workflow-and-versioning/);
        assert.match(call.prompt, /git diff --cached/);
        assert.match(call.prompt, /baseline/);
        assert.match(call.prompt, /Do not use git add -A/);
        assert.ok(call.schema.required.includes("commit"));
        assert.match(call.prompt, /session-baseline.json/);
    }
});

test("commits require an explicit pre-edit baseline handoff", async () => {
    const h = harness({}, { goal: "Feature", specPath: "SPEC.md" });
    await assert.rejects(() => lifecycle.run(h.ctx), /baselinePath/);
    assert.equal(h.calls.length, 0);
    assert.ok(lifecycle.meta.argsSchema.required.includes("baselinePath"));
});

test("a missing or unsuccessful commit prevents the next phase or task", async () => {
    for (const phase of ["Commit:spec", "Commit:plan", "Build:first"]) {
        for (const value of [
            null, report(), report({ commit: "" }), report({ commit: "not-a-sha" }),
            report({ status: "blocked", commit }),
            report({ commit, checks: [{ ...check, outcome: "failed" }] }),
        ]) {
            const h = harness({ [phase]: value });
            if (phase === "Commit:spec") await approveSpec(h);
            else await approvePlan(h);
            const result = await lifecycle.run(h.ctx);
            assert.equal(result.verdict, "NO-GO");
            assert.equal(result.phase, phase);
            assert.equal(h.calls.at(-1).label, phase);
        }
    }
});

test("read-only phases cannot commit or modify implementation", async () => {
    const h = harness();
    await approvePlan(h);
    await lifecycle.run(h.ctx);
    for (const label of ["Define", "Plan", "Verify", "Review:code", "Review:security", "Review:tests", "Ship"]) {
        assert.match(h.calls.find((c) => c.label === label).prompt, /Only Commit:spec, Commit:plan and Build may create commits/);
    }
    assert.match(h.calls.find((c) => c.label === "Build:first").prompt,
        /verification.*record.*completion.*commit/i);
});
