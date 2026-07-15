# Papyrus Browser Assistant Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safe web extraction, project archiving, and a user-authorized Chromium bridge that can inspect one active tab, fill ordinary drafts, click controlled elements, manage downloads, and require explicit approval for submissions.

**Architecture:** Public web extraction runs in Rust with redirect-by-redirect SSRF validation. Interactive browser work uses a Manifest V3 extension connected to a loopback-only Tauri WebSocket server; the extension receives access only after the user connects the current tab, while Rust owns pairing, tab/origin binding, snapshot revisions, risk classification, approvals, action forwarding, and audit.

**Tech Stack:** Tauri 2, Rust 2021, React 19, TypeScript 6, Chromium Manifest V3, Vite 8, Vitest 4, `tokio`, bounded `tungstenite`, direct URL/DNS policy helpers, existing `reqwest` and `scraper`, and a deterministic JavaScript extension builder.

## Implementation Audit (2026-07-15)

`[x]` below means the implementation, test, or locally completed commit step is backed by current
evidence. The latest hardening commit is `d73b0d0` (`fix: harden entitlement sync and assistant cancellation`).
The complete canonical href is now bound to the native preview through an opaque fingerprint, and
execution re-checks the current element target plus public-URL/DNS policy. Chromium regression
coverage includes query-target mutation returning `stale`; the native Browser Bridge suite is now
36 tests, including an injected resolver/fetcher redirect fixture, token replay, wrong-tab,
cross-origin, oversized-message, credential-link, executable-download, cancelled-run and pending
request wake-up cases. Native browser action completion/failure records append a redacted entry
to the existing audit JSONL; browser or extension restart still requires explicit re-pairing
because the one-time token is consumed by design. Approved actions use a native gate for the
validated send transition, while cancellation wakes pending responses without waiting for the
12-second response deadline.

Two deliberate implementation decisions are recorded here. The loopback server keeps the bounded
blocking `tungstenite` 0.27 thread model instead of introducing a second async WebSocket runtime;
the security contract is covered by the same origin, pairing, heartbeat, and 1 MiB limits. The
extension is a plain MV3 JavaScript bundle copied by the deterministic builder, so CRXJS and
`@types/chrome` are not runtime dependencies. Chromium owns final DNS resolution for a clicked
link; native preview and execution perform public-URL checks twice, but cannot pin the browser's
socket without broad browser permissions or an unsafe proxy. The legacy direct Tauri pairing
command now fails closed; only the loopback WebSocket handshake can establish a browser session.

---

## Execution Prerequisite

Start from the completed core branch after its completion gate passes:

```powershell
git switch 'feat/work-assistant-core'
git switch -c 'feat/browser-assistant-bridge'
```

Expected: core unit tests, Rust tests, build, and native file workflow are already green.

### Task 1: Add a redirect-safe public web extractor

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Create: `src-tauri/src/work_assistant/url_policy.rs`
- Create: `src-tauri/src/work_assistant/web_extract.rs`
- Modify: `src-tauri/src/work_assistant/mod.rs`
- Create: `src/services/webExtractService.ts`
- Create: `src/services/webExtractService.test.ts`

- [x] **Step 1: Add URL-policy tests**

Rust tests must reject:

```rust
for url in [
  "http://localhost:3000",
  "http://127.0.0.1",
  "http://[::1]",
  "http://169.254.169.254/latest/meta-data",
  "http://10.0.0.1",
  "http://172.16.0.1",
  "http://192.168.1.1",
  "file:///etc/passwd",
  "javascript:alert(1)",
] {
  assert!(validate_public_url(url).is_err(), "accepted {url}");
}
assert!(validate_public_url("https://example.com/article").is_ok());
```

Use an injected resolver/fetcher fixture where `public.example.test` resolves to a public test address and returns a 302 to `127.0.0.1`; extraction must reject the redirect before invoking the fetcher for the second request. Do not weaken production private-address checks to make a local fixture reachable. The fixture now lives in the Browser Bridge Rust test module and asserts the fetch call list.

- [x] **Step 2: Add compatible dependencies**

Add:

```toml
url = "2"
ipnet = "2"
tokio = { version = "1", features = ["net", "sync", "time", "rt-multi-thread"] }
tokio-util = { version = "0.7", features = ["rt"] }
```

Extend `reqwest` features to:

