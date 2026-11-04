import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { exhaustiveTask } from "../com.github.copilot/extensions/exhaustive-task/workflow.mjs";

const check = { command: "inspect source", outcome: "passed", evidence: "Matches source" };
const report = (extra = {}) => ({
    status: "ready", summary: "Inspected actual files", evidence: ["file.txt:1"], checks: [check], questions: [], ...extra,
});
const work = (processed, findings = [], changes = [], strategy = "") => report({ processed, findings, changes, strategy });
const verified = (extra = {}) => report({ complete: true, remaining: "", rejected: [], ...extra });
const finding = (id, location) => ({ id, title: `Title ${id}`, locations: [location], details: `Details ${id}` });
const git = (cwd, ...args) => execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com",
    "-c", "core.autocrlf=false", ...args], { cwd, encoding: "utf8" }).trim();
const origin = process.cwd();

async function temp(t) {
    const directory = await realpath(await mkdtemp(join(tmpdir(), "exhaustive-test-")));
    t.after(async () => {
        process.chdir(origin);
        await rm(directory, { recursive: true, force: true });
    });
    return directory;
}

async function repo(path, files) {
    await mkdir(path, { recursive: true });
    git(path, "init", "-q");
    for (const [file, content] of Object.entries(files)) {
        await mkdir(dirname(join(path, file)), { recursive: true });
        await writeFile(join(path, file), content);
    }
    git(path, "add", "-A");
    git(path, "commit", "-qm", "init");
    return realpath(path);
}

function inside(directory) {
    process.chdir(directory);
}

function harness(args, handler) {
    const journal = new Map();
    const checkpoints = new Set();
    const calls = [];
    const logs = [];
    const ctx = {
        args, runId: "test-run",
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
            const [role, round, attempt] = options.label.split(":");
            const call = { role, round: Number(round), attempt: Number(attempt), model: options.model, context: JSON.parse(prompt.split("Context (JSON):\n")[1]) };
            calls.push(call);
            const output = await handler(call);
            assert.ok(output, `Unexpected agent: ${options.label}`);
            journal.set(key, output);
            return output;
        },
    };
    return { ctx, calls, logs, run: () => exhaustiveTask.run(ctx) };
}

const defaultHandler = (overrides = {}) => async (call) => {
    if (overrides[call.role]) {
        const output = await overrides[call.role](call);
        if (output) return output;
    }
    if (call.role === "Work") return work(call.context.batch, [], [], call.context.batch.length ? "" : `strategy ${call.round}`);
    if (call.role === "Verify" || call.role === "Final") return verified();
    return undefined;
};

async function filesFixture(t, count = 7, extra = {}) {
    const root = await temp(t);
    const files = Object.fromEntries(Array.from({ length: count }, (_, index) => [`src/${String.fromCharCode(97 + index)}.txt`, `file ${index}\n`]));
    const path = await repo(join(root, "repo"), { ...files, "other/skip.txt": "skip\n", ".gitignore": "ignored/\n" });
    await mkdir(join(path, "ignored"));
    await writeFile(join(path, "ignored", "x.txt"), "ignored\n");
    inside(path);
    return {
        root, path,
        args: { goal: "Find every ADO integration", acceptance: "Every integration is listed", mode: "files",
            paths: ["src"], ledgerPath: join(root, "ledger.md"), batchSize: 3, ...extra },
    };
}

test("registered workflow declares its contract without resource limits", () => {
    assert.equal(exhaustiveTask.meta.name, "exhaustive-task");
    assert.deepEqual(exhaustiveTask.meta.argsSchema.required, ["goal", "acceptance", "mode", "ledgerPath"]);
    assert.equal(exhaustiveTask.meta.limits, undefined);
});

test("invalid arguments fail before agents are spawned", async (t) => {
    const f = await filesFixture(t);
    const invalid = [
        { mode: "everything" }, { batchSize: 0 }, { quietRounds: -1 }, { maxRounds: 1.5 },
        { ledgerPath: "ledger.md" }, { paths: [] }, { paths: ["../outside"] }, { paths: [".git"] },
        { paths: ["nothing-here"] }, { mode: "repos", paths: ["relative"] }, { model: "" }, { verifyModel: 3 },
    ];
    for (const override of invalid) {
        const h = harness({ ...f.args, ...override }, defaultHandler());
        await assert.rejects(h.run);
        assert.equal(h.calls.length, 0, JSON.stringify(override));
    }
});

