import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
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
    Define: report({ specPath: join("tests", "fixtures", "lifecycle-spec.md") }),
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

function harness(overrides = {}, args = { goal: "Build a feature" }) {
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

async function inRepository(action, initialCommit = true) {
    const previous = process.cwd();
    const directory = await mkdtemp(resolve("tests", "fixtures", "lifecycle-repo-"));
    const git = (...args) => execFileSync("git", args, { cwd: directory, stdio: "pipe" });
    try {
        git("init");
        if (initialCommit) {
            await writeFile(join(directory, "seed.txt"), "Initial content");
            git("add", "seed.txt");
            git("-c", "user.name=Test", "-c", "user.email=test@example.com",
                "commit", "-m", "docs: Add initial content");
        }
        process.chdir(directory);
        await action(directory, git);
    } finally {
        process.chdir(previous);
        await rm(directory, { recursive: true, force: true });
    }
}

function generatedSpecHarness(specPath = "SPEC.md", args) {
    const h = harness({ Define: report({ specPath }) }, args);
    const agent = h.ctx.agent;
    let written = false;
    h.ctx.agent = async (prompt, options) => {
        const result = await agent(prompt, options);
        if (options.label === "Define" && !written) {
            written = true;
            await writeFile(specPath, "# Generated specification");
        }
        return result;
    };
    return h;
}

test("a repository without an initial commit can reach spec approval", async () => {
    await inRepository(async () => {
        const h = generatedSpecHarness();
        await approveSpec(h);
        const context = JSON.parse(h.calls[0].prompt.split("Context (JSON):\n")[1]);
        assert.equal(context.baseline.head, null);
    }, false);
});

test("Define detects overwrites of untracked work, tracked edits and staged content", async () => {
    for (const state of ["untracked", "tracked", "staged"]) {
        await inRepository(async (_, git) => {
            const path = state === "tracked" ? "seed.txt" : "notes.txt";
            await writeFile(path, "User work");
            if (state === "staged") git("add", path);
            const h = generatedSpecHarness();
            const agent = h.ctx.agent;
            h.ctx.agent = async (prompt, options) => {
                const result = await agent(prompt, options);
                if (options.label === "Define") {
                    if (state === "staged") {
                        await writeFile(path, "Overwritten index");
                        git("add", path);
                        await writeFile(path, "User work");
                    } else await writeFile(path, "Overwritten user work");
                }
                return result;
            };
            const result = await lifecycle.run(h.ctx);
            assert.equal(result.verdict, "NO-GO");
            assert.match(result.reason, /pre-existing work/);
        });
    }
});

test("subdirectory launches compare all paths relative to the repository root", async () => {
    await inRepository(async (directory) => {
        await mkdir(join("packages", "widget"), { recursive: true });
        await writeFile(join("packages", "widget", "notes.txt"), "User notes");
        process.chdir(join(directory, "packages", "widget"));
        const h = harness({ Define: report({ specPath: "packages/widget/SPEC.md" }) });
        const agent = h.ctx.agent;
        h.ctx.agent = async (prompt, options) => {
            const result = await agent(prompt, options);
            if (options.label === "Define") await writeFile("SPEC.md", "# Generated specification");
            return result;
        };
        await approveSpec(h);
    });
});

test("an initially dirty spec cannot be adopted when launched from a subdirectory", async () => {
    await inRepository(async (directory) => {
        await mkdir(join("packages", "widget"), { recursive: true });
        await writeFile(join("packages", "widget", "SPEC.md"), "# User specification");
        process.chdir(join(directory, "packages", "widget"));
        const h = harness({ Define: report({ specPath: "packages/widget/SPEC.md" }) });
        const result = await lifecycle.run(h.ctx);
        assert.equal(result.verdict, "NO-GO");
        assert.match(result.reason, /pre-existing work/);
    });
});

test("plan revisions in the paused run retain the original baseline and require fresh approval", async () => {
    await inRepository(async () => {
        const h = generatedSpecHarness();
        const agent = h.ctx.agent;
        h.ctx.agent = async (prompt, options) => {
            const result = await agent(prompt, options);
            if (options.label === "Plan") {
                const context = JSON.parse(prompt.split("Context (JSON):\n")[1]);
                assert.equal(context.baseline.untrackedPaths.includes("plan.md"), false);
                await writeFile("plan.md", context.revisions?.plan ? "# Revised plan" : "# Initial plan");
            }
            return result;
        };
        await approvePlan(h);
        const context = JSON.parse(h.calls[0].prompt.split("Context (JSON):\n")[1]);
        const revisionPath = context.revisionRequestPath;
        await mkdir("tasks");
        await writeFile(revisionPath, JSON.stringify({ plan: "Revise the task breakdown" }));
        await assert.rejects(() => lifecycle.run(h.ctx), /PAUSED:approve-plan:/);
        assert.equal(await readFile("plan.md", "utf8"), "# Revised plan");
        assert.equal(h.calls.some((call) => call.label === "Commit:plan"), false);
        await writeFile(revisionPath, JSON.stringify({ plan: "Revise it again with smaller slices" }));
        await assert.rejects(() => lifecycle.run(h.ctx), /PAUSED:approve-plan:/);
        assert.equal(h.calls.filter((call) => call.label === "Plan").length, 3);
        assert.equal((await lifecycle.run(h.ctx)).verdict, "GO");
    });
});

test("spec revisions in the paused run are redefined and require fresh approval", async () => {
    await inRepository(async () => {
        const h = generatedSpecHarness("SPEC.md", {
            goal: "Build a feature", revisionPath: "revision.json",
        });
        const agent = h.ctx.agent;
        h.ctx.agent = async (prompt, options) => {
            const result = await agent(prompt, options);
            const context = JSON.parse(prompt.split("Context (JSON):\n")[1]);
            if (options.label === "Define" && context.revisions?.define) {
                await writeFile("SPEC.md", "# Revised specification");
            }
            return result;
        };
        await approveSpec(h);
        await writeFile("revision.json", JSON.stringify({ define: "Change the success criteria" }));
        await assert.rejects(() => lifecycle.run(h.ctx), /PAUSED:approve-spec:/);
        assert.equal(h.calls.some((call) => call.label === "Commit:spec"), false);
        assert.match(h.logs.at(-1), /# Revised specification/);
        await assert.rejects(() => lifecycle.run(h.ctx), /PAUSED:approve-plan:/);
        assert.equal((await lifecycle.run(h.ctx)).verdict, "GO");
    });
});

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

test("lifecycle uses the required skills and specialist personas without fixing runtime models", async () => {
    const h = harness();
    await approvePlan(h);
    await lifecycle.run(h.ctx);
    const skills = {
        Define: ["agent-skills:spec-driven-development", "agent-skills:git-workflow-and-versioning"],
        Plan: ["agent-skills:planning-and-task-breakdown", "agent-skills:git-workflow-and-versioning"],
        "Build:first": ["agent-skills:incremental-implementation", "agent-skills:test-driven-development",
            "agent-skills:git-workflow-and-versioning"],
        Verify: ["agent-skills:test-driven-development", "agent-skills:git-workflow-and-versioning"],
        "Review:code": ["agent-skills:code-review-and-quality"],
        "Review:security": ["agent-skills:security-and-hardening"],
        "Review:tests": ["agent-skills:test-driven-development"],
        Ship: ["agent-skills:shipping-and-launch", "agent-skills:git-workflow-and-versioning"],
    };
    const personas = {
        "Review:code": "oskar-tools:code-reviewer",
        "Review:security": "oskar-tools:security-auditor",
        "Review:tests": "oskar-tools:test-engineer",
    };
    for (const call of h.calls) {
        for (const skill of skills[call.label] ?? []) assert.ok(call.prompt.includes(skill), call.label);
        assert.equal(call.agent, personas[call.label], call.label);
        assert.equal(call.model, undefined, call.label);
    }
});

test("a goal alone starts lifecycle definition without external spec or baseline inputs", async () => {
    const h = harness({}, { goal: "Build a feature" });
    await approveSpec(h);
    assert.deepEqual(h.calls.map((c) => c.label), ["Define"]);
    assert.match(h.calls[0].prompt, /write a complete specification/);
    assert.match(h.logs[0], /# Lifecycle test specification/);
    assert.deepEqual(lifecycle.meta.argsSchema.required, ["goal"]);
});

test("workflow uses the same public name as its trigger skill and command", () => {
    assert.equal(lifecycle.meta.name, "addy-lifecycle");
    assert.match(lifecycle.meta.description, /Standalone Define -> Plan -> Build -> Verify -> Review -> Ship/);
    assert.match(lifecycle.meta.description, /applicable Addy skills and packaged Review personas/);
});

test("missing spec outputs, directories and paths outside the worktree stop after Define", async () => {
    for (const specPath of [join("tests", "fixtures", "missing-spec.md"), ".", ".."]) {
        const h = harness({ Define: report({ specPath }) });
        const result = await lifecycle.run(h.ctx);
        assert.equal(result.verdict, "NO-GO");
        assert.deepEqual(h.calls.map((c) => c.label), ["Define"]);
        assert.match(result.reason, /spec/i);
    }
});

test("Define cannot take ownership of a spec that was already dirty at workflow start", async () => {
    const directory = await mkdtemp(resolve("tests", "fixtures", "lifecycle-"));
    const path = join(directory, "SPEC.md");
    try {
        await writeFile(path, "# User-owned specification");
        const h = harness({
            Define: report({ specPath: relative(process.cwd(), path) }),
        });
        const result = await lifecycle.run(h.ctx);
        assert.equal(result.verdict, "NO-GO");
        assert.match(result.needsInput[0].question, /already had uncommitted changes/);
        assert.deepEqual(h.calls.map((c) => c.label), ["Define"]);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("Define stops when its agent writes files beyond the spec", async () => {
    const directory = await mkdtemp(resolve("tests", "fixtures", "lifecycle-"));
    const path = join(directory, "SPEC.md");
    const unrelated = join(directory, "notes.txt");
    const h = harness({
        Define: report({ specPath: relative(process.cwd(), path) }),
    });
    const agent = h.ctx.agent;
    h.ctx.agent = async (prompt, options) => {
        const result = await agent(prompt, options);
        if (options.label === "Define") {
            await writeFile(path, "# Generated specification");
            await writeFile(unrelated, "Unexpected file");
        }
        return result;
    };
    try {
        const result = await lifecycle.run(h.ctx);
        assert.equal(result.verdict, "NO-GO");
        assert.match(result.needsInput[0].question, /outside the spec/);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("empty or changed spec cannot bypass definition or reuse stale approval", async () => {
    const directory = await mkdtemp(resolve("tests", "fixtures", "lifecycle-"));
    const path = join(directory, "SPEC.md");
    const args = { goal: "Build a feature" };
    const specPath = relative(process.cwd(), path);
    const writeSpecAfterDefine = (h, content) => {
        const agent = h.ctx.agent;
        let written = false;
        h.ctx.agent = async (prompt, options) => {
            const result = await agent(prompt, options);
            if (options.label === "Define" && !written) {
                written = true;
                await writeFile(path, content);
            }
            return result;
        };
    };
    try {
        const empty = harness({ Define: report({ specPath }) }, args);
        writeSpecAfterDefine(empty, " ");
        assert.equal((await lifecycle.run(empty.ctx)).verdict, "NO-GO");
        assert.equal(empty.calls.length, 1);
        await rm(path, { force: true });
        const h = harness({ Define: report({ specPath }) }, args);
        writeSpecAfterDefine(h, await readFile(join("tests", "fixtures", "lifecycle-spec.md")));
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

test("phase prompts route unresolved questions to the user and retain lifecycle guardrails", async () => {
    const h = harness();
    await approvePlan(h);
    await lifecycle.run(h.ctx);
    for (const call of h.calls) {
        assert.match(call.prompt, /Do not call ask_user/);
        assert.match(call.prompt, /questions/);
        assert.ok(call.schema.required.includes("questions"));
    }
    assert.match(h.calls[0].prompt, /Use phase-specific installed skills and/);
    for (const label of ["Commit:spec", "Commit:plan", "Build:first", "Build:second"]) {
        const prompt = h.calls.find((call) => call.label === label).prompt;
        assert.match(prompt, /agent-skills:git-workflow-and-versioning/);
        assert.match(prompt, /do not prohibit creating an appropriate feature branch or commits/i);
    }
    assert.match(h.calls.find((c) => c.label === "Define").prompt, /write a complete specification/);
    assert.match(h.calls.find((c) => c.label === "Define").prompt, /capability map/);
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

test("prompts use Git workflow guidance and enforce shared-worktree safety", async () => {
    const h = harness();
    await approvePlan(h);
    await lifecycle.run(h.ctx);
    for (const call of h.calls) {
        assert.match(call.prompt, /Do not delegate/);
        assert.match(call.prompt, /agent-skills:git-workflow-and-versioning/);
        assert.match(call.prompt, /pre-existing/);
        assert.doesNotMatch(call.prompt, /do not require or invoke external skills/i);
        const context = JSON.parse(call.prompt.split("Context (JSON):\n")[1]);
        assert.equal(typeof context.baseline.head, "string");
        assert.ok(Array.isArray(context.baseline.untrackedPaths));
    }
    assert.match(h.calls.find((c) => c.label === "Build:first").prompt, /test-first loop/);
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
        assert.match(call.prompt, /git diff --cached/);
        assert.match(call.prompt, /baseline/);
        assert.match(call.prompt, /Do not use git add -A/);
        assert.match(call.prompt, /commit each verified implementation increment atomically/);
        assert.doesNotMatch(call.prompt, /Do not create branches/);
        assert.ok(call.schema.required.includes("commit"));
    }
});

test("resuming plan approval does not attribute Plan artifacts to Define", async () => {
    const h = harness();
    await approveSpec(h);
    const directory = await mkdtemp(resolve("tests", "fixtures", "lifecycle-"));
    const planArtifact = join(directory, "plan.md");
    const agent = h.ctx.agent;
    h.ctx.agent = async (prompt, options) => {
        const result = await agent(prompt, options);
        if (options.label === "Plan") await writeFile(planArtifact, "# Generated plan");
        return result;
    };

    try {
        await assert.rejects(() => lifecycle.run(h.ctx), /PAUSED:approve-plan/);
        const result = await lifecycle.run(h.ctx);
        assert.equal(result.verdict, "GO");
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("workflow captures the pre-edit Git baseline without caller-supplied paths", async () => {
    const h = harness({}, { goal: "Feature" });
    await approveSpec(h);
    const context = JSON.parse(h.calls[0].prompt.split("Context (JSON):\n")[1]);
    assert.match(context.baseline.head, /^[a-f0-9]{40,64}$/);
    assert.equal(typeof context.baseline.status, "string");
    assert.ok(Array.isArray(context.baseline.stagedPaths));
    assert.ok(Array.isArray(context.baseline.unstagedPaths));
    assert.ok(Array.isArray(context.baseline.untrackedPaths));
    assert.deepEqual(lifecycle.meta.argsSchema.required, ["goal"]);
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

test("only assigned phases may write artifacts or implementation", async () => {
    const h = harness();
    await approvePlan(h);
    await lifecycle.run(h.ctx);
    for (const label of ["Verify", "Review:code", "Review:security", "Review:tests", "Ship"]) {
        assert.match(h.calls.find((c) => c.label === label).prompt, /Verify, Review and Ship are read-only/);
    }
    assert.match(h.calls.find((c) => c.label === "Define").prompt, /Only Define may create a spec/);
    assert.match(h.calls.find((c) => c.label === "Plan").prompt, /Only Define may create a spec/);
    assert.match(h.calls.find((c) => c.label === "Build:first").prompt,
        /verification.*record.*completion.*commit/i);
});