```toml
reqwest = { version = "0.12", default-features = false, features = ["rustls-tls", "gzip", "brotli", "deflate", "json", "stream"] }
```

- [x] **Step 3: Implement DNS and redirect validation**

```rust
pub async fn resolve_public(url: &Url) -> Result<Vec<IpAddr>, WorkAssistantError> {
  let host = url.host_str().ok_or_else(|| WorkAssistantError::blocked("URL has no host"))?;
  let port = url.port_or_known_default().ok_or_else(|| WorkAssistantError::blocked("URL has no port"))?;
  let addresses = tokio::net::lookup_host((host, port)).await.map_err(network_error)?;
  let ips: Vec<IpAddr> = addresses.map(|address| address.ip()).collect();
  if ips.is_empty() || ips.iter().any(|ip| !is_public_ip(*ip)) {
    return Err(WorkAssistantError::blocked("URL resolves to a non-public address"));
  }
  Ok(ips)
}
```

Build the client with redirects disabled. Follow at most five redirects manually, validating scheme, host, DNS results, and destination on every hop. Pin each validated hostname to the validated socket addresses with `ClientBuilder::resolve_to_addrs` for that hop so a second DNS lookup cannot rebind the request to a private address.

- [x] **Step 4: Implement bounded extraction**

Limits:

```rust
const MAX_REDIRECTS: usize = 5;
const MAX_RESPONSE_BYTES: usize = 4 * 1024 * 1024;
const MAX_EXTRACTED_CHARS: usize = 60_000;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
```

Parse title, canonical URL, language, main text, and a 500-character excerpt. Remove `script`, `style`, `nav`, `footer`, `noscript`, form controls, and hidden elements before text normalization. Return `unsupported_content_type` unless content type is HTML or plain text.

- [x] **Step 5: Add the typed frontend wrapper and tests**

```ts
export type WebExtractResult = {
  title: string
  url: string
  canonicalUrl?: string
  language?: string
  excerpt: string
  text: string
}

export async function extractPublicWebPage(url: string, runId: string, signal?: AbortSignal) {
  const onAbort = () => void cancelWorkAssistantRun(runId)
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    return await invoke<WebExtractResult>('work_assistant_web_extract', { url, runId })
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}
```

The wrapper must map native `blocked`, `network`, `timeout`, `unsupported_content_type`, and `response_too_large` errors to user-facing recoverable metadata.

In Rust, create one `CancellationToken` per active run and wrap DNS resolution, request send, and body reads in `tokio::select!`; cancellation returns `user_cancelled` without waiting for the request timeout.

- [x] **Step 6: Run and commit**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml url_policy web_extract
npm run test:unit -- src/services/webExtractService.test.ts
```

Expected: PASS.

```powershell
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/work_assistant src/services/webExtractService.ts src/services/webExtractService.test.ts
git commit -m "feat: add safe public web extraction"
```

### Task 2: Add reversible web archiving to Papyrus projects

**Files:**
- Create: `src/services/webArchiveService.ts`
- Create: `src/services/webArchiveService.test.ts`
- Modify: `src/services/workAssistantRegistry.ts`
- Modify: `src/services/workAssistantRuntime.ts`
- Modify: `src/stores/useAppStore.ts:155-190`
- Modify: `src/stores/useAppStore.ts:1010-1070`

- [x] **Step 1: Extend tool manifests with an executor**

```ts
export type AssistantToolExecutor = 'native' | 'project' | 'browser_bridge'

export type AssistantToolManifest = {
  name: string
  toolset: 'workspace' | 'desktop' | 'browser' | 'project'
  description: string
  defaultRisk: AssistantRiskLevel
  supportedPlatforms: DesktopPlatform[]
  previewRequired: boolean
  reversible: boolean
  inputSchema: Record<string, unknown>
  executor: AssistantToolExecutor
}
```

Extend the core `manifest` helper with a final executor argument defaulting to `native`, set every existing core tool to `native`, then register:

```ts
manifest(
  'web_extract',
  'browser',
  'Extract a public web page',
  'read',
  false,
  true,
  objectSchema({ url: stringField() }, ['url']),
  'native',
)

