# Agent Company — Office Animation Pacing & Minimalist Folder Browse Specification

Date: 2026-10-23 · Status: Approved / Ready for Implementation · Author: ArchitectUX

---

## 1. Executive Summary

This specification addresses two key UX and architectural deficiencies identified from user testing in the `agent-company` local web application:
1. **Minimalist Folder Browser (VS Code Style)**: Replace the cumbersome, embedded multi-level web file tree with a streamlined 1-click **Browse Folder** action that invokes the native OS File Explorer (Windows Explorer / macOS Finder / Linux file picker) via a lightweight backend endpoint (`POST /fs/pick-folder`), while keeping a direct path input with automatic workspace name detection.
2. **Natural Pacing & Causality Sequencing for Character Interactions**: Replace the rigid, overly rapid 1200ms fixed walk time and 1000ms speech duration with distance-based walking velocity and readable dialogue timing. Establish a **Causality Dependency Queue** that anchors recipients at their desks until incoming reports are delivered, eliminating unnatural simultaneous movement where the Manager leaves their desk before an employee arrives with a report.

---

## 2. Feature 1: Minimalist Folder Browse (VS Code Style)

### 2.1 Current Deficiencies
In `ui/js/app.js` and `src/fs-browse.ts`:
- Opening the "Thêm workspace" dialog renders a heavy virtual file browser (`.ws-folder-list`, drive buttons, up-directory navigation, dual path/name inputs).
- Users must double-click through nested directories over internal HTTP requests, lacking OS features like Quick Access, search, folder creation, and breadcrumb navigation.
- In contrast, tools like VS Code feature a prominent "Open Folder..." button that immediately launches the native OS picker.

### 2.2 System Architecture & Flow

```
[ Web UI (Dialog) ] ──(Click "Duyệt thư mục trên máy…")──> [ Backend: POST /fs/pick-folder ]
                                                                      │
                                                ┌─────────────────────┴─────────────────────┐
                                                ▼                                           ▼
                                      [ Windows 10/11 ]                             [ macOS / Linux ]
                               PowerShell FolderBrowserDialog                  osascript / zenity / kdialog
                                                │                                           │
                                                └─────────────────────┬─────────────────────┘
                                                                      │
                                                       Response: { path, name }
                                                                      │
                                                                      ▼
                              [ Auto-fill Path & Name -> Auto-submit or 1-Click "Mở Workspace" ]
```

### 2.3 Backend API Contract: `POST /fs/pick-folder`

- **Endpoint**: `POST /fs/pick-folder`
- **Headers**:
  - `Content-Type: application/json`
  - `Host`: Localhost validation (RFC 1918 / DNS rebinding protection)
- **Request Body**: `{}` (Empty JSON object or optional `{ "initialPath": "D:\\projects" }`)
- **Responses**:
  - `200 OK` (User selected a folder):
    ```json
    {
      "canceled": false,
      "path": "D:\\projects\\ecommerce-ai",
      "name": "ecommerce-ai"
    }
    ```
  - `200 OK` (User canceled the dialog):
    ```json
    {
      "canceled": true
    }
    ```
  - `400 Bad Request` / `500 Internal Server Error`:
    ```json
    {
      "canceled": false,
      "error": "Failed to open native folder dialog: <details>"
    }
    ```

### 2.4 Backend Implementation (`src/fs-browse.ts`)

```typescript
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { basename, resolve } from "node:path";
import { assertSafeWindowsPath } from "./fs-browse.ts";

const execFileAsync = promisify(execFile);

export interface PickFolderResult {
  canceled: boolean;
  path?: string;
  name?: string;
  error?: string;
}

/**
 * Open the native OS directory picker dialog without external binary dependencies.
 */
export async function pickNativeFolder(initialPath?: string): Promise<PickFolderResult> {
  const platform = process.platform;

  try {
    if (platform === "win32") {
      // Use PowerShell .NET FolderBrowserDialog
      const initial = initialPath ? resolve(initialPath).replace(/'/g, "''") : "";
      const psCommand = `
        Add-Type -AssemblyName System.Windows.Forms
        $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
        $dlg.Description = 'Chọn thư mục Workspace cho Agent Company'
        $dlg.ShowNewFolderButton = $true
        ${initial ? `$dlg.SelectedPath = '${initial}'` : ""}
        if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
          [Console]::WriteLine($dlg.SelectedPath)
        }
      `.trim();

      const { stdout } = await execFileAsync("powershell", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        psCommand
      ], { timeout: 120_000 });

      const selected = stdout.trim();
      if (!selected) return { canceled: true };
      assertSafeWindowsPath(selected);
      return {
        canceled: false,
        path: selected,
        name: basename(selected)
      };
    } else if (platform === "darwin") {
      // macOS AppleScript native folder chooser
      const { stdout } = await execFileAsync("osascript", [
        "-e",
        'POSIX path of (choose folder with prompt "Chọn thư mục Workspace:")'
      ], { timeout: 120_000 });

      const selected = stdout.trim().replace(/\/$/, "");
      if (!selected) return { canceled: true };
      return {
        canceled: false,
        path: selected,
        name: basename(selected)
      };
    } else {
      // Linux: Try zenity first, then fallback to kdialog
      try {
        const { stdout } = await execFileAsync("zenity", [
          "--file-selection",
          "--directory",
          "--title=Chọn thư mục Workspace"
        ], { timeout: 120_000 });
        const selected = stdout.trim();
        if (!selected) return { canceled: true };
        return { canceled: false, path: selected, name: basename(selected) };
      } catch (zenityErr: any) {
        if (zenityErr.code === 1) return { canceled: true }; // User canceled
        // Try kdialog
        const { stdout } = await execFileAsync("kdialog", [
          "--getexistingdirectory",
          initialPath || "."
        ], { timeout: 120_000 });
        const selected = stdout.trim();
        if (!selected) return { canceled: true };
        return { canceled: false, path: selected, name: basename(selected) };
      }
    }
  } catch (err: any) {
    if (err.killed || err.code === 1) return { canceled: true };
    return { canceled: false, error: err.message || "Failed to open folder picker" };
  }
}
```

