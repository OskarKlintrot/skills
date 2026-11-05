import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
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
        // Like the runtime journal, replays return fresh copies rather than objects the run mutated.
        async step(key, producer) {
            if (!journal.has(key)) journal.set(key, structuredClone(await producer()));
            return structuredClone(journal.get(key));
        },
        async agent(prompt, options) {
            const key = JSON.stringify({ prompt, options });
            if (journal.has(key)) return structuredClone(journal.get(key));
            const [role, round, attempt] = options.label.split(":");
            const call = { role, round: Number(round), attempt: Number(attempt), model: options.model, context: JSON.parse(prompt.split("Context (JSON):\n")[1]) };
            calls.push(call);
            const output = await handler(call);
            assert.ok(output, `Unexpected agent: ${options.label}`);
            journal.set(key, structuredClone(output));
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
        { mode: "everything" }, { coverage: "everything" }, { coverage: null }, { coverage: 1 },
        { batchSize: 0 }, { quietRounds: -1 }, { maxRounds: 1.5 },
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
    assert.match(ledger, /Round 5: strategy 5 \(new: none; new locations: 0; changes: 0\)/);
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
    assert.match(ledger, /Rejected by verification/);
    assert.doesNotMatch(ledger, /### Title fake-hit/);
});

test("a final verdict marked blocked without questions but with remaining work reopens the search", async (t) => {
    const root = await temp(t);
    const path = await repo(join(root, "repo"), { "app.ts": "x\n" });
    const h = harness({
        goal: "Find every ADO integration", acceptance: "All listed", mode: "search", paths: [path],
        ledgerPath: join(root, "ledger.md"), quietRounds: 1,
    }, defaultHandler({
        Work: ({ round, context }) => {
            if (round === 1) return work([], [finding("hooks", "app.ts:1")], [], "grep");
            if (round === 3) assert.equal(context.repair, "Split hooks per event");
            return undefined;
        },
        Final: ({ round }) => round === 2
            ? report({ status: "blocked", complete: false, remaining: "Split hooks per event", rejected: [] }) : undefined,
    }));
    const result = await h.run();
    assert.equal(result.status, "complete");
    assert.deepEqual(h.calls.filter((call) => call.role === "Final").map((call) => call.round), [2, 3]);
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
            ? report({ complete: false, remaining: "Inspect src/b.txt again", rejected: ["fake-hit"] })
            : verified()) : undefined,
    }));
    const result = await h.run();
    assert.equal(result.status, "complete");
    const repair = h.calls.find((call) => call.role === "Work" && call.attempt === 2);
    assert.equal(repair.context.repair, "Inspect src/b.txt again");
    assert.deepEqual(repair.context.rejectedFindings, ["fake-hit"]);
    assert.equal(repair.context.ledger.findings.length, 0);
    assert.deepEqual(result.findings.map((entry) => entry.id), ["real-hit"]);
    assert.deepEqual(result.rejected, ["fake-hit"]);
    const ledger = await readFile(f.args.ledgerPath, "utf8");
    assert.match(ledger, /## Rejected by verification\s+- `fake-hit`/);
    assert.doesNotMatch(ledger, /Title fake-hit/);
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

    git(f.path, "checkout", "-q", "--", ".");
    git(f.path, "checkout", "-qb", "feature");
    const committing = await harness(f.args, defaultHandler({
        Work: async ({ context }) => {
            await writeFile(join(f.path, "src", "b.txt"), "work to verify\n");
            return work(context.batch, [], ["src/b.txt: changed"]);
        },
        Verify: async () => {
            git(f.path, "add", "src/b.txt");
            git(f.path, "commit", "-qm", "verifier commit");
            return verified();
        },
    })).run();
    assert.equal(committing.status, "blocked");
    assert.match(committing.reason, /Git state changed during read-only verification/);
});