manifest(
  'web_archive',
  'project',
  'Archive extracted web content into the active project',
  'reversible',
  true,
  true,
  objectSchema({ extractId: stringField(), resourceName: stringField() }, ['extractId']),
  'project',
)
```

- [x] **Step 2: Write archive tests**

Test that an archived page becomes one `ImportedResource` with type `html`, source URL, extracted title, token count, and deduplication key. Re-archiving the same canonical URL updates the existing resource rather than creating a duplicate.

- [x] **Step 3: Implement project archive preview and apply**

```ts
export type WebArchivePreview = AssistantToolPreview & {
  resourceName: string
  canonicalUrl: string
  characterCount: number
  replacingResourceId?: string
}

function toImportedWebResource(
  result: WebExtractResult,
  preview: WebArchivePreview,
): ImportedResource {
  return {
    id: preview.replacingResourceId ?? crypto.randomUUID(),
    name: preview.resourceName || result.title || new URL(result.url).hostname,
    path: preview.canonicalUrl,
    type: 'html',
    content: result.text,
    tokenCount: estimateTokens(result.text),
    includedInContext: true,
    importedAt: Date.now(),
  }
}

export function applyWebArchive(result: WebExtractResult, preview: WebArchivePreview) {
  const store = useAppStore.getState()
  const resource = toImportedWebResource(result, preview)
  if (preview.replacingResourceId) {
    store.updateResource(preview.replacingResourceId, resource)
  } else {
    store.addResources([resource])
  }
  return { ok: true, summary: `已归档《${resource.name}》`, data: { resourceId: resource.id } }
}
```

Archive content only after approval. Do not write the page into long-term memory automatically.

- [x] **Step 4: Route project executors**

In `workAssistantRuntime`, dispatch by manifest executor. Native approvals remain minted by Rust. Project approvals use the same inline UI but are bound to a locally generated preview revision based on canonical URL plus text hash.

- [x] **Step 5: Test and commit**

Run: `npm run test:unit -- src/services/webArchiveService.test.ts src/services/workAssistantRuntime.test.ts`

Expected: PASS.

```powershell
git add src/services/webArchiveService.ts src/services/webArchiveService.test.ts src/services/workAssistantRegistry.ts src/services/workAssistantRuntime.ts src/stores/useAppStore.ts
git commit -m "feat: archive web research into projects"
```

### Task 3: Define the Browser Bridge protocol and security state

**Files:**
- Create: `src/services/browserBridgeProtocol.ts`
- Create: `src/services/browserBridgeProtocol.test.ts`
- Create: `src-tauri/src/work_assistant/browser_bridge/types.rs`
- Create: `src-tauri/src/work_assistant/browser_bridge/state.rs`
- Create: `src-tauri/src/work_assistant/browser_bridge/mod.rs`
- Modify: `src-tauri/src/work_assistant/mod.rs`

- [x] **Step 1: Define matching TypeScript and Rust messages**

TypeScript:

```ts
export type BrowserBridgeMessage =
  | { type: 'pair'; token: string; extensionId: string; nonce: string }
  | { type: 'pair.accepted'; sessionId: string; heartbeatMs: number }
  | { type: 'tab.connect'; requestId: string; tabId: number; url: string; title: string }
  | { type: 'tab.connected'; requestId: string; sessionId: string; pageRevision: string }
  | { type: 'snapshot.request'; requestId: string; tabId: number }
  | { type: 'snapshot.result'; requestId: string; snapshot: BrowserPageSnapshot }
  | { type: 'action.request'; requestId: string; action: BrowserAction }
  | { type: 'action.result'; requestId: string; result: BrowserActionResult }
  | { type: 'heartbeat'; at: number }
  | { type: 'disconnect'; reason: string }
```

Rust uses `#[serde(tag = "type")]` and an explicit rename on every enum variant:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all_fields = "camelCase")]
pub enum BrowserBridgeMessage {
  #[serde(rename = "pair")]
  Pair { token: String, extension_id: String, nonce: String },
  #[serde(rename = "pair.accepted")]
  PairAccepted { session_id: String, heartbeat_ms: u64 },
  #[serde(rename = "tab.connect")]
  TabConnect { request_id: String, tab_id: i64, url: String, title: String },
  #[serde(rename = "tab.connected")]
  TabConnected { request_id: String, session_id: String, page_revision: String },
  #[serde(rename = "snapshot.request")]
  SnapshotRequest { request_id: String, tab_id: i64 },
  #[serde(rename = "snapshot.result")]
  SnapshotResult { request_id: String, snapshot: BrowserPageSnapshot },
  #[serde(rename = "action.request")]
  ActionRequest { request_id: String, action: BrowserAction },
  #[serde(rename = "action.result")]
  ActionResult { request_id: String, result: BrowserActionResult },
  #[serde(rename = "heartbeat")]
  Heartbeat { at: u64 },
  #[serde(rename = "disconnect")]
  Disconnect { reason: String },
}
```

Add round-trip fixtures shared as JSON under `apps/browser-bridge/test-fixtures/protocol/` in Task 5.

- [x] **Step 2: Define snapshot and element constraints**

```ts
export type BrowserElementSnapshot = {
  id: string
  role: string
  name: string
  tagName: string
  inputType?: string
  href?: string
  hasValue?: boolean
  disabled: boolean
}