### 2.5 UI / UX Design Specification

#### HTML Template (`ui/js/app.js` -> `addWorkspace()`)
```html
<form method="dialog" class="ask-form ws-simple-form">
  <h2>Thêm workspace</h2>
  <p class="ask-text">Chọn thư mục dự án trên máy tính để đội ngũ bắt đầu làm việc.</p>

  <!-- 1-Click Hero Browse Button -->
  <div class="ws-browse-hero">
    <button type="button" class="btn primary ws-hero-browse-btn" id="btn-browse-native" autofocus>
      <svg class="icon" viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
        <path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h3.879a1.5 1.5 0 0 1 1.06.44l1.122 1.12A.5.5 0 0 0 8.914 4H13.5A1.5 1.5 0 0 1 15 5.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5v-9z" fill="currentColor"/>
      </svg>
      <span>Duyệt thư mục trên máy…</span>
    </button>
    <span class="ws-browse-hint">Mở cửa sổ File Explorer hệ điều hành</span>
  </div>

  <div class="ws-divider">
    <span>hoặc dán đường dẫn trực tiếp</span>
  </div>

  <div class="ws-form-fields">
    <label class="field">
      <span>Đường dẫn thư mục</span>
      <input id="ws-input-path" name="path" placeholder="D:\projects\my-app hoặc /home/user/project" autocomplete="off" spellcheck="false" required>
    </label>
    <label class="field">
      <span>Tên hiển thị <em>(tuỳ chọn)</em></span>
      <input id="ws-input-name" name="name" placeholder="Để trống sẽ tự lấy tên thư mục" autocomplete="off">
    </label>
  </div>

  <div class="ask-buttons">
    <button type="button" class="btn" value="cancel">Huỷ</button>
    <button type="submit" class="btn primary" value="ok" id="btn-submit-ws">Mở Workspace</button>
  </div>
</form>
```

#### CSS Styling (`ui/styles.css`)
```css
/* Minimalist Workspace Browse Dialog */
.ask.ws-dialog {
  width: min(500px, calc(100vw - 32px));
  border-radius: 16px;
  box-shadow: 0 20px 48px rgba(0, 0, 0, 0.28);
}

.ws-browse-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 18px 12px;
  background: var(--surface-subtle, rgba(0, 0, 0, 0.03));
  border: 1px dashed var(--border-color, #c8d0e0);
  border-radius: 12px;
  margin: 12px 0 16px;
  transition: border-color 0.2s ease, background-color 0.2s ease;
}

.ws-browse-hero:hover {
  background: var(--surface-hover, rgba(0, 0, 0, 0.05));
  border-color: var(--accent);
}

.ws-hero-browse-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  font-size: 15px;
  font-weight: 600;
  padding: 10px 22px;
  border-radius: 10px;
}

.ws-browse-hint {
  font-size: 12px;
  color: var(--ink-muted, #727b94);
}

.ws-divider {
  display: flex;
  align-items: center;
  text-align: center;
  margin: 14px 0 16px;
  color: var(--ink-muted, #727b94);
  font-size: 12px;
}

.ws-divider::before,
.ws-divider::after {
  content: "";
  flex: 1;
  border-bottom: 1px solid var(--border-color, #e0e4ee);
}

.ws-divider span {
  padding: 0 12px;
}
```

---

## 3. Feature 2: Natural Pacing & Causality Sequencing for Character Interactions