test("worker commits on a default or detached branch, or branch switches, block the round", async (t) => {
    const f = await filesFixture(t, 1, { batchSize: 1 });
    git(f.path, "checkout", "-qB", "main");
    let edits = 0;
    const committer = (switchTo) => defaultHandler({
        Work: async ({ context }) => {
            if (switchTo) git(f.path, "checkout", "-q", switchTo);
            await writeFile(join(f.path, "src", "a.txt"), `cleaned ${++edits}\n`);
            git(f.path, "commit", "-qm", "refactor: clean", "--", "src/a.txt");
            return work(context.batch, [], ["src/a.txt: cleaned"]);
        },
    });
    const onDefault = await harness(f.args, committer(null)).run();
    assert.equal(onDefault.status, "blocked");
    assert.match(onDefault.reason, /default or detached branch/);

    git(f.path, "checkout", "-q", "--detach");
    const detached = await harness(f.args, committer(null)).run();
    assert.match(detached.reason, /default or detached branch/);

    git(f.path, "branch", "-q", "elsewhere");
    const switched = await harness(f.args, committer("elsewhere")).run();
    assert.match(switched.reason, /changed branches/);
});

test("there is no commit step; edits a worker commits itself are still verified", async (t) => {
    const f = await filesFixture(t, 2, { batchSize: 2, quietRounds: 1 });
    git(f.path, "checkout", "-qb", "feature");
    await writeFile(join(f.path, "other", "skip.txt"), "user edit\n");
    const head = git(f.path, "rev-parse", "HEAD");
    const h = harness({ ...f.args, goal: "Clean every file and commit each batch" }, defaultHandler({
        Work: async ({ context }) => {
            if (!context.batch.length) return undefined;
            assert.deepEqual(context.preExisting[f.path], ["other/skip.txt"]);
            await writeFile(join(f.path, "src", "a.txt"), "cleaned\n");
            git(f.path, "commit", "-qm", "refactor: clean batch", "--", "src/a.txt");
            return work(context.batch, [], ["src/a.txt: cleaned"]);
        },
    }));
    const result = await h.run();
    assert.equal(result.status, "complete");
    assert.equal(result.commits, undefined);
    assert.equal(h.calls.filter((call) => call.role === "Verify").length, 1);
    assert.deepEqual(exhaustiveTask.meta.phases.map((phase) => phase.title), ["Work", "Verify"]);
    assert.equal(git(f.path, "rev-list", "--count", `${head}..HEAD`), "1");
    assert.equal(git(f.path, "status", "--porcelain"), "M other/skip.txt");
});

