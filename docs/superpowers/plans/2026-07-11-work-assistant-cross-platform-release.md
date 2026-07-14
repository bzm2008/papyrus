# Papyrus Work Assistant Cross-Platform Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Certify the work assistant and browser bridge on Windows, macOS, and Linux with platform diagnostics, automated CI, browser integration tests, package smoke builds, and real-device release evidence.

**Architecture:** Add a native doctor command and a cross-platform release checker so unsupported or degraded capabilities are explicit. Run the same TypeScript, Rust, extension, browser, and Tauri checks on all three GitHub-hosted operating systems; build unsigned smoke packages in CI and reserve production signing/notarization for protected release credentials.

**Tech Stack:** GitHub Actions, Node.js 22, Rust 1.77.2, Tauri 2, Vitest 4, Playwright Chromium, NSIS, DMG/App bundle, AppImage/DEB, cross-platform Node release scripts.

## Completion Audit (2026-07-14)

`[x]` means the files, local evidence, or locally completed commit were verified. The consolidated
local implementation commit is `14226ef`. Remote CI, downloaded smoke artifacts,
and every real-device record remain unchecked by design. The aggregate `ci:desktop` rehearsal,
WPS production build, Browser Bridge Chromium E2E, full Rust suite, doctor probes, and Windows
portable check were rerun after concurrent edits stopped and passed. The release report keeps
remote and device items `pending` until an authorized push and physical-device runs exist.

---

## Execution Prerequisite

Start after the browser completion gate passes:

```powershell
git switch 'feat/browser-assistant-bridge'
git switch -c 'feat/work-assistant-release-certification'
```

Expected: core and browser plans are fully implemented and locally green.

### Task 1: Add a native work-assistant doctor

**Files:**
- Create: `src-tauri/src/work_assistant/doctor.rs`
- Modify: `src-tauri/src/work_assistant/mod.rs`
- Modify: `src-tauri/src/work_assistant/types.rs`
- Modify: `src-tauri/src/lib.rs`
- Create: `src/services/workAssistantDoctor.ts`
- Create: `src/services/workAssistantDoctor.test.ts`
- Modify: `src/components/ComputerAssistantSettings.tsx`