### 3.1 Problem Analysis
User feedback highlights two visual design flaws:
1. **Characters move too fast**: Fixed 1200ms path transit creates a hurried, frenetic scurrying effect across multiple rooms. Additionally, 1000ms speech duration is too brief to read incoming notifications.
2. **Broken Causality & Unnatural Concurrency**:
   When Role A completes a task (`fx.kind === "done"`), the server emits the event and immediately dispatches the Manager's next action (`fx.kind === "reply"` to user or `fx.kind === "handoff"` to Role B).
   Because the old `RoleWalkQueue` only tracked single-actor concurrency (`active.has(role)`), Role A and Manager departed simultaneously:
   - Role A was walking to Manager's desk to report.
   - Manager had already stood up and rushed out the door to Entrance or to Role B!
   - Role A arrived at an empty desk talking to nobody.

### 3.2 Solution Architecture: Causality Sequencing Model

```
Timeline:
t0: Role A finishes task -> starts walking to Manager
    Manager is LOCKED at desk (Listening posture / cannot depart)
t1: Role A arrives at Manager's desk -> Bubble pops up: "Xong: Hoàn thành CSS layout"
    Manager desk emits visual acknowledgment (desk ping / attention state)
t2: Speech bubble finishes reading duration (1800ms - 3200ms)
    Manager accepts report -> Manager UNLOCKS
    Role A begins walking back to own desk
t3: Manager stands up -> walks to User Entrance (or to Role B)
    Manager arrives at User Entrance -> Bubble: "Dạ đã hoàn thành giao diện"
t4: Conversation with User finishes -> Manager returns to desk
```

### 3.3 Movement Pacing Formulas

#### Distance-Based Walk Velocity
Instead of a flat duration regardless of distance, duration scales proportionally with Euclidean distance across path nodes:
- **Base Walk Speed**: $V_{\text{walk}} = 190 \text{ px/sec}$ (~12 tiles/sec at 16px grid).
- Given path waypoints $P = [p_0, p_1, \dots, p_k]$:
  $$\text{distance} = \sum_{i=0}^{k-1} \sqrt{(p_{i+1}.x - p_i.x)^2 + (p_{i+1}.y - p_i.y)^2}$$
  $$\text{legDuration} = \max\left(600\text{ms}, \frac{\text{distance}}{V_{\text{walk}}} \times 1000\right) \times \frac{1}{\text{speed}}$$
- This guarantees uniform, natural stride cadence regardless of whether a desk is 1 room or 3 rooms away.

#### Reading-Adaptive Speech Bubble Duration
Bubble duration adapts dynamically to the text length so users can comfortably read:
$$\text{talkDuration} = \text{clamp}\left(1800\text{ms}, 1200\text{ms} + \text{text.length} \times 32\text{ms}, 3800\text{ms}\right) \times \frac{1}{\text{speed}}$$
- Short alerts ("Xong!") stay for ~1.8 seconds.
- Longer titles stay for 2.8 - 3.5 seconds.
- Replay speed multipliers (2x, 4x) scale duration proportionally.

### 3.4 Causality Dependency Director (`CausalityDirector`)

A state-machine queue replaces the naive concurrency check.

