// NotebookLM live contract doctor.
//
// Validates Tiruno's integration against a REAL installed `notebooklm-mcp-cli`
// (binary `nlm`) + authenticated Google session — the part the mock smoke can't
// cover. Read-only by default; pass --roundtrip to also add+list+delete a
// throwaway URL source (exercises the exact parsing the ingestion pipeline uses).
//
// Usage:
//   NOTEBOOKLM_ENABLED=1 \
//   NOTEBOOKLM_NOTEBOOK_ARTICLES=<real-id-or-alias> \
//   NOTEBOOKLM_NOTEBOOK_COURSES=<real-id-or-alias> \
//   npx tsx scripts/notebooklm-doctor.ts [--roundtrip]
//
// Exit code 0 = all checks passed; 1 = one or more failed.

import { execFile } from "node:child_process";
import { notebookLMConfig } from "../src/lib/core/notebooklm/config";
import { stripAnsi, parseJson, extractField } from "../src/lib/core/notebooklm/cli";

const cfg = notebookLMConfig();
const ROUNDTRIP = process.argv.includes("--roundtrip");

interface Run {
  ok: boolean;
  raw: string;
  json: unknown;
  error?: string;
}

/** Run the configured `nlm` binary with raw args (adds --profile when set). */
function nlm(args: string[], timeoutMs = cfg.timeoutMs): Promise<Run> {
  const [bin, ...base] = cfg.baseCmd;
  const profile = cfg.profile ? ["--profile", cfg.profile] : [];
  return new Promise<Run>((resolve) => {
    execFile(bin, [...base, ...args, ...profile], { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      const raw = stripAnsi(String(stdout || "")).trim();
      const json = parseJson(raw);
      if (err) resolve({ ok: false, raw, json, error: stripAnsi(String(stderr || "")).trim() || err.message });
      else resolve({ ok: true, raw, json });
    });
  });
}

let failures = 0;
const pass = (m: string) => console.log(`  \u2713 ${m}`);
const fail = (m: string, hint?: string) => {
  failures++;
  console.log(`  \u2717 ${m}`);
  if (hint) console.log(`     \u2192 ${hint}`);
};

async function main(): Promise<void> {
  console.log("NotebookLM doctor — validating the real `nlm` contract\n");
  console.log(`  binary:    ${cfg.baseCmd.join(" ")}`);
  console.log(`  profile:   ${cfg.profile ?? "(default)"}`);
  console.log(`  notebooks: articles=${cfg.notebooks.articles}  courses=${cfg.notebooks.courses}`);
  console.log("");

  if (cfg.mock) {
    console.log("NOTEBOOKLM_MOCK=1 is set — the doctor validates the REAL CLI. Unset it and retry.");
    process.exit(1);
  }
  if (!cfg.enabled) {
    console.log("NotebookLM is disabled — set NOTEBOOKLM_ENABLED=1 (and authenticate `nlm login`).");
    process.exit(1);
  }

  // 1) Binary present + version.
  console.log("1) CLI binary");
  const ver = await nlm(["--version"], 15000);
  if (ver.ok) pass(`nlm reachable (${ver.raw.split("\n")[0] || "ok"})`);
  else fail("cannot run `nlm --version`", "install it: `uv tool install notebooklm-mcp-cli` (or pipx), then ensure it's on PATH");

  // 2) Authenticated session — `notebook list` requires login.
  console.log("2) Authentication + notebooks");
  const nbList = await nlm(["notebook", "list", "--json"], 60000);
  let notebooks: Array<Record<string, unknown>> = [];
  if (nbList.ok && Array.isArray(nbList.json)) {
    notebooks = nbList.json as Array<Record<string, unknown>>;
    pass(`authenticated — ${notebooks.length} notebook(s) visible`);
  } else {
    fail("`nlm notebook list --json` failed", "authenticate first: `nlm login` (opens a Google session)");
  }

  // 3) Configured notebooks resolve (by id, or reachable via `source list`).
  for (const [kind, id] of Object.entries(cfg.notebooks)) {
    const known = notebooks.some((n) => n.id === id || n.title === id || n.name === id);
    const probe = await nlm(["source", "list", id, "--json"], 60000);
    if (known || probe.ok) pass(`${kind} notebook "${id}" resolves (${Array.isArray(probe.json) ? probe.json.length : "?"} sources)`);
    else fail(`${kind} notebook "${id}" not found / not listable`, `set NOTEBOOKLM_NOTEBOOK_${kind.toUpperCase()} to a real notebook id, or create an alias: \`nlm alias set ${id} <notebook-id>\``);
  }

  // 4) Optional mutating round-trip: add → list → delete a throwaway URL source.
  if (ROUNDTRIP && failures === 0) {
    console.log("3) Round-trip (add \u2192 list \u2192 delete)");
    const nb = cfg.notebooks.articles;
    const url = "https://example.com/";
    const add = await nlm(["source", "add", nb, "--url", url], 120000);
    const sid = extractField(add.raw, /Source ID:\s*(\S+)/i);
    if (add.ok && sid) {
      pass(`source add parsed Source ID: ${sid}`);
      const list = await nlm(["source", "list", nb, "--json"], 60000);
      const present = Array.isArray(list.json) && (list.json as Array<Record<string, unknown>>).some((s) => String(s.id ?? s.source_id) === sid);
      present ? pass("new source appears in `source list --json`") : fail("added source not found in list output");
      const del = await nlm(["source", "delete", sid, "--confirm"], 60000);
      del.ok ? pass("source delete --confirm succeeded (cleaned up)") : fail("source delete failed", `remove it manually: \`nlm source delete ${sid} --confirm\``);
    } else {
      fail("`source add --url` did not return a parseable Source ID", add.error || add.raw.slice(0, 200));
    }
  } else if (ROUNDTRIP) {
    console.log("3) Round-trip skipped (fix the failures above first).");
  } else {
    console.log("3) Round-trip skipped (pass --roundtrip to add/list/delete a throwaway source).");
  }

  console.log("");
  if (failures === 0) {
    console.log("All checks passed — the real `nlm` contract matches Tiruno's integration.");
    process.exit(0);
  }
  console.log(`${failures} check(s) failed — see hints above.`);
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