export type BrowserPageSnapshot = {
  tabId: number
  url: string
  origin: string
  title: string
  pageRevision: string
  snapshotId: string
  restricted: boolean
  restrictionReason?: string
  textSummary: string
  elements: BrowserElementSnapshot[]
}
```

Mirror both structures in Rust with `Serialize`, `Deserialize`, and `#[serde(rename_all = "camelCase")]`. Do not include input values, cookies, storage, browser history, hidden elements, password fields, or elements from other tabs.

- [x] **Step 3: Implement native bridge state**

Track:

```rust
pub struct PairingSession {
  pub token_hash: [u8; 32],
  pub nonce: String,
  pub expires_at: u64,
  pub consumed: bool,
}

pub struct BridgeConnection {
  pub session_id: String,
  pub extension_id: String,
  pub connected_at: u64,
  pub last_heartbeat_at: u64,
}

pub struct AuthorizedTab {
  pub tab_id: i64,
  pub origin: String,
  pub page_revision: String,
  pub title: String,
}

pub struct BrowserBridgeState {
  pub listener_port: Option<u16>,
  pub pairing: Option<PairingSession>,
  pub connection: Option<BridgeConnection>,
  pub authorized_tab: Option<AuthorizedTab>,
  pub latest_snapshot: Option<BrowserPageSnapshot>,
  pub pending_requests: HashMap<String, oneshot::Sender<BrowserBridgeMessage>>,
}
```

Pairing tokens are 32 random bytes encoded with URL-safe base64, expire after five minutes, and are consumed once. The authorized tab binds extension ID, tab ID, origin, page revision, and last heartbeat.

- [x] **Step 4: Test state transitions**

Test token expiry, token reuse, wrong extension ID, tab switch, origin change, heartbeat timeout, snapshot replacement, and disconnect cleanup.

- [x] **Step 5: Run and commit**

Run:

```powershell
npm run test:unit -- src/services/browserBridgeProtocol.test.ts
cargo test --manifest-path src-tauri/Cargo.toml browser_bridge
```

Expected: PASS.

```powershell
git add src/services/browserBridgeProtocol.ts src/services/browserBridgeProtocol.test.ts src-tauri/src/work_assistant/browser_bridge src-tauri/src/work_assistant/mod.rs
git commit -m "feat: define secure browser bridge protocol"
```

### Task 4: Run a loopback-only WebSocket bridge in Tauri

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Create: `src-tauri/src/work_assistant/browser_bridge/server.rs`
- Create: `src-tauri/src/work_assistant/browser_bridge/commands.rs`
- Modify: `src-tauri/src/work_assistant/browser_bridge/mod.rs`
- Modify: `src-tauri/src/lib.rs:10-35`
- Create: `src/services/browserBridgeClient.ts`
- Create: `src/services/browserBridgeClient.test.ts`

- [x] **Step 1: Add WebSocket dependencies (bounded synchronous implementation)**

```toml
tungstenite = "0.27"
tokio = { version = "1", features = ["macros", "net", "time"] }
```

The implementation decision above intentionally uses the already-vetted blocking `tungstenite`
server rather than adding an unused async stack; the native server still binds only to loopback.

- [x] **Step 2: Write server security tests**

Test that the server binds to `127.0.0.1:0`, never `0.0.0.0`, rejects connections without a pairing message, rejects expired/wrong tokens, verifies an origin such as `chrome-extension://abcdefghijklmnopabcdefghijklmnop` matches the paired extension ID, allows one active extension connection, enforces a 1 MiB message limit, and disconnects after three missed heartbeats.

- [x] **Step 3: Implement server lifecycle**

