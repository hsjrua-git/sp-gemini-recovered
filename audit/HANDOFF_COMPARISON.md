# Handoff comparison and consolidation notes

Compared the earlier assistant handoff with the user-supplied
`audit/HANDOFF.md`. Checked the report, review inventory, runner/helpers,
reproduction outputs and exit metadata, relevant source, git/worktree state,
and isolated-service availability using read-only operations on 2026-10-29.

**Use `audit/HANDOFF_CONSOLIDATED.md` as the continuation prompt.** The supplied
file is preserved unchanged. No implementation, service restart, migration,
test rerun, review-ledger update, commit, or push occurred during consolidation.

## What each version contributed

- The earlier handoff accurately separated incomplete Stage 1, source-only
  Android evidence, mocked-adapter probes, historical passes, and service
  recovery. It retained two completed-but-unrecorded reads and warned about
  baseline overwrites. Its recovery instructions were less immediately runnable.
- The supplied handoff added useful source locations, a concrete PostgreSQL
  startup command, dependency-payload locations, a candidate quantity (`1.005`),
  and a clear staged outline. It also contained several overclaims and unsafe
  or unagreed continuation instructions.

## Corrections made

1. **Executed evidence:** the supplied file says every A01–A11 reproduction ran.
   There are ten executed defect checks, each exit 1; A06 was established by
   reading Android configuration/tests and has no executed reproduction.
2. **Verification standard:** “nothing VERIFIED without a run” contradicts
   source-verifiable facts. The consolidated prompt distinguishes executed
   behavior, source-established facts, and untested hypotheses.
3. **Git authorization:** committing audit artifacts on `main` was proposed by
   the supplied handoff, not agreed by the user. The established requirement is
   Stage 2 on `audit-fixes`, with named-path local commits and no publishing.
4. **Evidence preservation:** repeating runner phase/name overwrites both
   output and metadata. The consolidated prompt requires unique rerun names and
   retains the original failing baseline.
5. **Runtime safety:** startup uses the existing isolated cluster only after
   process/lock checks. Do not reseed or truncate existing API logs. Latest
   observations were PostgreSQL no-response and API connection refusal, not a
   proof that all listeners elsewhere were inventoried.
6. **Coverage preservation:** `inventory.mjs` resets review state if rerun. This
   warning is now explicit. The two unrecorded full reads remain highlighted;
   neither was silently added to the ledger during handoff preparation.
7. **Restoration safety:** use a separate disposable database in the isolated
   cluster, not the database holding audit evidence. The generic runner ignores
   stdin, so it cannot directly answer `restore.sh`'s confirmation prompt.
8. **Unproved extensions:** role/user race, zero-total void, refund divergence,
   and quantity validation still need their own execution. The useful `1.005`
   candidate is retained without presenting an unrun API probe as verified.
9. **Scoped fixes:** A05 should normalize the adapter's absent balance, not
   silently redesign the HTTP contract. A03 remains duplicate-submit hardening;
   A09 protocol redesign and other ASK work remain untouched.
10. **Stale/request claims:** neither an unsupported “live check” request nor the
    baseline commit's remediation title is treated as proof of current scope or
    completion. Preparation added documents only.

## Confirmed state

- Path `/home/hsjrua/Documents/sp-gemini-1`; only listed worktree; branch `main`.
- HEAD `a4d81f07d2e016341310dc8df79b9c878cf32ada`.
- Tracked/staged diffs empty; only `audit/` and `partly-schema/` untracked.
- No `audit-fixes` branch or `audit/FIX_LOG.md`.
- Inventory: 631 initial files, 470 tracked; 197 files / 29,229 lines fully read.
- `pg_isready` on 55439: exit 2/no response; port-3300 health request: exit
  7/connection refusal. No services were restarted during preparation.
- Historical passing suite totals and all ten failing reproduction outputs were
  checked against saved artifacts, not rerun or inferred from names.

The supplied schema line count is unnecessary to continuation and was omitted:
inventory uses newline-splitting counts, which include terminal empty lines and
can differ from `wc -l`. The three user files and their unreviewed status matter
more than a potentially ambiguous aggregate.