- [x] **Step 1: Define diagnostic checks**

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DoctorStatus { Ok, Warning, Error }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctorCheck {
  pub id: String,
  pub label: String,
  pub status: DoctorStatus,
  pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkAssistantDoctorReport {
  pub platform: String,
  pub architecture: String,
  pub checks: Vec<DoctorCheck>,
  pub generated_at: u64,
}
```

- [x] **Step 2: Write doctor tests**

Inject filesystem, PATH lookup, port binding, and configured-root probes. Test:

- writable app data and audit path;
- readable authorized roots;
- known downloads directory or a clear warning;
- `xdg-open` availability on Linux;
- registered application paths still exist;
- loopback port can bind;
- Browser Bridge connected/stale/disconnected state;
- no check mutates user files, launches applications, or adds trash entries.

The implementation exposes `DoctorProbes` and `run_doctor_with_browser_and_probes` so filesystem
paths, PATH entries, clock values, downloads warnings, loopback failures, and opener availability
are injected without changing process-wide environment state. Browser Bridge status is checked
through a pure status helper. `cargo test --manifest-path src-tauri/Cargo.toml --locked doctor`
passes 6 tests, including the no-side-effect and Linux `xdg-open` cases; the TypeScript doctor
client suite passes 2 tests with `npm run test:unit -- src/services/workAssistantDoctor.test.ts`.

- [x] **Step 3: Implement the doctor command**

Register `work_assistant_doctor`. Return warnings for optional degradation and errors for broken core boundaries. Linux file-manager selection is a warning when only parent-directory opening is available; path-policy or audit failures are errors.

- [x] **Step 4: Add settings UI**

`ComputerAssistantSettings` renders the report as compact rows with status icons and messages. Add a refresh icon button. Do not show stack traces; preserve the structured error code for copy/debug actions.

- [x] **Step 5: Test and commit**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml doctor
npm run test:unit -- src/services/workAssistantDoctor.test.ts
npm run build
```

Expected: PASS.

```powershell
git add src-tauri/src/work_assistant/doctor.rs src-tauri/src/work_assistant/mod.rs src-tauri/src/work_assistant/types.rs src-tauri/src/lib.rs src/services/workAssistantDoctor.ts src/services/workAssistantDoctor.test.ts src/components/ComputerAssistantSettings.tsx
git commit -m "feat: add work assistant platform diagnostics"
```

### Task 2: Add cross-platform release validation scripts

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src-tauri/tauri.conf.json`
- Create: `scripts/check-work-assistant-release.mjs`
- Create: `scripts/package-browser-bridge.mjs`
- Create: `scripts/lib/release-checks.mjs`
- Create: `scripts/lib/release-checks.test.mjs`
- Modify: `.gitignore`

- [x] **Step 1: Install the ZIP dependency**

Run:

```powershell
npm install --save-dev archiver
```

Add `artifacts/browser-bridge/` to `.gitignore` while keeping the existing tracked `artifacts` behavior intact.

- [x] **Step 2: Write release-check unit tests**

Use Node's built-in test runner. Test that checks fail for:

- missing extension build output;
- manifest requesting `<all_urls>`, `cookies`, `history`, `debugger`, `clipboardRead`, `clipboardWrite`, or `nativeMessaging`;
- Tauri CSP set to `null` after browser bridge integration;
- missing work-assistant commands in Rust registration;
- missing Windows/macOS/Linux CI entries;
- missing release documentation.

Replace `csp: null` in `src-tauri/tauri.conf.json` with:

```json
"csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' asset: data: blob: https:; font-src 'self' data:; connect-src 'self' http: https:; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"
```

Custom model providers require HTTP(S) `connect-src`; Browser Bridge traffic remains in Rust and does not require WebSocket access from the main WebView.

- [x] **Step 3: Implement the release checker**

```js
const requiredCommands = [
  'work_assistant_capabilities',
  'work_assistant_list_roots',
  'work_assistant_preview',
  'work_assistant_approve',
  'work_assistant_execute',
  'work_assistant_web_extract',
  'work_assistant_browser_status',
  'work_assistant_browser_start_pairing',
  'work_assistant_browser_snapshot',
  'work_assistant_browser_execute_action',
  'work_assistant_doctor',
]
```

Read and parse JSON/manifest files with structured APIs. Read Rust registration as text only for exact command-name presence. Exit 1 with one line per failure; exit 0 with a concise summary.

- [x] **Step 4: Implement deterministic extension packaging**

`package-browser-bridge.mjs` reads `package.json.version`, deletes only `artifacts/browser-bridge`, recreates it, sorts files from `dist-browser-bridge`, and writes ``Papyrus-Browser-Bridge_${version}.zip``. It must reject symlinks and files outside the build directory.

- [x] **Step 5: Add scripts**

```json
"test:release-scripts": "node --test scripts/lib/release-checks.test.mjs",
"browser:package": "npm run browser:build && node scripts/package-browser-bridge.mjs",
"release:assistant-check:local": "node scripts/check-work-assistant-release.mjs --phase local",
"release:assistant-check": "node scripts/check-work-assistant-release.mjs --phase release"
```

Local phase checks CSP, command registration, extension output/permissions, and documentation. Release phase additionally requires the three-platform CI and package workflows. Unknown phase names exit 1.

- [x] **Step 6: Run and commit**

Run:

```powershell
npm run test:release-scripts
npm run browser:package
npm run release:assistant-check:local
```

Expected: PASS and one ZIP exists under `artifacts/browser-bridge`.

```powershell
git add package.json package-lock.json .gitignore src-tauri/tauri.conf.json scripts
git commit -m "build: add work assistant release checks"
```

### Task 3: Add real-Chromium browser action tests

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `playwright.config.ts`
- Create: `apps/browser-bridge/e2e/vite.config.ts`
- Create: `apps/browser-bridge/e2e/index.html`
- Create: `apps/browser-bridge/e2e/fixture.ts`
- Create: `apps/browser-bridge/e2e/browser-actions.spec.ts`
- Create: `apps/browser-bridge/e2e/restricted-pages.spec.ts`

- [x] **Step 1: Install Playwright**

Run:

```powershell
npm install --save-dev @playwright/test
npx playwright install chromium
```

Add:

```json
"test:browser:e2e": "playwright test --config playwright.config.ts"
```

- [x] **Step 2: Configure a cross-platform fixture server**

`playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './apps/browser-bridge/e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  use: { browserName: 'chromium', baseURL: 'http://127.0.0.1:4178', trace: 'retain-on-failure' },
  webServer: {
    command: 'vite --config apps/browser-bridge/e2e/vite.config.ts',
    url: 'http://127.0.0.1:4178',
    reuseExistingServer: !process.env.CI,
  },
})
```

The fixture imports the production snapshot, restriction, and action modules. It does not replace them with test-only implementations.

- [x] **Step 3: Test ordinary browser actions**

In real Chromium, verify snapshot element labels, text-field fill, contenteditable fill, click, stale element after DOM replacement, disabled controls, download link metadata, input/change events, and post-action snapshot.

- [x] **Step 4: Test restricted pages**

Use fixture routes for English/Chinese password reset, OTP, card payment, account security, hidden credential, and admin-console pages. Assert snapshots are restricted and no action reaches the DOM.

- [x] **Step 5: Run and commit**

Run: `npm run test:browser:e2e`

Expected: PASS in local Chromium.

```powershell
git add package.json package-lock.json playwright.config.ts apps/browser-bridge/e2e
git commit -m "test: add Chromium browser action coverage"
```

### Task 4: Add the three-platform CI matrix

**Files:**
- Create: `.github/workflows/desktop-ci.yml`
- Modify: `package.json`

- [x] **Step 1: Add an aggregate CI script**

```json
"ci:desktop": "npm run lint && npm run test:wps && npm run test:unit && npm run browser:test && npm run browser:build && npm run build && npm run test:release-scripts && npm run release:assistant-check:local"
```

- [x] **Step 2: Create the workflow matrix**

```yaml
name: Desktop CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  desktop:
    strategy:
      fail-fast: false
      matrix:
        os: [windows-latest, macos-latest, ubuntu-24.04]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - uses: dtolnay/rust-toolchain@stable
        with:
          toolchain: 1.77.2
      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: src-tauri
      - run: npm ci
      - run: npm run ci:desktop
      - run: cargo test --manifest-path src-tauri/Cargo.toml
      - run: cargo check --manifest-path src-tauri/Cargo.toml
      - run: npx playwright install chromium
      - run: npm run test:browser:e2e