```rust
let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await?;
let port = listener.local_addr()?.port();
```

Start the listener on demand when the user opens Browser Bridge settings. Stop it when the app exits or the user disables the bridge. Do not log pairing tokens or full page payloads.

- [x] **Step 4: Expose commands**

Register:

```rust
work_assistant_browser_status,
work_assistant_browser_start_pairing,
work_assistant_browser_disconnect,
work_assistant_browser_snapshot,
work_assistant_browser_preview_action,
work_assistant_browser_execute_action,
```

`start_pairing` returns `{ port, token, expiresAt }`. `execute_action` requires a native approval grant for every non-read action.

- [x] **Step 5: Implement the frontend client**

`browserBridgeClient.ts` maps native status to `disabled`, `listening`, `pairing`, `connected`, `stale`, or `error`; it exposes typed start-pairing, disconnect, snapshot, preview, and execute calls.

- [x] **Step 6: Test and commit**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml browser_bridge::server
npm run test:unit -- src/services/browserBridgeClient.test.ts
```

Expected: PASS.

```powershell
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs src-tauri/src/work_assistant/browser_bridge src/services/browserBridgeClient.ts src/services/browserBridgeClient.test.ts
git commit -m "feat: add loopback browser bridge server"
```

### Task 5: Scaffold the Chromium Manifest V3 extension

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `apps/browser-bridge/manifest.config.ts`
- Create: `apps/browser-bridge/vite.config.ts`
- Create: `apps/browser-bridge/vitest.config.ts`
- Create: `apps/browser-bridge/tsconfig.json`
- Create: `apps/browser-bridge/popup.html`
- Create: `apps/browser-bridge/src/background.ts`
- Create: `apps/browser-bridge/src/content.ts`
- Create: `apps/browser-bridge/src/popup.tsx`
- Create: `apps/browser-bridge/src/popup.css`
- Create: `apps/browser-bridge/src/chrome.d.ts`
- Create: `apps/browser-bridge/src/protocol.ts`
- Create: `apps/browser-bridge/src/background.test.ts`
- Create: `apps/browser-bridge/test-fixtures/protocol/*.json`

- [x] **Step 1: Define extension build dependencies (deterministic JavaScript alternative)**

The production bundle uses a deterministic JavaScript copy builder rather than a TypeScript CRXJS
pipeline. The Vitest configuration and Browser Bridge tests are present; the listed CRXJS packages
are intentionally not installed because no generated extension runtime depends on them.

The production bundle has no external extension build dependency. `browser:build` runs
`scripts/build-browser-bridge.mjs`, which copies only the five audited MV3 runtime files into
`dist-browser-bridge`; `browser:test` uses the checked-in Vitest configuration.

Run:

```powershell
npm install --save-dev @crxjs/vite-plugin @types/chrome
```

Add scripts:

```json
"browser:dev": "vite --config apps/browser-bridge/vite.config.ts",
"browser:build": "vite build --config apps/browser-bridge/vite.config.ts",
"browser:test": "vitest run --config apps/browser-bridge/vitest.config.ts"
```

Create `apps/browser-bridge/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['apps/browser-bridge/src/**/*.test.ts'],
    restoreMocks: true,
  },
})
```

- [x] **Step 2: Create the minimal manifest**

```ts
export default {
  manifest_version: 3,
  name: 'Papyrus Browser Bridge',
  version: '0.1.0',
  action: { default_popup: 'popup.html' },
  background: { service_worker: 'src/background.ts', type: 'module' },
  permissions: ['activeTab', 'scripting', 'storage', 'tabs'],
  host_permissions: ['http://127.0.0.1/*'],
} satisfies chrome.runtime.ManifestV3
```

Do not request `<all_urls>`, browsing history, cookies, downloads history, clipboard, native messaging, or debugger permissions.

- [x] **Step 3: Implement user-gesture connection**

The popup accepts `{ port, token }` copied from Papyrus. On `连接当前标签页`, it:

1. Queries the active tab in the current window.
2. Rejects `chrome://`, `edge://`, extension pages, file URLs, and missing URLs.
3. Injects `content.ts` through `chrome.scripting.executeScript`.
4. Opens `ws://127.0.0.1:<port>` from the service worker.
5. Sends `pair`, then `tab.connect`.
6. Stores token and port only in `chrome.storage.session`.

- [x] **Step 4: Add extension tests**

