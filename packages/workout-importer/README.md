# Historical workout transformer

Private, deterministic tooling that transforms a neutral snapshot of the workout
spreadsheet into review artifacts and, after approval, a normalized Kinetix
historical-import envelope.

The transformer owns source interpretation. Kinetix receives only canonical JSON.

Real workbooks and generated artifacts belong under `.local/historical-import/`,
which is ignored by Git. Repository tests use synthetic snapshots only.

```sh
pnpm --filter @kinetix/workout-importer analyze -- \
  --snapshot ../../.local/historical-import/source/workbook-snapshot.json \
  --catalog ../../.local/historical-import/source/catalog-page-0.json \
  --output ../../.local/historical-import/artifacts/initial
```

The analysis command performs faithful structural extraction, strength-notation
parsing, exact-copy detection, date and zero-load inference, catalog mapping, and
review-report generation.

After the cleanup reports are reviewed, generate the already-normalized Kinetix envelope:

```sh
pnpm --filter @kinetix/workout-importer generate -- \
  --snapshot ../../.local/historical-import/source/workbook-snapshot.json \
  --catalog ../../.local/historical-import/source/catalog-page-0.json \
  --equipment ../../.local/historical-import/source/equipment.json \
  --movement-patterns ../../.local/historical-import/source/movement-patterns.json \
  --muscles ../../.local/historical-import/source/muscles.json \
  --namespace stoil-workout-history-v2 \
  --output ../../.local/historical-import/artifacts/final
```

The generator emits a schema-validated envelope and a compact audit. Historical source-sheet identifiers
remain stable external IDs, while known sheets receive reviewed, human-readable program and macrocycle
names inferred from their recurring workout split. It does not call Kinetix or mutate Training state. The
payload checksum covers the canonical envelope content excluding the checksum field itself, avoiding a
circular digest. `--namespace` is optional; use a new namespace for a clean re-import after a recoverable
revert, because the old namespace intentionally retains its external-ID audit history.