```

- [x] **Step 3: Add Linux prerequisites**

Before `npm ci` on Ubuntu, install:

```bash
sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

Use a YAML `if: runner.os == 'Linux'`. Run `npx playwright install --with-deps chromium` on Linux and plain `npx playwright install chromium` on Windows/macOS.

- [x] **Step 4: Add platform-specific portable checks**

On Windows run `npm run tauri:check:portable`. On macOS/Linux run `cargo check --manifest-path src-tauri/Cargo.toml`. Keep both in addition to Rust tests.

- [x] **Step 5: Validate the workflow locally**

Run:

```powershell
npm run ci:desktop
cargo test --manifest-path src-tauri/Cargo.toml
npm run test:browser:e2e
```

Expected: PASS. Review `.github/workflows/desktop-ci.yml` with `git diff --check`. The exact three
commands and workflow review now pass locally; the commit remains a separate unchecked step.

- [x] **Step 6: Commit**

```powershell
git add .github/workflows/desktop-ci.yml package.json
git commit -m "ci: test desktop assistant on three platforms"
```

### Task 5: Add three-platform package smoke builds

**Files:**
- Modify: `package.json`
- Create: `src-tauri/ci/windows.json`
- Create: `src-tauri/ci/macos.json`
- Create: `src-tauri/ci/linux.json`
- Create: `.github/workflows/desktop-packages.yml`

- [x] **Step 1: Add CI bundle overlays**

Windows:

```json
{
  "bundle": {
    "targets": ["nsis"],
    "createUpdaterArtifacts": false
  }
}
```

macOS uses `targets: ["app", "dmg"]`; Linux uses `targets: ["deb", "appimage"]`. All overlays disable updater artifacts so smoke builds do not require the protected Tauri signing key.

- [x] **Step 2: Create a manually dispatchable package workflow**

The workflow matrix contains:

```yaml
include:
  - os: windows-latest
    config: src-tauri/ci/windows.json
    artifact: papyrus-windows-smoke
  - os: macos-latest
    config: src-tauri/ci/macos.json
    artifact: papyrus-macos-smoke
  - os: ubuntu-24.04
    config: src-tauri/ci/linux.json
    artifact: papyrus-linux-smoke
```

Run `npm ci`, all tests, `npm run browser:package`, then:

```bash
npm run tauri -- build --config ${{ matrix.config }}
```

After the workflow file exists, change `ci:desktop` to end with `npm run release:assistant-check` so subsequent pull requests enforce both CI workflow files.

- [x] **Step 3: Upload artifacts**

Upload the platform bundle directory plus `artifacts/browser-bridge/*.zip`. Set retention to seven days and name every artifact with the commit SHA. Do not publish a GitHub Release from this workflow.

- [x] **Step 4: Document signing boundaries in workflow comments**

State that production Windows signing, macOS signing/notarization, Linux repository signing, and Tauri updater signing require protected credentials and are not bypassed by smoke artifacts.

- [x] **Step 5: Validate and commit**

Run: `git diff --check`

