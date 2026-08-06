# CFG-GOV deploy notes — sealed-at-admission cutover

**Owner-only.** These notes describe what deploying the CFG-GOV merges changes
at runtime. Deployment itself is expressly outside agent authority (CFG-GOV §7,
R1-GOV D-R1-2). Merged work covered: afi-config `46c412c`, afi-infra `9ebd080`,
afi-reactor `c112696` (slots CFG-IMMUTABILITY, CFG-PROOF-SCOPE,
CFG-ANALYTICS-STAMP).

## Behavioural changes a deploy brings

1. **Records seal at admission (D-CFG-2).** Every canonical record is written
   `finalized: true` in the `SCORED` state — "this determination is sealed".
   `supersede()` now refuses without an explicitly governed correction act;
   routine writes can never supersede.
2. **`recordHash` moves on every record written from the deploy forward.**
   `finalized` is inside the recordHash preimage by law (EV3-GOV D-EV3-4(6)),
   so post-deploy records hash differently from a pre-deploy record with the
   same content. `replayHash` does NOT move (it excludes `finalized` by
   construction) and no scored value moves. Documented as a D-CFG-6
   intentional diff in `afi-reactor/test/oracle/INTENTIONAL_DIFFS.md`.
3. **Verify-on-read + periodic re-verification.** Canonical reads recompute
   hashes before serving; a mismatch is a typed integrity fault, never a
   silent serve. Schedule `npm run verify:evidence` (afi-infra) as a cron
   under the READ-ONLY user (see `docs/atlas-read-only-custody-runbook.md`);
   exit 2 signals faults.
4. **Proof sets are composition-scoped (D-CFG-3).** A registered composition
   declaring fewer than five lanes now produces persistable records carrying
   exactly its declared proofs; `nodeOverrides.enabled: false` on a lane node
   is deliberate non-selection, not a failure. The froggy five-lane
   composition's behaviour and goldens are byte-unchanged. The fail-closed law
   is unweakened: a DECLARED lane that fails still yields no record.
5. **Analytics stamps `compositionRef` (CFG-ANALYTICS-STAMP).** New
   `scoring_context` documents carry the composition identity; existing
   documents are untouched (additive, non-canonical).

## Order of operations: PURGE BEFORE DEPLOY

Run the corpus purge (`scripts/purge-scored-corpus.mjs`, dry-run first, then
with `--confirm-purge-scored-corpus`) **before** deploying the new runtime, so:

- the store is uniformly sealed from the first record forward — no mixed
  corpus of unsealed (`finalized:false`, old preimage) and sealed records;
- the periodic re-verification never has to reason about two hash eras;
- the fabricated-input opinions are gone while `signal_outcomes` and the raw
  ingest payloads (`scoring_context.rawUss`) remain for offline re-scoring.

**Owner ruling 2026-08-06 — `scoring_context` is scrubbed, not kept whole.** The
collection held both the observations *and* the worthless scores. The script now
does a field-level scrub: every document survives, `analystScore` is set to
`null`, and a self-describing `scorePurge` marker records why. Retained:
`lenses` (the persisted enriched view that makes offline re-scoring possible),
`rawUss`, `meta`, `decayParams`, `compositionRef`, `uwrResolvedSource`.

The hourly outcomes cron is unaffected — `scripts/capture-outcomes.mjs` reads
`ctx.meta?.direction` and `ctx.meta?.symbol` (`:161`, `:176`) and never reads
`analystScore`. The scrub issues `$set` only; its document count is asserted
byte-identical before and after.

Then deploy, then apply the Atlas role separation runbook (or apply the roles
first — either order works; the purge itself needs a write-capable user).