Mock `chrome.tabs`, `chrome.scripting`, and `chrome.storage.session`. Test missing active tab, restricted scheme, failed injection, wrong pairing response, successful connection, tab close, and service-worker restart recovery.

- [x] **Step 5: Build and commit**

Run:

```powershell
npm run browser:test
npm run browser:build
```

Expected: PASS and extension output appears in `dist-browser-bridge/`.

```powershell
git add package.json package-lock.json apps/browser-bridge
git commit -m "feat: scaffold Papyrus browser bridge extension"
```

### Task 6: Implement safe page snapshots and restricted-page detection

**Files:**
- Create: `apps/browser-bridge/src/snapshot.ts`
- Create: `apps/browser-bridge/src/snapshot.test.ts`
- Create: `apps/browser-bridge/src/restrictions.ts`
- Create: `apps/browser-bridge/src/restrictions.test.ts`
- Modify: `apps/browser-bridge/src/content.ts`
- Modify: `src-tauri/src/work_assistant/browser_bridge/state.rs`

- [x] **Step 1: Define hard restrictions**

Reject pages when any condition matches:

- URL scheme is not HTTP(S).
- Host is localhost, loopback, link-local, private IP, or an internal single-label hostname.
- Path/title/form labels indicate password reset, two-factor authentication, payment, checkout, card, banking, account security, browser extension management, router/admin console, or cloud metadata.
- The actionable form contains password, one-time-code, credit-card, or hidden credential fields.

Use explicit Chinese and English keyword lists in `restrictions.ts`; tests must cover both languages.

- [x] **Step 2: Build bounded accessible snapshots**

Collect at most 200 visible interactive elements and 12,000 characters of visible page text. Element records include only role, accessible name, tag, safe input type, href origin/path, disabled state, and `hasValue` boolean.

```ts
const snapshotId = crypto.randomUUID()
const elementMap = new Map<string, { element: Element; fingerprint: string }>()
```

Store the map only in the content script. The app receives IDs, never DOM paths or values.

- [x] **Step 3: Enforce stale element checks**

Before any action, require matching snapshot ID, `element.isConnected`, unchanged fingerprint, unchanged origin, and a non-restricted page. Return `stale_snapshot` instead of searching for a similar element.

- [x] **Step 4: Test and commit**

Run: `npm run browser:test`

Expected: PASS for visible-element filtering, password exclusion, hidden field exclusion, size caps, restricted pages, navigation invalidation, and stale elements.

```powershell
git add apps/browser-bridge/src/snapshot.ts apps/browser-bridge/src/snapshot.test.ts apps/browser-bridge/src/restrictions.ts apps/browser-bridge/src/restrictions.test.ts apps/browser-bridge/src/content.ts src-tauri/src/work_assistant/browser_bridge/state.rs
git commit -m "feat: add restricted browser page snapshots"
```

### Task 7: Add controlled fill, click, download, and submit actions

**Files:**
- Create: `apps/browser-bridge/src/actions.ts`
- Create: `apps/browser-bridge/src/actions.test.ts`
- Create: `src-tauri/src/work_assistant/browser_bridge/policy.rs`
- Create: `src-tauri/src/work_assistant/browser_bridge/actions.rs`
- Modify: `src-tauri/src/work_assistant/browser_bridge/commands.rs`
- Modify: `src/services/workAssistantPolicy.ts`
- Modify: `src/services/workAssistantRuntime.ts`

- [x] **Step 1: Write browser-risk tests**

Test exact outcomes:

```rust
assert_eq!(risk_for("button", "下一页", None), Risk::Reversible);
assert_eq!(risk_for("button", "发送", None), Risk::High);
assert_eq!(risk_for("button", "Publish", None), Risk::High);
assert_eq!(risk_for("button", "删除账号", None), Risk::Blocked);
assert_eq!(risk_for("input", "密码", Some("password")), Risk::Blocked);
```

Unknown button semantics must return `High`.

- [x] **Step 2: Implement extension actions**

Supported actions:

```ts
type BrowserAction =
  | { kind: 'fill'; snapshotId: string; elementId: string; text: string }
  | { kind: 'click'; snapshotId: string; elementId: string }
  | { kind: 'download'; snapshotId: string; elementId: string }
  | { kind: 'submit'; snapshotId: string; elementId: string }

type BrowserActionResult = {
  ok: boolean
  action: BrowserAction['kind']
  pageRevision: string
  snapshot?: BrowserPageSnapshot
  download?: { fileName: string; url: string }
  errorCode?: 'blocked' | 'stale_snapshot' | 'element_missing' | 'action_failed'
  message: string
}
```