test("changed rounds stay uncommitted unless a worker commits them", async (t) => {
    const f = await filesFixture(t, 1, { batchSize: 1, quietRounds: 1 });
    const h = harness(f.args, defaultHandler({
        Work: async ({ context }) => {
            if (!context.batch.length) return undefined;
            await writeFile(join(f.path, "src", "a.txt"), "cleaned\n");
            return work(context.batch, [], ["src/a.txt: cleaned"]);
        },
    }));
    assert.equal((await h.run()).status, "complete");
    assert.equal(git(f.path, "status", "--porcelain"), "M src/a.txt");
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

test("findings coverage saves new locations but counts those review rounds as quiet", async (t) => {
    const root = await temp(t);
    const path = await repo(join(root, "repo"), { "app.ts": "x\n" });
    const h = harness({
        goal: "Find every ADO integration", acceptance: "All listed", mode: "search", paths: [path],
        ledgerPath: join(root, "ledger.md"), coverage: "findings", quietRounds: 2,
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

test("occurrences coverage extends the search for distinct locations, not repeated reports", async (t) => {
    const root = await temp(t);
    const path = await repo(join(root, "repo"), { "app.ts": "Button Button Button\n" });
    const h = harness({
        goal: "Find every button", acceptance: "Every occurrence has a source anchor", mode: "search",
        coverage: "occurrences", paths: [path], ledgerPath: join(root, "ledger.md"), quietRounds: 2,
    }, defaultHandler({
        Work: ({ round }) => {
            assert.ok(round <= 6, "Repeated locations must not extend the search");
            const location = round === 1 ? "app.ts:1:1" : round < 4 ? "app.ts:1:8" : "app.ts:1:15";
            return work([], [{ ...finding("button", location), locations: [location, location] }], [], `strategy ${round}`);
        },
    }));
    const result = await h.run();
    assert.equal(result.status, "complete");
    assert.equal(result.round, 6);
    assert.deepEqual(result.findings[0].locations, ["app.ts:1:1", "app.ts:1:8", "app.ts:1:15"]);
    assert.equal(h.calls.filter((call) => call.role === "Final").length, 1);
    assert.ok(h.calls.every((call) => call.context.coverage === "occurrences"));
    const ledger = await readFile(join(root, "ledger.md"), "utf8");
    assert.match(ledger, /\*\*Coverage:\*\* occurrences/);
    assert.match(ledger, /Round 2: strategy 2 \(new: none; new locations: 1/);
    assert.match(ledger, /Round 3: strategy 3 \(new: none; new locations: 0/);
});

test("one scoped file receives reviews that repair a missed edit, verification and a final check", async (t) => {
    const root = await temp(t);
    const path = await repo(join(root, "repo"), { "app.txt": "Y Y\n" });
    inside(path);
    const h = harness({
        goal: "Replace Y everywhere in app.txt", acceptance: "No Y remains in app.txt", mode: "files",
        coverage: "occurrences", paths: ["app.txt"], ledgerPath: join(root, "ledger.md"),
    }, defaultHandler({
        Work: async ({ context, round }) => {
            if (context.batch.length) {
                assert.deepEqual(context.batch, ["app.txt"]);
                await writeFile(join(path, "app.txt"), "X Y\n");
                return work(context.batch, [], ["app.txt: replaced first Y"]);
            }
            if (round === 2) {
                assert.equal(await readFile(join(path, "app.txt"), "utf8"), "X Y\n");
                await writeFile(join(path, "app.txt"), "X X\n");
                return work([], [], ["app.txt: replaced remaining Y"], "search remaining occurrences");
            }
            return undefined;
        },
        Final: async () => {
            assert.equal(await readFile(join(path, "app.txt"), "utf8"), "X X\n");
            return undefined;
        },
    }));
    const result = await h.run();
    assert.equal(result.status, "complete");
    assert.equal(result.round, 4);
    assert.equal(h.calls.filter((call) => call.role === "Work" && call.context.batch.length).length, 1);
    assert.equal(h.calls.filter((call) => call.role === "Work" && !call.context.batch.length).length, 3);
    assert.equal(h.calls.filter((call) => call.role === "Verify").length, 2);
    assert.equal(h.calls.filter((call) => call.role === "Final").length, 1);
    assert.ok(h.calls.every((call) => call.context.coverage === "occurrences"));
});

test("read-only search findings are not capped by batch size", async (t) => {
    const root = await temp(t);
    const path = await repo(join(root, "repo"), { "app.ts": "x\n" });
    const hits = Array.from({ length: 8 }, (_, index) => finding(`component-${index}`, `app.ts:${index + 1}`));
    const h = harness({
        goal: "List unique UI component types", acceptance: "Every type is listed", mode: "search",
        paths: [path], ledgerPath: join(root, "ledger.md"), batchSize: 1,
    }, defaultHandler({
        Work: ({ context, round }) => {
            assert.deepEqual(context.batch, []);
            assert.equal(context.coverage, "findings");
            return round === 1 ? work([], hits, [], "inspect design") : undefined;
        },
    }));
    const result = await h.run();
    assert.equal(result.status, "complete");
    assert.equal(result.findings.length, 8);
    assert.equal(result.round, 3);
    assert.equal(h.calls.filter((call) => call.role === "Verify").length, 0);
});

test("occurrences coverage survives continuation and rejects incompatible coverage", async (t) => {
    const f = await filesFixture(t, 2, { batchSize: 1, coverage: "occurrences" });
    const first = await harness(f.args, defaultHandler({
        Work: ({ context, round }) => round === 1 ? work(context.batch, [finding("button", "src/a.txt:1")])
            : report({ status: "blocked", processed: [], findings: [], changes: [], strategy: "", questions: ["Which design?"] }),
    })).run();
    assert.equal(first.status, "blocked");
    const second = harness(f.args, defaultHandler());
    assert.equal((await second.run()).status, "complete");
    assert.deepEqual(second.calls[0].context.batch, ["src/b.txt"]);
    assert.ok(second.calls.every((call) => call.context.coverage === "occurrences"));
    assert.match(await readFile(f.args.ledgerPath, "utf8"), /"coverage": "occurrences"/);
    for (const coverage of [undefined, "findings"]) {
        const incompatible = harness({ ...f.args, coverage }, defaultHandler());
        await assert.rejects(incompatible.run, /different coverage/);
        assert.equal(incompatible.calls.length, 0);
    }
});

test("legacy ledgers retain findings coverage and cannot silently become occurrence searches", async (t) => {
    const f = await filesFixture(t, 1);
    assert.equal((await harness(f.args, defaultHandler()).run()).status, "complete");
    const content = await readFile(f.args.ledgerPath, "utf8");
    const marker = "<!-- exhaustive-task-state";
    const start = content.lastIndexOf(marker);
    const state = JSON.parse(content.slice(start + marker.length, content.indexOf("-->", start)));
    delete state.coverage;
    await writeFile(f.args.ledgerPath, `${marker}\n${JSON.stringify(state)}\n-->\n`);
    const incompatible = harness({ ...f.args, coverage: "occurrences" }, defaultHandler());
    await assert.rejects(incompatible.run, /different coverage/);
    assert.equal(incompatible.calls.length, 0);
    const continued = harness({ ...f.args, coverage: "findings" }, defaultHandler());
    assert.equal((await continued.run()).status, "complete");
    assert.ok(continued.calls.every((call) => call.context.coverage === "findings"));
    assert.ok(continued.calls.filter((call) => call.role === "Work").every((call) => !call.context.batch.length));
    assert.match(await readFile(f.args.ledgerPath, "utf8"), /"coverage": "findings"/);
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
    await assert.rejects(harness({ ...f.args, acceptance: "Looser criteria" }, defaultHandler()).run(),
        /different goal, acceptance/);
    inside(await repo(join(f.root, "other-repo"), { "src/a.txt": "a\n", "src/z.txt": "z\n" }));
    await assert.rejects(harness(f.args, defaultHandler()).run(), /different repository/);
    inside(f.path);
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

test("a resumed round still verifies its own edits", async (t) => {
    const f = await filesFixture(t, 1, { batchSize: 1, quietRounds: 1 });
    let crash = true;
    const h = harness(f.args, defaultHandler({
        Work: async ({ context }) => {
            if (!context.batch.length) return undefined;
            await writeFile(join(f.path, "src", "a.txt"), "cleaned\n");
            return work(context.batch, [], ["src/a.txt: cleaned"]);
        },
        Verify: () => {
            if (crash) {
                crash = false;
                throw new Error("interrupted");
            }
            return undefined;
        },
    }));
    await assert.rejects(h.run, /interrupted/);
    const result = await h.run();
    assert.equal(result.status, "complete");
    assert.equal(h.calls.filter((call) => call.role === "Work" && call.context.batch.length).length, 1);
    assert.equal(h.calls.filter((call) => call.role === "Verify").length, 2);
    assert.match(await readFile(f.args.ledgerPath, "utf8"), /1\/1 units processed/);
});

test("a blocked verification leaves the batch unprocessed for the next run", async (t) => {
    const f = await filesFixture(t, 2, { batchSize: 1, quietRounds: 1 });
    const blocked = await harness(f.args, defaultHandler({
        Work: async ({ context }) => {
            await writeFile(join(f.path, "src", "a.txt"), "changed\n");
            return work(context.batch, [], ["src/a.txt: changed"]);
        },
        Verify: () => report({ status: "blocked", complete: false, remaining: "", rejected: [], questions: ["May I run the tests?"] }),
    })).run();
    assert.equal(blocked.phase, "Verify");
    assert.match(await readFile(f.args.ledgerPath, "utf8"), /0\/2 units processed/);
    git(f.path, "checkout", "--", "src/a.txt");
    const next = harness(f.args, defaultHandler());
    assert.equal((await next.run()).status, "complete");
    assert.deepEqual(next.calls[0].context.batch, ["src/a.txt"]);
});

test("verification repairs replace a finding's title, locations and details", async (t) => {
    const root = await temp(t);
    const path = await repo(join(root, "repo"), { "app.ts": "x\n" });
    let finals = 0;
    const h = harness({
        goal: "Find every ADO integration", acceptance: "All listed", mode: "search", paths: [path],
        ledgerPath: join(root, "ledger.md"), quietRounds: 1,
    }, defaultHandler({
        Work: ({ round, context }) => {
            if (round === 1) return work([], [finding("sdk", "a.cs:1")], [], "grep");
            if (!context.repair) return undefined;
            assert.equal(context.ledger.findings[0].details, "Details sdk");
            return work([], [{ id: "sdk", title: "Corrected", locations: ["b.cs:9"], details: "Corrected details" }], [], "repair");
        },
        Final: () => finals++ ? undefined : report({ complete: false, remaining: "sdk is mislabeled", rejected: [] }),
    }));
    const result = await h.run();
    assert.equal(result.status, "complete");
    assert.deepEqual(result.findings, [{ id: "sdk", title: "Corrected", locations: ["b.cs:9"], details: "Corrected details" }]);
    assert.match(await readFile(join(root, "ledger.md"), "utf8"), /Corrected details/);
});

test("resuming after rounds deleted every scoped file replays preparation", async (t) => {
    const f = await filesFixture(t, 2, { batchSize: 2, quietRounds: 1, maxRounds: 1 });
    const h = harness(f.args, defaultHandler({
        Work: ({ context }) => {
            if (!context.batch.length) return undefined;
            git(f.path, "rm", "-q", "src/a.txt", "src/b.txt");
            return work(context.batch, [], ["removed src"]);
        },
    }));
    await assert.rejects(h.run, /PAUSED:round-limit-v2:1/);
    const result = await h.run();
    assert.equal(result.status, "complete");
});

test("resuming after a final rejection rewrote an in-repo ledger is allowed", async (t) => {
    const root = await temp(t);
    const path = await repo(join(root, "repo"), { "app.ts": "x\n" });
    inside(path);
    let finals = 0;
    const h = harness({
        goal: "Find every ADO integration", acceptance: "All listed", mode: "search", paths: [path],
        ledgerPath: join(path, "ledger.md"), quietRounds: 1, maxRounds: 2,
    }, defaultHandler({
        Work: ({ round }) => round === 1 ? work([], [finding("x", "app.ts:1"), finding("y", "app.ts:1")], [], "grep") : undefined,
        Final: () => finals++ ? undefined : report({ complete: false, remaining: "Look again", rejected: ["y"] }),
    }));
    await assert.rejects(h.run, /PAUSED:round-limit-v2:2/);
    const result = await h.run();
    assert.equal(result.status, "complete");
    assert.deepEqual(result.findings.map((entry) => entry.id), ["x"]);
});

test("files scope matches case-insensitively on Windows", { skip: process.platform !== "win32" }, async (t) => {
    const f = await filesFixture(t, 2, { paths: ["SRC"], batchSize: 2, quietRounds: 1 });
    const h = harness(f.args, defaultHandler());
    assert.equal((await h.run()).status, "complete");
    assert.deepEqual(h.calls[0].context.batch, ["src/a.txt", "src/b.txt"]);
});

test("files behind symlinked or junctioned directories are not units", async (t) => {
    const f = await filesFixture(t, 1, { quietRounds: 1 });
    await mkdir(join(f.path, "src", "dir"));
    await writeFile(join(f.path, "src", "dir", "x.txt"), "x\n");
    git(f.path, "add", "-A");
    git(f.path, "commit", "-qm", "add dir");
    const outside = join(f.root, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "x.txt"), "outside\n");
    await rm(join(f.path, "src", "dir"), { recursive: true });
    await symlink(outside, join(f.path, "src", "dir"), "junction");
    const h = harness(f.args, defaultHandler());
    assert.equal((await h.run()).status, "complete");
    assert.deepEqual(h.calls[0].context.batch, ["src/a.txt"]);
});

test("edits kept from a blocked round are verified by the next run", async (t) => {
    const f = await filesFixture(t, 1, { batchSize: 1, quietRounds: 1 });
    const edit = async ({ context }) => {
        if (!context.batch.length) return undefined;
        await writeFile(join(f.path, "src", "a.txt"), "cleaned\n");
        return work(context.batch, [], ["src/a.txt: cleaned"]);
    };
    const first = await harness(f.args, defaultHandler({
        Work: edit,
        Verify: () => report({ status: "blocked", complete: false, remaining: "", rejected: [], questions: ["Which test command?"] }),
    })).run();
    assert.equal(first.phase, "Verify");
    const next = harness(f.args, defaultHandler({
        Work: ({ context }) => context.batch.length ? work(context.batch) : undefined,
        Verify: ({ context }) => {
            assert.deepEqual(context.preExisting[f.path], []);
            return undefined;
        },
    }));
    const result = await next.run();
    assert.equal(result.status, "complete");
    assert.equal(next.calls.filter((call) => call.role === "Verify").length, 1);
    assert.equal(git(f.path, "status", "--porcelain"), "M src/a.txt");
    assert.doesNotMatch(await readFile(f.args.ledgerPath, "utf8"), /"pending"/);
});

test("a continued ledger counts units from earlier paths in its progress", async (t) => {
    const f = await filesFixture(t, 2, { batchSize: 2, quietRounds: 1 });
    assert.equal((await harness(f.args, defaultHandler()).run()).status, "complete");
    const result = await harness({ ...f.args, paths: ["other"] }, defaultHandler()).run();
    assert.equal(result.status, "complete");
    assert.equal(result.total, 3);
    assert.match(await readFile(f.args.ledgerPath, "utf8"), /3\/3 units processed/);
});

test("a continued ledger may have no scoped files left", async (t) => {
    const f = await filesFixture(t, 1, { batchSize: 1, quietRounds: 1 });
    const first = await harness(f.args, defaultHandler({
        Work: ({ context }) => {
            if (!context.batch.length) return report({ status: "blocked", processed: [], findings: [], changes: [], strategy: "", questions: ["Scope?"] });
            git(f.path, "rm", "-q", "src/a.txt");
            return work(context.batch, [], ["removed src/a.txt"]);
        },
    })).run();
    assert.equal(first.status, "blocked");
    assert.equal((await harness(f.args, defaultHandler()).run()).status, "complete");
    await rm(f.args.ledgerPath);
    await assert.rejects(harness(f.args, defaultHandler()).run(), /No tracked or non-ignored files/);
});

test("ledger text containing the state marker still loads", async (t) => {
    const root = await temp(t);
    const path = await repo(join(root, "repo"), { "app.ts": "x\n" });
    const args = { goal: "Find <!-- exhaustive-task-state markers -->", acceptance: "All listed", mode: "search",
        paths: [path], ledgerPath: join(root, "ledger.md"), quietRounds: 1 };
    assert.equal((await harness(args, defaultHandler()).run()).status, "complete");
    assert.equal((await harness(args, defaultHandler()).run()).status, "complete");
});

test("review attempts repairing a round verification complaint can correct findings", async (t) => {
    const root = await temp(t);
    const path = await repo(join(root, "repo"), { "app.ts": "x\n" });
    inside(path);
    const h = harness({
        goal: "Find every ADO integration", acceptance: "All listed", mode: "search", paths: [path],
        ledgerPath: join(root, "ledger.md"), quietRounds: 1,
    }, defaultHandler({
        Work: async ({ round, attempt, context }) => {
            if (round === 1) return work([], [finding("sdk", "app.ts:1")], [], "grep");
            if (round !== 2) return undefined;
            await writeFile(join(path, "app.ts"), "fixed\n");
            if (attempt === 1) return work([], [], ["app.ts: fixed"], "edit");
            assert.equal(context.ledger.findings[0].details, "Details sdk");
            return work([], [{ id: "sdk", title: "Corrected", locations: ["app.ts:1"], details: "Corrected details" }], ["app.ts: fixed"], "edit");
        },
        Verify: ({ attempt }) => attempt === 1 ? report({ complete: false, remaining: "sdk is mislabeled", rejected: [] }) : undefined,
    }));
    const result = await h.run();
    assert.equal(result.status, "complete");
    assert.equal(result.findings[0].title, "Corrected");
});

test("repair attempts keep findings and changes from earlier attempts", async (t) => {
    const f = await filesFixture(t, 1, { batchSize: 1, quietRounds: 1 });
    const h = harness(f.args, defaultHandler({
        Work: async ({ context, attempt }) => {
            if (!context.batch.length) return undefined;
            await writeFile(join(f.path, "src", "a.txt"), `cleaned ${attempt}\n`);
            return attempt === 1 ? work(context.batch, [finding("hit", "src/a.txt:1"), finding("other", "src/a.txt:3")], ["src/a.txt: cleaned"])
                : work(context.batch, [finding("hit", "src/a.txt:2")], ["src/a.txt: test fixed"]);
        },
        Verify: ({ attempt, context }) => {
            if (attempt === 1) return report({ complete: false, remaining: "Fix the test", rejected: [] });
            assert.deepEqual(context.work.changes, ["src/a.txt: cleaned", "src/a.txt: test fixed"]);
            return verified();
        },
    }));
    const result = await h.run();
    assert.equal(result.status, "complete");
    assert.deepEqual(result.findings.map((entry) => [entry.id, entry.locations]), [["hit", ["src/a.txt:2"]], ["other", ["src/a.txt:3"]]]);
    assert.match(await readFile(f.args.ledgerPath, "utf8"), /cleaned[\s\S]*test fixed/);
});