```typescript
// ui/js/office-causality.js

export type RoleState = "IDLE" | "WALKING_TO" | "CONVERSING" | "WALKING_BACK";

export interface OfficeEffect {
  kind: "reply" | "approval" | "checkpoint" | "handoff" | "done" | "failed";
  from: string;
  to: string;
  label: string;
}

export class CausalityDirector {
  private queue: Array<{ fx: OfficeEffect; speed: number }> = [];
  private roleStates = new Map<string, RoleState>();
  private lockedRoles = new Set<string>(); // Cannot leave desk
  private isDraining = false;

  constructor(private officeEl: HTMLElement) {}

  /**
   * Determine actor roles according to office protocol:
   */
  public resolveActors(fx: OfficeEffect): { walker: string; target: string } {
    let walker = fx.from;
    let target = fx.to;

    if (fx.kind === "reply") {
      walker = "manager";
      target = "user";
    } else if (fx.kind === "approval") {
      walker = fx.from;
      target = "user";
    } else if (fx.kind === "checkpoint") {
      walker = fx.from;
      target = "manager";
    }
    return { walker, target };
  }

  public enqueue(fx: OfficeEffect, speed: number = 1): void {
    this.queue.push({ fx, speed });
    this.drain();
  }

  private async drain(): Promise<void> {
    if (this.isDraining) return;
    this.isDraining = true;

    while (this.queue.length > 0) {
      // Find the first effect whose walker is NOT busy and NOT locked
      const index = this.queue.findIndex(item => {
        const { walker, target } = this.resolveActors(item.fx);
        return !this.isRoleBusy(walker) && !this.lockedRoles.has(walker);
      });

      if (index === -1) {
        // All waiting items have dependencies currently in motion; wait for current animation
        break;
      }

      const [{ fx, speed }] = this.queue.splice(index, 1);
      const { walker, target } = this.resolveActors(fx);

      // Execute this walk. Note: we do NOT block the entire loop if subsequent
      // unrelated walks occur between independent roles (parallel desk conversations).
      this.executeInteraction(walker, target, fx, speed);
    }

    this.isDraining = false;
  }

  private isRoleBusy(role: string): boolean {
    const s = this.roleStates.get(role) || "IDLE";
    return s !== "IDLE";
  }

  private async executeInteraction(walker: string, target: string, fx: OfficeEffect, speed: number) {
    // 1. Lock recipient at their desk so they do not wander off
    this.lockedRoles.add(target);
    this.roleStates.set(walker, "WALKING_TO");

    const walkerDesk = this.getDesk(walker);
    const targetDesk = this.getDesk(target);
    walkerDesk?.classList.add("away");

    try {
      // 2. Animate walk to target using distance-based pacing
      await this.animateWalk(walker, target, speed);
      this.roleStates.set(walker, "CONVERSING");

      // 3. Target desk visual acknowledgment (Active Listening)
      targetDesk?.classList.add("ping");
      setTimeout(() => targetDesk?.classList.remove("ping"), 600);

      // 4. Display dialogue bubble for calculated reading duration
      await this.showBubble(walker, fx, speed);

      // 5. CAUSALITY TRANSFER POINT:
      // The message is fully received. Release the recipient lock!
      // If the recipient had a queued action (e.g., Manager reporting to User),
      // drain() will immediately start their next journey.
      this.lockedRoles.delete(target);
      this.drain();

      // 6. Walker returns to own desk
      this.roleStates.set(walker, "WALKING_BACK");
      await this.animateReturn(walker, speed);
    } finally {
      this.lockedRoles.delete(target);
      this.roleStates.set(walker, "IDLE");
      walkerDesk?.classList.remove("away");
      // Trigger drain in case this walker had another task waiting
      this.drain();
    }
  }
}
```

### 3.5 Active Listening & Visual Feedback Polish

1. **Target Desk Reaction (`ping` state)**:
   - When a character arrives at a colleague's desk, the recipient's desk character subtly shifts or blinks, and the desk badge pulses with a soft accent glow.
2. **Away Posture**:
   - When a role is away walking, their desk displays an empty chair with dimmed opacity (0.25) so it is instantly clear to the user that the character is roaming.
3. **No Phantom Interactions**:
   - A character never talks to an empty desk. If the recipient was somehow delayed, the incoming actor halts and waits at the door before initiating dialogue.

---

## 4. Developer Handoff Checklist

| Task ID | Component | File Path | Scope of Work |
| :--- | :--- | :--- | :--- |
| **DEV-01** | Backend Native Picker | `src/fs-browse.ts` | Implement `pickNativeFolder()` with PowerShell / osascript / zenity. |
| **DEV-02** | HTTP Server Route | `src/server.ts` | Wire `POST /fs/pick-folder` returning `{ canceled, path, name }`. |
| **DEV-03** | UI Modal Redesign | `ui/js/app.js` | Replace virtual folder list in `addWorkspace()` with 1-click Hero button & simplified path input. |
| **DEV-04** | Modal CSS Tokens | `ui/styles.css` | Add styling for `.ws-browse-hero`, `.ws-divider`, and responsive dialog sizing. |
| **DEV-05** | Distance Pacing | `ui/js/office.js` | Update `walkDuration()` to compute segment duration via distance / velocity; clamp bubble duration to text length. |
| **DEV-06** | Causality Director | `ui/js/office.js` | Replace `RoleWalkQueue` with `CausalityDirector` enforcing Recipient Locking and sequential execution. |
| **DEV-07** | Unit & UI Tests | `tests/ui-office.test.ts` | Add test cases verifying sequential delivery (Role A done completes before Manager reply departs). |

---

## 5. Acceptance Criteria

1. **Workspace Browser**:
   - Clicking "Duyệt thư mục trên máy…" opens the native OS File Explorer.
   - Selecting a folder auto-populates the path and workspace name without requiring manual typing.
   - Pasting a path directly into the input continues to work reliably.
2. **Animation Pacing**:
   - Character walking speed is consistent and visually natural across any distance (~190 px/s).
   - Dialogue bubbles stay visible for at least 1.8s to 3.5s depending on sentence length.
3. **Causality Integrity**:
   - When a role finishes a task, the Manager remains seated at their desk until the reporting employee arrives and displays their "Xong" bubble.
   - Only after the report is delivered does the Manager stand up to report to the User or assign work to another role.