Expected: no whitespace errors and valid JSON overlays.

```powershell
git add package.json src-tauri/ci .github/workflows/desktop-packages.yml
git commit -m "ci: add cross-platform desktop package smoke builds"
```

### Task 6: Create the real-device certification matrix

**Files:**
- Create: `docs/testing/WORK_ASSISTANT_PLATFORM_MATRIX.md`
- Create: `docs/testing/WORK_ASSISTANT_TEST_RECORD_TEMPLATE.md`
- Modify: `docs/BROWSER_BRIDGE.md`
- Modify: `README.md`

- [x] **Step 1: Define supported environments**

The matrix must require at least:

- Windows 11 current stable with Edge or Chrome;
- macOS current and previous major release with Chrome;
- Ubuntu 24.04 GNOME and one additional common Linux desktop with Chromium or Chrome.

Record OS version, architecture, Papyrus commit, package type, browser version, desktop environment, test date, tester, and outcome.

- [x] **Step 2: Define exact native workflow cases**

Include numbered cases for root authorization/removal, nested-root rejection, scan limits, search, copy, same-volume move, cross-volume file move, rename, conflict skip/rename/overwrite, trash and restore, cancellation, stale preview, executable blocking, app alias launch, URL open, reveal file, audit clear, and doctor report.

- [x] **Step 3: Define exact browser cases**

Include pairing, token expiry, current-tab authorization, navigation invalidation, public extraction, private redirect block, archive dedupe, ordinary input fill, contenteditable fill, submit approval, submit denial, send/publish approval, restricted password/OTP/payment/account pages, download, disconnect, browser restart, app restart, and extension removal.

- [x] **Step 4: Define UI and stream cases**

Include first-token streaming, two-second stall indicator, tool-row ordering, approval waiting state, cancel with partial response, late-event rejection, explicit retry, simple-task single Agent, complex-task subagent tree, right-panel auto-open, manual close persistence, and no text overlap at 1040x680, 1360x860, and a narrow mobile-like WebView width.

- [x] **Step 5: Define completion rules**

Every required case must have pass/fail evidence. A warning may document Linux file-manager selection degradation; any path escape, stale approval execution, restricted-page action, duplicate execution, crash, or data loss is a release blocker.

- [x] **Step 6: Commit**

```powershell
git add docs/testing docs/BROWSER_BRIDGE.md README.md
git commit -m "docs: add work assistant platform certification"
```

### Task 7: Run the final release rehearsal

**Files:**
- Modify: `docs/testing/WORK_ASSISTANT_PLATFORM_MATRIX.md`
- Create: `docs/PAPYRUS_WORK_ASSISTANT_TEST_REPORT.md`

- [x] **Step 1: Run the complete local verification**

```powershell
npm ci
npm run lint
npm run test:wps
npm run test:unit
npm run browser:test
npm run browser:build
npm run browser:package
npm run test:browser:e2e
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri:check:portable
npm run release:assistant-check
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 2: Trigger Desktop CI after remote-write approval**

Obtain explicit user approval to push the certification branch. Then run `git push -u origin feat/work-assistant-release-certification` and confirm Windows, macOS, and Ubuntu matrix jobs all pass. Record workflow URL and commit SHA in the test report. Without push approval, stop here and report that remote certification remains pending.

- [ ] **Step 3: Trigger package smoke builds**

Run `desktop-packages.yml` through `workflow_dispatch`. Download every artifact and verify it contains the expected platform package plus the Browser Bridge ZIP.

- [ ] **Step 4: Complete real-device records**

Execute the required matrix on real Windows, macOS, and Linux devices. Attach screenshots or logs for approvals, restricted-page blocking, stale preview blocking, doctor output, and successful package launch.

- [ ] **Step 5: Resolve every release blocker**

For a failed required case, create a focused regression test, reproduce it, fix it, rerun the affected platform and full CI, and update the record. Do not mark the platform complete with an open blocker.

- [ ] **Step 6: Commit certification evidence**

```powershell
git add docs/testing docs/PAPYRUS_WORK_ASSISTANT_TEST_REPORT.md
git commit -m "test: certify work assistant across platforms"
```

## Release Completion Gate

The feature is complete only when:

- Desktop CI is green on Windows, macOS, and Ubuntu for the same commit.
- Package smoke builds succeed for NSIS, app/DMG, DEB, and AppImage.
- Browser extension permission checks and real-Chromium tests pass on all CI operating systems.
- Real-device records pass on Windows, macOS, and Linux.
- No release blocker remains open.
- Production signing and updater artifacts are generated only through protected release credentials, never through disabled verification or unsigned artifacts presented as final releases.
