import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { test } from "node:test";
import { exhaustiveTask } from "../com.github.copilot/extensions/exhaustive-task/workflow.mjs";

const item = (id) => ({ id, title: id, instruction: `Document ${id}`, acceptance: `${id} documented` });
const a = item("integration-a");
const b = item("integration-b");
const check = { command: "inspect documentation against source", outcome: "passed", evidence: "Matches source" };
const report = (extra = {}) => ({
    status: "ready", summary: "Inspected actual files", evidence: ["output.txt:1"],
    checks: [check], questions: [], ...extra,
});
const inventory = (items = [], extra = {}) => report({ items, ...extra });
const verification = (extra = {}) => report({ complete: true, remaining: "", ...extra });
const receipt = (extra = {}) => report({ outcome: "committed", commit: "a".repeat(40), ...extra });

async function fixture(t) {
    const root = await mkdtemp(resolve("tests", "exhaustive-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const directory = join(root, "scope");
    await mkdir(directory);
    const baselinePath = join(root, "baseline.txt");
    await writeFile(baselinePath, "Simulated pre-edit baseline: output.txt is untracked with initial content.\n");
    const path = join(directory, "output.txt");
    await writeFile(path, "initial\n");
    return {
        directory, path,
        args: {
            goal: "Document every integration", scope: [relative(process.cwd(), directory)],
            acceptance: "All scoped integrations have accurate documentation",
            baselinePath,
        },
    };
}

function harness(f, responses, commitResponse = receipt()) {
    const journal = new Map();
    const calls = [];
    const logs = [];
    const checkpoints = new Set();
    const commitCalls = [];
    const events = [];
    const ctx = {
        args: f.args, runId: "test-run",
        log: (message) => logs.push(message),
        phase() {},
        async pause(key) {
            if (!checkpoints.has(key)) {
                checkpoints.add(key);
                throw new Error(`PAUSED:${key}`);
            }
        },
        async step(key, producer) {
            if (!journal.has(key)) journal.set(key, await producer());
            return journal.get(key);
        },
        async agent(prompt, options) {
            const key = JSON.stringify({ prompt, options });
            if (journal.has(key)) return journal.get(key);
            const context = JSON.parse(prompt.split("Context (JSON):\n")[1]);
            const call = { prompt, ...options, context };
            events.push(call);
            if (options.label.startsWith("Commit:")) {
                commitCalls.push(call);
                const output = typeof commitResponse === "function" ? await commitResponse(context) : commitResponse;
                journal.set(key, output);
                return output;
            }
            const response = responses[calls.length];
            assert.ok(response, `Unexpected agent: ${options.label}`);
            assert.ok(options.label.startsWith(response[0]), `${options.label} should start with ${response[0]}`);
            calls.push(call);
            const answer = typeof response[1] === "function" ? await response[1](context) : response[1];
            const output = answer && Object.hasOwn(answer, "items") && !Object.hasOwn(answer, "coverage")
                ? { ...answer, coverage: context.manifest } : answer;
            journal.set(key, output);
            return output;
        },
    };
    return { ctx, calls, logs, commitCalls, events };
}

const work = (f, content) => async () => {
    await writeFile(f.path, content);
    return report();
};

test("registered workflow declares its contract without model or resource overrides", () => {
    assert.equal(exhaustiveTask.meta.name, "exhaustive-task");
    assert.deepEqual(exhaustiveTask.meta.argsSchema.required, ["goal", "scope", "acceptance", "baselinePath"]);
    assert.equal(exhaustiveTask.meta.limits, undefined);
});

test("invalid optional round ceilings fail before agents are spawned", async (t) => {
    const f = await fixture(t);
    for (const maxRounds of [0, -1, 1.5, "2", null, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
        const h = harness({ args: { ...f.args, maxRounds } }, []);
        await assert.rejects(() => exhaustiveTask.run(h.ctx), /maxRounds/);
        assert.equal(h.calls.length, 0);
    }
});

test("baseline is required, readable, nonempty and immutable across runtime resume", async (t) => {
    const f = await fixture(t);
    for (const baselinePath of [undefined, "", join(f.directory, "missing-baseline.txt"), f.directory]) {
        const h = harness({ args: { ...f.args, baselinePath } }, []);
        await assert.rejects(() => exhaustiveTask.run(h.ctx), /baselinePath|ENOENT|EISDIR/);
        assert.equal(h.calls.length, 0);
    }
    await writeFile(f.args.baselinePath, " ");
    const empty = harness(f, []);
    await assert.rejects(() => exhaustiveTask.run(empty.ctx), /baselinePath/);
    await writeFile(f.args.baselinePath, "Original baseline\n");
    const h = harness(f, [["Inventory:0", inventory()], ["Audit:1:", inventory()]]);
    assert.equal((await exhaustiveTask.run(h.ctx)).status, "complete");
    await writeFile(f.args.baselinePath, "Reclassified ownership\n");
    const changed = await exhaustiveTask.run(h.ctx);
    assert.equal(changed.status, "blocked");
    assert.match(changed.reason, /Baseline changed/);
    assert.equal(h.calls.length, 2);
});

test("scope escape validation runs with otherwise valid arguments", async (t) => {
    const f = await fixture(t);
    for (const scope of [[".."], [resolve(".")], [".git"], [".git\\config"]]) {
        const h = harness({ args: { ...f.args, scope } }, []);
        await assert.rejects(() => exhaustiveTask.run(h.ctx), /scope paths/);
        assert.equal(h.events.length, 0);
    }
});

test("round ceiling pauses before more work and resume allows one more bounded batch", async (t) => {
    const f = await fixture(t);
    f.args.maxRounds = 1;
    const c = item("integration-c");
    const h = harness(f, [
        ["Inventory:0", inventory([a])], ["Work:1:", work(f, "a\n")],
        ["Verify:1:", verification()], ["Audit:1:", inventory([b])],
        ["Work:2:", work(f, "a b\n")], ["Verify:2:", verification()],
        ["Audit:2:", inventory([c])], ["Work:3:", work(f, "a b c\n")],
        ["Verify:3:", verification()], ["Audit:3:", inventory()],
    ]);
    await assert.rejects(() => exhaustiveTask.run(h.ctx), /PAUSED:round-limit-v1:1/);
    assert.equal(h.calls.length, 4);
    assert.ok(h.logs.some((log) => log.includes("APPROVAL REQUIRED") && log.includes(b.id)));
    await assert.rejects(() => exhaustiveTask.run(h.ctx), /PAUSED:round-limit-v1:2/);
    assert.equal(h.calls.length, 7);
    const result = await exhaustiveTask.run(h.ctx);
    assert.equal(result.status, "complete");
    assert.equal(result.round, 3);
    assert.equal(h.calls.length, 10);
});

test("completion at the round ceiling does not pause or count partial work as complete", async (t) => {
    const f = await fixture(t);
    f.args.maxRounds = 1;
    const h = harness(f, [["Inventory:0", inventory()], ["Audit:1:", inventory()]]);
    assert.equal((await exhaustiveTask.run(h.ctx)).status, "complete");
    assert.equal(h.logs.some((log) => log.includes("APPROVAL REQUIRED")), false);
});

test("external edits at a round checkpoint require a fresh run", async (t) => {
    const f = await fixture(t);
    f.args.maxRounds = 1;
    const h = harness(f, [
        ["Inventory:0", inventory([a])], ["Work:1:", work(f, "a\n")],
        ["Verify:1:", verification()], ["Audit:1:", inventory([b])],
    ]);
    await assert.rejects(() => exhaustiveTask.run(h.ctx), /PAUSED:round-limit/);
    await writeFile(f.path, "user revision\n");
    const result = await exhaustiveTask.run(h.ctx);
    assert.equal(result.status, "blocked");
    assert.match(result.reason, /changed at the round checkpoint/);
    assert.equal(h.calls.length, 4);
});

test("invalid arguments and paths are rejected before any model calls", async () => {
    for (const args of [
        null, {}, { goal: " ", acceptance: "done", scope: ["."] },
        { goal: "goal", acceptance: "", scope: ["."] },
        { goal: "goal", acceptance: "done", scope: [] },
        { goal: "goal", acceptance: "done", scope: [".."] },
        { goal: "goal", acceptance: "done", scope: [resolve(".")] },
        { goal: "goal", acceptance: "done", scope: [".git"] },
    ]) {
        const h = harness({ args }, []);
        await assert.rejects(() => exhaustiveTask.run(h.ctx), /goal|acceptance|scope|baselinePath/);
        assert.equal(h.calls.length, 0);
    }
});

test("a missed cross-file item is discovered and executed in a second foreach round", async (t) => {
    const f = await fixture(t);
    const h = harness(f, [
        ["Inventory:0", inventory([a])],
        ["Work:1:integration-a", work(f, "a documented\n")],
        ["Verify:1:integration-a:", verification()],
        ["Audit:1:", inventory([b])],
        ["Work:2:integration-b", work(f, "a and b documented\n")],
        ["Verify:2:integration-b:", verification()],
        ["Audit:2:", inventory()],
    ]);
    const result = await exhaustiveTask.run(h.ctx);
    assert.equal(result.status, "complete");
    assert.equal(result.round, 2);
    assert.deepEqual(result.completed.map((entry) => entry.item.id), [a.id, b.id]);
    assert.deepEqual(result.pending, []);
    assert.equal(await readFile(f.path, "utf8"), "a and b documented\n");
    assert.ok(h.calls.every((call) => !call.model && !call.reasoningEffort && !call.contextTier));
    const audit = h.calls.find((call) => call.label.startsWith("Audit:2:"));
    assert.equal(audit.context.manifest.length, 1);
    assert.match(audit.context.manifest[0], /output\.txt$/);
});

test("work is sequential and each item is verified before the next worker", async (t) => {
    const f = await fixture(t);
    const h = harness(f, [
        ["Inventory:0", inventory([a, b])],
        ["Work:1:integration-a", work(f, "a\n")],
        ["Verify:1:integration-a:", verification()],
        ["Work:1:integration-b", work(f, "a b\n")],
        ["Verify:1:integration-b:", verification()],
        ["Audit:1:", inventory()],
    ]);
    assert.equal((await exhaustiveTask.run(h.ctx)).status, "complete");
    for (const call of h.calls) {
        assert.match(call.prompt, /Do not delegate/);
        assert.match(call.prompt, /Only Work agents may edit/);
        assert.match(call.prompt, /Only Commit agents may stage and commit/);
    }
    assert.deepEqual(h.events.map((call) => call.label.split(":")[0]), [
        "Inventory", "Work", "Verify", "Commit", "Work", "Verify", "Commit", "Audit",
    ]);
    assert.equal(h.commitCalls.length, 2);
    for (const call of h.commitCalls) {
        assert.match(call.prompt, /agent-skills:git-workflow-and-versioning/);
        assert.match(call.prompt, /never git add -A/);
        assert.match(call.prompt, /original baseline and earlier save points/);
        assert.equal(call.context.baselinePath, f.args.baselinePath);
    }
});

test("missing, failed or unevidenced commit receipts stop before the next item and audit", async (t) => {
    const f = await fixture(t);
    for (const commit of [
        null, receipt({ commit: "short" }), receipt({ checks: [] }),
        receipt({ checks: [{ ...check, outcome: "failed" }] }),
        receipt({ questions: ["May these overlapping staged changes be included?"] }),
        receipt({ status: "blocked" }), receipt({ outcome: "unchanged" }),
    ]) {
        const h = harness(f, [
            ["Inventory:0", inventory([a, b])],
            ["Work:1:", report()], ["Verify:1:", verification()],
        ], commit);
        const result = await exhaustiveTask.run(h.ctx);
        assert.equal(result.status, "blocked");
        assert.equal(result.phase, "Commit");
        assert.equal(result.completed.length, 0);
        assert.deepEqual(result.pending, [a, b]);
        assert.deepEqual(result.needsInput, commit?.questions ?? []);
        assert.equal(h.calls.length, 3);
    }
});

test("evidenced unchanged items do not require an empty commit", async (t) => {
    const f = await fixture(t);
    const h = harness(f, [
        ["Inventory:0", inventory([a])], ["Work:1:", report()],
        ["Verify:1:", verification()], ["Audit:1:", inventory()],
    ], receipt({ outcome: "unchanged", commit: "" }));
    const result = await exhaustiveTask.run(h.ctx);
    assert.equal(result.status, "complete");
    assert.equal(result.completed[0].commit.outcome, "unchanged");
});

test("incomplete item verification never invokes the commit agent", async (t) => {
    const f = await fixture(t);
    const h = harness(f, [
        ["Inventory:0", inventory([a])], ["Work:1:", report()],
        ["Verify:1:", verification({ complete: false, remaining: "Still missing" })],
        ["Audit:1:", inventory([a])],
    ]);
    assert.equal((await exhaustiveTask.run(h.ctx)).status, "blocked");
    assert.equal(h.commitCalls.length, 0);
});

test("verifier or commit-agent content edits invalidate the save point", async (t) => {
    const f = await fixture(t);
    const verifier = harness(f, [
        ["Inventory:0", inventory([a])], ["Work:1:", report()],
        ["Verify:1:", async () => {
            await writeFile(f.path, "verifier edit\n");
            return verification();
        }],
    ]);
    assert.equal((await exhaustiveTask.run(verifier.ctx)).phase, "Verify");
    assert.equal(verifier.commitCalls.length, 0);
    const committer = harness(f, [
        ["Inventory:0", inventory([a])], ["Work:1:", report()], ["Verify:1:", verification()],
    ], async () => {
        await writeFile(f.path, "commit agent edit\n");
        return receipt();
    });
    const result = await exhaustiveTask.run(committer.ctx);
    assert.equal(result.status, "blocked");
    assert.equal(result.phase, "Commit");
});

test("a verifier's repair remains queued even when the audit incorrectly returns no items", async (t) => {
    const f = await fixture(t);
    const h = harness(f, [
        ["Inventory:0", inventory([a])],
        ["Work:1:", work(f, "partial\n")],
        ["Verify:1:", verification({ complete: false, remaining: "Document the error path" })],
        ["Audit:1:", inventory()],
        ["Work:2:", async (context) => {
            assert.equal(context.repair, "Document the error path");
            return work(f, "complete including error path\n")();
        }],
        ["Verify:2:", verification()],
        ["Audit:2:", inventory()],
    ]);
    assert.equal((await exhaustiveTask.run(h.ctx)).status, "complete");
});

test("an audit can reopen an independently verified item", async (t) => {
    const f = await fixture(t);
    const h = harness(f, [
        ["Inventory:0", inventory([a])],
        ["Work:1:", work(f, "partial\n")],
        ["Verify:1:", verification()],
        ["Audit:1:", inventory([a], { summary: "Error handling is missing" })],
        ["Work:2:", async (context) => {
            assert.equal(context.lastAudit.summary, "Error handling is missing");
            return work(f, "complete\n")();
        }],
        ["Verify:2:", verification()],
        ["Audit:2:", inventory()],
    ]);
    const result = await exhaustiveTask.run(h.ctx);
    assert.equal(result.status, "complete");
    assert.equal(result.completed.length, 1);
    assert.equal(result.completed[0].work.status, "ready");
});

test("an initially empty inventory still requires a separate complete audit", async (t) => {
    const f = await fixture(t);
    const h = harness(f, [["Inventory:0", inventory()], ["Audit:1:", inventory()]]);
    assert.equal((await exhaustiveTask.run(h.ctx)).status, "complete");
    assert.equal(h.calls.length, 2);
});

test("new untracked scoped files appear in the full-scope audit manifest", async (t) => {
    const f = await fixture(t);
    const h = harness(f, [
        ["Inventory:0", inventory([a])],
        ["Work:1:", async () => {
            await writeFile(join(f.directory, "new.txt"), "new integration\n");
            return report();
        }],
        ["Verify:1:", verification()],
        ["Audit:1:", (context) => {
            assert.equal(context.manifest.length, 2);
            assert.ok(context.manifest.some((path) => path.endsWith("/new.txt")));
            return inventory();
        }],
    ]);
    assert.equal((await exhaustiveTask.run(h.ctx)).status, "complete");
});

test("null, incomplete coverage, duplicate IDs and missing evidence never count as an inventory", async (t) => {
    const f = await fixture(t);
    for (const answer of [
        null, inventory([], { coverage: [] }), inventory([a, a]),
        inventory([], { evidence: [] }), inventory([], { status: "blocked" }),
    ]) {
        const h = harness(f, [["Inventory:0", answer]]);
        assert.equal((await exhaustiveTask.run(h.ctx)).status, "blocked");
        assert.equal(h.calls.length, 1);
    }
});

test("null workers and human decisions stop with pending work, not success", async (t) => {
    const f = await fixture(t);
    for (const answer of [null, report({ questions: ["Which API version?"] })]) {
        const h = harness(f, [["Inventory:0", inventory([a])], ["Work:1:", answer]]);
        const result = await exhaustiveTask.run(h.ctx);
        assert.equal(result.status, "blocked");
        assert.deepEqual(result.pending, [a]);
        assert.deepEqual(result.needsInput, answer?.questions ?? []);
    }
});

test("completion requires passing nonempty checks from verifier and final auditor", async (t) => {
    const f = await fixture(t);
    for (const checks of [[], [{ ...check, outcome: "failed" }], [{ ...check, outcome: "not-run" }]]) {
        const badVerification = harness(f, [
            ["Inventory:0", inventory([a])], ["Work:1:", report()],
            ["Verify:1:", verification({ checks })],
        ]);
        assert.equal((await exhaustiveTask.run(badVerification.ctx)).status, "blocked");
        const badAudit = harness(f, [
            ["Inventory:0", inventory()], ["Audit:1:", inventory([], { checks })],
        ]);
        assert.equal((await exhaustiveTask.run(badAudit.ctx)).status, "blocked");
    }
});

test("unchanged scoped files with the same remaining items stop as stalled", async (t) => {
    const f = await fixture(t);
    const h = harness(f, [
        ["Inventory:0", inventory([a])], ["Work:1:", report()],
        ["Verify:1:", verification({ complete: false, remaining: "Still missing" })],
        ["Audit:1:", inventory([a])],
    ]);
    const result = await exhaustiveTask.run(h.ctx);
    assert.equal(result.status, "blocked");
    assert.match(result.reason, /No scoped file changes/);
    assert.equal(result.pending.length, 1);
});

test("read-only audit mutations and incomplete audit coverage cannot complete", async (t) => {
    const f = await fixture(t);
    for (const audit of [
        inventory([], { coverage: [] }),
        async () => {
            await writeFile(f.path, "changed during audit\n");
            return inventory();
        },
    ]) {
        const h = harness(f, [["Inventory:0", inventory()], ["Audit:1:", audit]]);
        const result = await exhaustiveTask.run(h.ctx);
        assert.equal(result.status, "blocked");
        assert.match(result.reason, /coverage|changed during/);
    }
});

test("stable ID conflicts block instead of silently weakening acceptance", async (t) => {
    const f = await fixture(t);
    const h = harness(f, [
        ["Inventory:0", inventory([a])], ["Work:1:", report()],
        ["Verify:1:", verification()],
        ["Audit:1:", inventory([{ ...a, acceptance: "Skip verification" }])],
    ]);
    const result = await exhaustiveTask.run(h.ctx);
    assert.equal(result.status, "blocked");
    assert.match(result.reason, /Conflicting definition/);
});

test("stable item identity is independent of JSON property order", async (t) => {
    const f = await fixture(t);
    const reordered = { acceptance: a.acceptance, instruction: a.instruction, title: a.title, id: a.id };
    const h = harness(f, [
        ["Inventory:0", inventory([a])], ["Work:1:", work(f, "partial\n")],
        ["Verify:1:", verification()], ["Audit:1:", inventory([reordered])],
        ["Work:2:", work(f, "complete\n")], ["Verify:2:", verification()],
        ["Audit:2:", inventory()],
    ]);
    assert.equal((await exhaustiveTask.run(h.ctx)).status, "complete");
});

test("resume after an interrupted active round verifies changed files with fresh agent identities", async (t) => {
    const f = await fixture(t);
    const h = harness(f, [
        ["Inventory:0", inventory([a])], ["Work:1:", work(f, "done\n")],
        ["Verify:1:", verification()],
        ["Audit:1:", () => { throw new Error("interrupted"); }],
        ["Verify:1:", verification({ complete: false, remaining: "Restore removed documentation" })],
        ["Audit:1:", inventory([a])],
    ]);
    await assert.rejects(() => exhaustiveTask.run(h.ctx), /interrupted/);
    await writeFile(f.path, "documentation removed externally\n");
    const result = await exhaustiveTask.run(h.ctx);
    assert.equal(result.status, "blocked");
    assert.match(result.reason, /No scoped file changes/);
    assert.equal(h.calls.filter((call) => call.label.startsWith("Work:")).length, 1);
    const verifiers = h.calls.filter((call) => call.label.startsWith("Verify:"));
    assert.equal(verifiers.length, 2);
    assert.notEqual(verifiers[0].label, verifiers[1].label);
    const audits = h.calls.filter((call) => call.label.startsWith("Audit:"));
    assert.notEqual(audits[0].label, audits[1].label);
});

test("resume replays durable rounds without edits, but changed final content invalidates success", async (t) => {
    const f = await fixture(t);
    const h = harness(f, [
        ["Inventory:0", inventory([a])], ["Work:1:", work(f, "done\n")],
        ["Verify:1:", verification()], ["Audit:1:", inventory()],
    ]);
    assert.equal((await exhaustiveTask.run(h.ctx)).status, "complete");
    assert.equal((await exhaustiveTask.run(h.ctx)).status, "complete");
    assert.equal(h.calls.length, 4);
    await writeFile(f.path, "external change\n");
    const stale = await exhaustiveTask.run(h.ctx);
    assert.equal(stale.status, "blocked");
    assert.match(stale.reason, /differs from the journaled final audit/);
});

test("cancellation and hard runtime errors propagate without success-shaped fallback", async (t) => {
    const f = await fixture(t);
    const h = harness(f, [["Inventory:0", () => { throw new Error("workflow_limit_reached"); }]]);
    await assert.rejects(() => exhaustiveTask.run(h.ctx), /workflow_limit_reached/);
});
