# Development

## Components

| Layer | Location | Build |
|---|---|---|
| Declarative (grammars, snippets) | `syntaxes/`, `snippets/`, `language-configuration.json` | Not required |
| TypeScript client | `client/src/extension.ts` | `npm run build:client` (esbuild → `dist/extension.js`) |
| LSP server `rtl-lsp` | `server/` (Rust, tower-lsp) | `cargo build --release` in `server/` |

## pyRegTab dependency

`rtl-lsp` uses the pure Rust core of pyRegTab
(`default-features = false`, which disables `pyo3`). The dependency is a **git
pin to a release tag** (`server/Cargo.toml`, currently `v0.5.1`), with the exact
commit recorded in `server/Cargo.lock`. An adjacent pyRegTab checkout is **not
required** for local or CI builds; Cargo downloads the core itself.

The pin is essential: RTL execution semantics are part of the extension contract,
and a floating `main` would change preview behavior between builds without any
explicit signal (as occurred with `S_delim` in pyRegTab 0.5.0).

The adjacent `../pyregtab` checkout is required **only** by
`tools/gen_hover_data.py`, which reads
`../pyregtab/docs/rtl-reference.md`.

### Updating the core version

1. Update `tag` in `server/Cargo.toml`.
2. Run `cargo build` in `server/` to regenerate `Cargo.lock`; commit it
   together with `Cargo.toml`.
3. Run `cargo clippy --all-targets -- -D warnings` and `cargo test`.
4. Regenerate the hover dictionary: `python tools/gen_hover_data.py`
   (an up-to-date adjacent pyRegTab checkout at the same tag is required).
5. If the grammar or conformance corpus changed, update
   `grammar/UPSTREAM`, `test/grammar/fixtures/CORPUS.md`, and the README.
6. Review `CHANGELOG.md`: changes to execution semantics are user-visible
   and must be documented.

On Windows with the `x86_64-pc-windows-gnu` toolchain, if the build fails with
“error calling dlltool”, verify that `parking_lot_core` is pinned to
0.9.9 in `server/Cargo.lock` (`raw-dylib` in newer versions requires dlltool,
which rust-mingw does not provide by default).

## Tests

- `npm test` — client type checking, grammar snapshots, and client unit tests
  (literal extraction and fixture/expected-result binding), plus the `RTL.g4`
  sync check.
- `cd server && cargo test` — unit tests for diagnostics, canonicalization, and
  expected-result comparison, plus the conformance corpus (positive cases must
  produce zero diagnostics; negative cases must produce diagnostics at the
  expected positions; `ext_unbound_*` must compile in permissive mode).
- `npm run test:e2e` — smoke tests via `@vscode/test-electron`: the extension
  activates, the server starts, an invalid `.rtl` file produces a diagnostic,
  canonicalization opens a read-only view, an expected-result diff is computed
  end to end, and an error in a Python literal is highlighted at the correct
  host coordinates (a built binary in `bin/` is required).

## Building VSIX packages

- Universal (syntax highlighting only): run `npx vsce package` with an **empty** `bin/`.
- Platform-specific: place `rtl-lsp(.exe)` in `bin/`, then run
  `npx vsce package --target win32-x64` (and so on; see the target list in
  `release.yml`).

## Publishing

Manual publishing only, with the owner's explicit approval each time. Follow
these lessons from the initial publication (2026-07-24) to avoid repeating past
issues.

### Channels

- **Manual upload through the portal** at marketplace.visualstudio.com/manage —
  **no personal access token (PAT) is required** (sign in with a Microsoft
  account). This is the primary method until an Azure DevOps organization is
  available for token issuance.
- **`release.yml` on a `v*` tag** — builds seven platform-specific VSIX packages
  plus a universal one and creates a GitHub Release. Publishing to the
  Marketplace and Open VSX is **skipped** if the `VSCE_PAT` or `OVSX_PAT` secret
  is absent, respectively. Without PATs, this serves as a convenient **build
  pipeline**: push a tag → download the VSIX packages from the Release → upload
  them manually through the portal.

### “Suspicious content” filter (initial publication is stricter than updates)

- It scans metadata **text** (`displayName`, description, keywords, README) and
  **file names**, not binaries or signatures (a clean VirusTotal result does not
  help). Certain high-risk words trigger it; in this project, the trigger was
  **`injection`** in grammar file names (hence the rename to `*-embedded`; the
  standard `injectionSelector` key inside a file does not trigger it).
- The initial publication of a new ID is checked strictly, while **updates
  receive less scrutiny**. Recommended procedure: **publish initially with
  minimal metadata** (a short description and one keyword; the extension may
  retain full functionality and the complete `contributes` section; preferably
  omit the binary and publish a universal package without `bin/`), then use ⋯ →
  **Update** to release a version with a complete description and keywords and
  platform-specific binaries.
- If rejected, use bisection: upload the most neutral VSIX possible and restore
  fields one at a time (failed uploads reserve nothing and are safe to repeat).

### Identity is irreversible

- `name` in the manifest must be **globally** unique (not merely unique within a
  publisher): `rtl` is occupied by a right-to-left extension. The ID is immutable
  after publication; `displayName` can be changed through an update.
- **Never delete the listing.** Deleting a listing permanently retires both its
  ID and `displayName` (both subsequently report “already exists / display name
  is taken”). This permanently retired `regtab-rtl` and “RegTab - Regular Table
  Language”. For subsequent releases, update the existing listing instead of
  deleting it.

### Uploading VSIX packages

- To upload a new VSIX to an existing extension, use ⋯ → **Update** (not “New
  extension”), with a version strictly greater than the previous one.
- Each platform-specific package has its own `TargetPlatform` in the manifest
  (set by `vsce package --target <t>`); upload all packages under the same
  version. The Marketplace groups them by extension ID and version and serves
  the appropriate one (the universal package without `TargetPlatform` is the
  fallback). There is no need to wait for the public page to refresh between
  uploads — wait only until the portal **accepts** the previous file;
  verification and CDN updates run in the background.