Define matching Rust `BrowserAction` and `BrowserActionResult` enums/structs in `browser_bridge/types.rs` using camelCase fields and snake_case action kinds.

`fill` supports ordinary text, search, email, URL, telephone, textarea, and contenteditable fields. It rejects password, number-card patterns, one-time-code, file upload, date payment fields, disabled, readonly, and hidden controls. Dispatch `input` and `change` events after setting text.

- [x] **Step 3: Generate native previews**

Every action preview includes origin, page title, element role/name, visible field labels, action text, risk, snapshot revision, and expiry. Downloads are reversible but allow only `once` or `deny`. Submit/send/publish are high-risk and allow only `once` or `deny`.

- [x] **Step 4: Execute only approved actions**

Rust verifies pairing, tab ID, origin, snapshot ID, page revision, approval token, and action hash before sending `action.request`. The extension returns a post-action snapshot for fill/click/submit and download metadata for download. A changed page invalidates the previous approval.

- [x] **Step 5: Test and commit**

Run:

```powershell
npm run browser:test
cargo test --manifest-path src-tauri/Cargo.toml browser_bridge::policy browser_bridge::actions
npm run test:unit -- src/services/workAssistantPolicy.test.ts src/services/workAssistantRuntime.test.ts
```

Expected: PASS.

```powershell
git add apps/browser-bridge/src/actions.ts apps/browser-bridge/src/actions.test.ts src-tauri/src/work_assistant/browser_bridge src/services/workAssistantPolicy.ts src/services/workAssistantRuntime.ts
git commit -m "feat: add approved browser actions"
```

### Task 8: Route browser tools through the secretary loop

**Files:**
- Modify: `src/services/workAssistantRegistry.ts`
- Modify: `src/services/workAssistantAgentLoop.ts`
- Modify: `src/services/workAssistantAgentLoop.test.ts`
- Modify: `src/services/secretaryTaskClassifier.ts`
- Modify: `src/services/agentOrchestrator.ts`

- [x] **Step 1: Register browser tools only when available**

Register `browser_snapshot`, `browser_fill_draft`, `browser_click`, `browser_download`, and `browser_submit` with executor `browser_bridge`. Include them in model schemas only when native status is connected and has an authorized tab. Keep `web_search` and `web_extract` available without the extension.

- [x] **Step 2: Add loop tests**

Cover:

```text
web_search -> web_extract -> web_archive -> final
browser_snapshot -> browser_fill_draft -> final without submit
browser_snapshot -> browser_submit -> approval deny -> final explains draft preserved
browser_snapshot -> stale_snapshot -> refresh snapshot -> no automatic click
mixed web/file research -> existing writer pipeline
```

- [x] **Step 3: Add browser guidance to the model protocol**

The system prompt must state:

- never request a password, verification code, payment detail, or hidden field;
- never submit unless the user requested submission;
- prefer fill-draft and stop before submit;
- use element IDs only from the latest snapshot;
- after navigation or stale result, request a new snapshot;
- do not claim an action succeeded unless the tool result says `ok: true`.

- [x] **Step 4: Preserve simple-agent behavior**

Opening or summarizing one page remains a single-Agent task. Existing subagents are used only for complex research/verification or a mixed deliverable, not for routine browser clicks or form filling.

- [x] **Step 5: Test and commit**

Run:

```powershell
npm run test:unit -- src/services/workAssistantAgentLoop.test.ts
npm run build
```

Expected: PASS.

```powershell
git add src/services/workAssistantRegistry.ts src/services/workAssistantAgentLoop.ts src/services/workAssistantAgentLoop.test.ts src/services/secretaryTaskClassifier.ts src/services/agentOrchestrator.ts
git commit -m "feat: route secretary browser collaboration"
```

### Task 9: Add browser workbench and pairing UI

**Files:**
- Create: `src/components/SecretaryBrowserWorkbench.tsx`
- Create: `src/components/SecretaryBrowserWorkbench.test.tsx`
- Create: `src/components/BrowserBridgeSettings.tsx`
- Create: `src/components/BrowserBridgeSettings.test.tsx`
- Modify: `src/components/SecretaryWorkbenchPanel.tsx`
- Modify: `src/components/FlowWorkspace.tsx`
- Modify: `src/components/ComputerAssistantSettings.tsx`