test("files mode covers every scoped file in batches, then reviews until quiet", async (t) => {
    const f = await filesFixture(t);
    const h = harness(f.args, defaultHandler({
        Work: ({ context, round }) => {
            if (context.batch.length) {
                const hits = context.batch.filter((file) => ["src/b.txt", "src/e.txt"].includes(file));
                return work(context.batch, hits.map((file) => finding("ado-rest-client", file)));
            }
            if (round === 4) return work([], [finding("ado-pipeline", "azure-pipelines.yml:1")], [], "searched pipelines");
            return undefined;
        },
    }));
    const result = await h.run();
    assert.equal(result.status, "complete");
    const batches = h.calls.filter((call) => call.role === "Work" && call.context.batch.length).map((call) => call.context.batch);
    assert.deepEqual(batches, [["src/a.txt", "src/b.txt", "src/c.txt"], ["src/d.txt", "src/e.txt", "src/f.txt"], ["src/g.txt"]]);
    assert.equal(h.calls.filter((call) => call.role === "Verify").length, 0);
    assert.equal(h.calls.filter((call) => call.role === "Final").length, 1);
    assert.equal(h.calls.some((call) => call.role === "Commit"), false);
    assert.deepEqual(result.findings.map((entry) => [entry.id, entry.locations]), [
        ["ado-rest-client", ["src/b.txt", "src/e.txt"]], ["ado-pipeline", ["azure-pipelines.yml:1"]],
    ]);
    const reviews = h.calls.filter((call) => call.role === "Work" && !call.context.batch.length);
    assert.deepEqual(reviews.at(-1).context.previousStrategies, ["searched pipelines", "strategy 5"]);
    assert.deepEqual(reviews[1].context.ledger.findings.map((entry) => entry.id), ["ado-rest-client", "ado-pipeline"]);
    const ledger = await readFile(f.args.ledgerPath, "utf8");
    assert.match(ledger, /7\/7 units processed, 2 findings/);
    assert.match(ledger, /### Title ado-pipeline/);
    assert.match(ledger, /searched pipelines/);
    assert.doesNotMatch(ledger, /strategy 5/);
});

test("final verification rejects findings, reopens the search and passes models through", async (t) => {
    const root = await temp(t);
    const path = await repo(join(root, "repo"), { "app.ts": "x\n" });
    const h = harness({
        goal: "Find every ADO integration", acceptance: "All listed", mode: "search", paths: [path],
        ledgerPath: join(root, "ledger.md"), quietRounds: 1, model: "cheap", verifyModel: "strong",
    }, defaultHandler({
        Work: ({ round, context }) => {
            if (round === 1) return work([], [finding("real-hit", "app.ts:1"), finding("fake-hit", "app.ts:2")], [], "grep");
            if (round === 3) {
                assert.equal(context.repair, "Check service hooks");
                assert.deepEqual(context.rejectedFindings, ["fake-hit"]);
                return work([], [finding("service-hook", "app.ts:3"), finding("fake-hit", "app.ts:2")], [], "hooks");
            }
            assert.equal(context.repair, null);
            return undefined;
        },
        Final: ({ round }) => round === 2
            ? report({ complete: false, remaining: "Check service hooks", rejected: ["fake-hit"] }) : undefined,
    }));
    const result = await h.run();
    assert.equal(result.status, "complete");
    assert.deepEqual(result.findings.map((entry) => entry.id), ["real-hit", "service-hook"]);
    assert.deepEqual(result.rejected, ["fake-hit"]);
    assert.deepEqual(h.calls.filter((call) => call.role === "Final").map((call) => call.round), [2, 4]);
    assert.ok(h.calls.every((call) => call.model === (call.role === "Final" ? "strong" : "cheap")));
    const ledger = await readFile(join(root, "ledger.md"), "utf8");
    assert.match(ledger, /Rejected by final verification/);
    assert.doesNotMatch(ledger, /### Title fake-hit/);
});

test("rounds that change files are verified and repaired; rejected findings stay out", async (t) => {
    const f = await filesFixture(t, 2, { batchSize: 2, quietRounds: 1 });
    const h = harness(f.args, defaultHandler({
        Work: async ({ context, round, attempt }) => {
            if (round !== 1) return undefined;
            await writeFile(join(f.path, "src", "a.txt"), `cleaned ${attempt}\n`);
            return work(context.batch, [finding("real-hit", "src/a.txt"), finding("fake-hit", "src/b.txt")], ["src/a.txt: cleaned"]);
        },
        Verify: ({ round, attempt }) => round === 1 ? (attempt === 1
            ? report({ complete: false, remaining: "Inspect src/b.txt again", rejected: [] })
            : verified({ rejected: ["fake-hit"] })) : undefined,
        Commit: () => {
            git(f.path, "commit", "-qam", "refactor: clean batch");
            return report({ commits: [{ repo: f.path, commit: git(f.path, "rev-parse", "HEAD") }], uncommitted: [] });
        },
    }));
    const result = await h.run();
    assert.equal(result.status, "complete");
    const repair = h.calls.find((call) => call.role === "Work" && call.attempt === 2);
    assert.equal(repair.context.repair, "Inspect src/b.txt again");
    assert.deepEqual(result.findings.map((entry) => entry.id), ["real-hit"]);
    assert.doesNotMatch(await readFile(f.args.ledgerPath, "utf8"), /fake-hit/);
});

test("rounds block on uncovered batches, persistent verification failures and verifier mutations", async (t) => {
    const f = await filesFixture(t, 2, { batchSize: 2 });
    const partial = await harness(f.args, defaultHandler({ Work: () => work(["src/a.txt"]) })).run();
    assert.equal(partial.status, "blocked");
    assert.equal(partial.phase, "Work");

    const failing = harness(f.args, defaultHandler({
        Work: async ({ context }) => {
            await writeFile(join(f.path, "src", "a.txt"), "failing change\n");
            return work(context.batch, [], ["src/a.txt: changed"]);
        },
        Verify: () => report({ complete: false, remaining: "Still missing", rejected: [] }),
    }));
    const stuck = await failing.run();
    assert.equal(stuck.phase, "Verify");
    assert.equal(failing.calls.filter((call) => call.role === "Work").length, 3);

    const mutating = await harness(f.args, defaultHandler({
        Work: async ({ context }) => {
            await writeFile(join(f.path, "src", "b.txt"), "mutating work\n");
            return work(context.batch, [], ["src/b.txt: changed"]);
        },
        Verify: async () => {
            await writeFile(join(f.path, "src", "a.txt"), "changed by verifier\n");
            return verified();
        },
    })).run();
    assert.equal(mutating.status, "blocked");
    assert.match(mutating.reason, /read-only verification/);
});

test("changed rounds are committed with the ledger while pre-existing edits are reported", async (t) => {
    const f = await filesFixture(t, 2, { batchSize: 2, quietRounds: 1 });
    await writeFile(join(f.path, "other", "skip.txt"), "user edit\n");
    const ledgerPath = join(f.path, "docs", "ledger.md");
    const h = harness({ ...f.args, ledgerPath }, defaultHandler({
        Work: async ({ context }) => {
            if (!context.batch.length) return undefined;
            await writeFile(join(f.path, "src", "a.txt"), "cleaned\n");
            return work(context.batch, [], ["src/a.txt: cleaned"]);
        },
        Commit: ({ context }) => {
            assert.deepEqual(context.changedRepos, [f.path]);
            assert.deepEqual(context.preExisting[f.path], ["other/skip.txt"]);
            git(f.path, "add", "src/a.txt", "docs/ledger.md");
            git(f.path, "commit", "-qm", "refactor: clean batch");
            return report({ commits: [{ repo: f.path, commit: git(f.path, "rev-parse", "HEAD") }], uncommitted: [] });
        },
    }));
    const result = await h.run();
    assert.equal(result.status, "complete");
    assert.equal(result.commits.length, 1);
    assert.equal(git(f.path, "status", "--porcelain"), "M other/skip.txt");
    assert.match(git(f.path, "show", "HEAD:docs/ledger.md"), /src\/a.txt: cleaned/);
});

test("commit reports must account for every changed repository and keep contents unchanged", async (t) => {
    const f = await filesFixture(t, 1, { batchSize: 1 });
    const changing = defaultHandler({
        Work: async ({ context }) => {
            await writeFile(join(f.path, "src", "a.txt"), "changed\n");
            return work(context.batch, [], ["src/a.txt: changed"]);
        },
        Commit: () => report({ commits: [], uncommitted: [] }),
    });
    const result = await harness(f.args, changing).run();
    assert.equal(result.status, "blocked");
    assert.equal(result.phase, "Commit");
});

test("repos mode discovers repositories and processes one per round by default", async (t) => {
    const root = await temp(t);
    const a = await repo(join(root, "a"), { "Program.cs": "a\n" });
    const b = await repo(join(root, "group", "b"), { "Program.cs": "b\n" });
    await repo(join(root, "node_modules", "c"), { "x.txt": "c\n" });
    await mkdir(join(root, "plain"));
    const h = harness({
        goal: "Update packages, then change X in Program.cs", acceptance: "Builds pass", mode: "repos",
        paths: [root], ledgerPath: join(root, "ledger.md"), quietRounds: 1,
    }, defaultHandler());
    const result = await h.run();
    assert.equal(result.status, "complete");
    assert.deepEqual(h.calls.filter((call) => call.role === "Work").map((call) => call.context.batch), [[a], [b], []]);
    assert.deepEqual(h.calls[0].context.repos, [a, b]);
});

test("review rounds that only add locations to known findings are not quiet", async (t) => {
    const root = await temp(t);
    const path = await repo(join(root, "repo"), { "app.ts": "x\n" });
    const h = harness({
        goal: "Find every ADO integration", acceptance: "All listed", mode: "search", paths: [path],
        ledgerPath: join(root, "ledger.md"), quietRounds: 1,
    }, defaultHandler({
        Work: ({ round }) => round === 1 ? work([], [finding("sdk", "a.cs:1")], [], "grep")
            : round === 2 ? work([], [finding("sdk", "b.cs:2")], [], "trace callers") : undefined,
        Final: ({ context }) => {
            assert.equal(context.ledger.findings[0].details, "Details sdk");
            return undefined;
        },
    }));
    const result = await h.run();
    assert.equal(result.status, "complete");
    assert.equal(result.round, 3);
    assert.deepEqual(result.findings[0].locations, ["a.cs:1", "b.cs:2"]);
    assert.match(await readFile(join(root, "ledger.md"), "utf8"), /trace callers \(new: none; new locations: 1/);
});

test("search mode has no units and stops after the configured quiet review rounds", async (t) => {
    const root = await temp(t);
    const path = await repo(join(root, "repo"), { "app.ts": "x\n" });
    const h = harness({
        goal: "Find every difference between the design export and the implementation", acceptance: "All listed",
        mode: "search", paths: [path], ledgerPath: join(root, "ledger.md"),
    }, defaultHandler({
        Work: ({ round }) => round === 1 ? work([], [finding("header-color", "app.ts:1"), finding("footer-gap", "app.ts:2")], [], "compared screens") : undefined,
    }));
    const result = await h.run();
    assert.equal(result.status, "complete");
    assert.equal(result.round, 3);
    assert.equal(result.findings.length, 2);
});

test("a new run with the same ledger continues after processed units and rejects foreign ledgers", async (t) => {
    const f = await filesFixture(t, 4, { batchSize: 2, quietRounds: 1 });
    const first = await harness(f.args, defaultHandler({
        Work: ({ context, round }) => round === 1 ? work(context.batch, [finding("early-hit", "src/a.txt")])
            : report({ status: "blocked", processed: [], findings: [], changes: [], strategy: "", questions: ["Which org?"] }),
    })).run();
    assert.equal(first.status, "blocked");
    assert.deepEqual(first.needsInput, ["Which org?"]);
    assert.deepEqual(first.remainingUnits, ["src/c.txt", "src/d.txt"]);

    const second = harness(f.args, defaultHandler());
    const result = await second.run();
    assert.equal(result.status, "complete");
    assert.deepEqual(second.calls[0].context.batch, ["src/c.txt", "src/d.txt"]);
    assert.deepEqual(result.findings.map((entry) => entry.id), ["early-hit"]);
    assert.match(await readFile(f.args.ledgerPath, "utf8"), /4\/4 units processed/);

    await assert.rejects(harness({ ...f.args, goal: "Another goal" }, defaultHandler()).run(), /different goal/);
    await writeFile(f.args.ledgerPath, "# Someone else's notes\n");
    await assert.rejects(harness(f.args, defaultHandler()).run(), /not an exhaustive-task ledger/);
});

test("round ceilings pause for approval and block on edits made while paused", async (t) => {
    const f = await filesFixture(t, 3, { batchSize: 1, quietRounds: 1, maxRounds: 2 });
    const h = harness(f.args, defaultHandler());
    await assert.rejects(h.run, /PAUSED:round-limit-v2:2/);
    assert.match(h.logs.join("\n"), /APPROVAL REQUIRED: round-limit:2/);
    const result = await h.run();
    assert.equal(result.status, "complete");
    assert.equal(h.calls.filter((call) => call.role === "Work").length, 4);

    await rm(f.args.ledgerPath);
    const edited = harness(f.args, defaultHandler());
    await assert.rejects(edited.run, /PAUSED:round-limit-v2:2/);
    await writeFile(join(f.path, "src", "c.txt"), "edited during pause\n");
    const blocked = await edited.run();
    assert.equal(blocked.status, "blocked");
    assert.match(blocked.reason, /paused/);
});