- [x] **Step 1: Add the browser view**

Extend:

```ts
export type WorkbenchView = 'run' | 'files' | 'browser' | 'manuscript'
```

Auto-open the browser view only when the user has not manually closed it during the run.

- [x] **Step 2: Build workbench component tests**

Test disconnected, pairing, connected, stale, restricted, and error states. Test page title/origin, text summary, fields, pending action, download result, and stale snapshot. Ensure no raw HTML is rendered.

- [x] **Step 3: Implement pairing settings**

Show:

- installation path to the unpacked extension directory;
- start-pairing button;
- port, expiring token, and copy button;
- current browser/tab/origin;
- disconnect button;
- last error and health check.

Do not render the token after successful pairing and do not persist it in Zustand/localStorage.

- [x] **Step 4: Add inline action previews**

Browser tool rows show site origin, element label, action, visible draft summary, risk, and approval controls. Password-like text must be redacted before it enters any UI state or audit record.

- [x] **Step 5: Test and commit**

Run:

```powershell
npm run test:unit -- src/components/SecretaryBrowserWorkbench.test.tsx src/components/BrowserBridgeSettings.test.tsx
npm run build
```

Expected: PASS.

```powershell
git add src/components/SecretaryBrowserWorkbench.tsx src/components/SecretaryBrowserWorkbench.test.tsx src/components/BrowserBridgeSettings.tsx src/components/BrowserBridgeSettings.test.tsx src/components/SecretaryWorkbenchPanel.tsx src/components/FlowWorkspace.tsx src/components/ComputerAssistantSettings.tsx
git commit -m "feat: add browser bridge workbench UI"
```

### Task 10: Complete browser integration and documentation

**Files:**
- Create: `src/services/browserAssistantIntegration.test.ts`
- Create: `apps/browser-bridge/src/integration.test.ts`
- Modify: `docs/FEATURES.md`
- Modify: `docs/AGENT_ARCHITECTURE.md`
- Create: `docs/BROWSER_BRIDGE.md`
- Modify: `README.md`
- Modify: `package.json`

- [x] **Step 1: Add mocked end-to-end protocol tests**

Exercise pairing, current-tab authorization, snapshot, fill preview, approval, action, post-action snapshot, submit denial, disconnect, and late-event rejection using the same JSON fixtures on the app and extension sides.

- [x] **Step 2: Add security regression tests**

Cover redirect to private IP, DNS resolving to private IP, restricted URLs, password/OTP/card fields, hidden controls, cross-origin navigation, wrong tab, stale snapshot, forged approval token, replayed action, oversized WebSocket payload, and token reuse.

- [x] **Step 3: Add aggregate scripts**

```json
"test:browser": "npm run browser:test && npm run test:unit -- src/services/browserAssistantIntegration.test.ts",
"check:browser": "npm run test:browser && npm run browser:build && cargo test --manifest-path src-tauri/Cargo.toml --locked browser_bridge && cargo test --manifest-path src-tauri/Cargo.toml --locked web_extract"
```

- [x] **Step 4: Document installation and boundaries**

`docs/BROWSER_BRIDGE.md` must explain unpacked extension installation for Chrome, Edge, and Brave; current-tab authorization; pairing expiry; restricted pages; supported fields; submission approval; disconnect; Linux browser limitations; and troubleshooting.

- [x] **Step 5: Run full browser verification**

Run:

```powershell
npm run lint
npm run test:unit
npm run browser:test
npm run browser:build
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
git diff --check
```

Expected: all commands exit 0.

- [x] **Step 6: Commit**

```powershell
git add package.json package-lock.json README.md docs src apps/browser-bridge src-tauri
git commit -m "feat: complete safe browser collaboration"
```

## Browser Completion Gate

Do not start release certification until:

- Public extraction cannot reach private or loopback destinations through direct URLs or redirects.
- The extension requests no broad browsing, cookie, history, debugger, clipboard, or native-messaging permission.
- Current-tab pairing works and expires correctly.
- Restricted pages and sensitive fields are blocked before approval.
- Fill, click, download, and submit actions require the correct risk-specific approval.
- Stale snapshots never re-resolve to a different element.
- Browser action rows and final messages are not duplicated.
