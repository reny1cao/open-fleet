# Fleet Dashboard v2

## Why Redesign

The current dashboard is a feature-complete read-only monitor. It shows what's happening but you can't act on it. Agent status is a colored dot with no diagnosis. Tasks and agents live in separate views with no correlation. Polling every 10 seconds means you miss events and waste bandwidth. Mobile is an afterthought — the 4-view tab layout doesn't work on a phone.

The boss wants a dashboard you'd actually keep open on your phone to manage the fleet. That means: mobile-first, live updates, actionable, and diagnostic.

## Stack

**React + Vite + Zustand + TailwindCSS**

- React: team already ships it (SysBuilder). Component model suits card-based mobile layouts.
- Vite: single static bundle (`vite build` → `dist/`), served by fleet API server. HMR for dev.
- Zustand: proven in SysBuilder chat panel. Lightweight, SSE-friendly (update store from event handler, components re-render).
- TailwindCSS: utility-first, responsive breakpoints built in (`sm:`, `md:`, `lg:`), no custom CSS maintenance.

**Deployed as:** Static bundle served from `GET /dashboard` (replaces current single HTML file). The fleet server at port 4680 serves both the API and the dashboard.

---

## Views

### 1. Operations (default view, replaces Mission Control)

The unified agent + task view. One screen answers: "who is working on what, and is anything broken?"

**Mobile layout (single column):**

```
┌─────────────────────────┐
│ Fleet Dashboard    [≡]  │  ← header + hamburger menu
├─────────────────────────┤
│ 3 alive  1 stale  0 dead│  ← status summary bar
│ 12 active  4 blocked    │
├─────────────────────────┤
│ ⚠ Alerts (2)            │  ← collapsible, only if alerts exist
│ ┌─────────────────────┐ │
│ │ Carmack: ssh_timeout │ │  ← classified error + recovery hint
│ │ retry 2/5, 10s ago   │ │
│ └─────────────────────┘ │
│ ┌─────────────────────┐ │
│ │ disk: 91% on sg-dev  │ │
│ └─────────────────────┘ │
├─────────────────────────┤
│ ┌─────────────────────┐ │  ← agent cards (collapsed by default on mobile)
│ │ ● Carmack  task-153 ▸│ │  ← one line: dot + name + task + chevron
│ │ ● Ken      task-125 ▸│ │
│ │ ● Knuth    task-034 ▸│ │
│ │ ○ Linus    idle     ▸│ │  ← hollow dot = stale/off
│ └─────────────────────┘ │
│                          │
│ ┌─────────────────────┐ │  ← tap to expand single agent card:
│ │ ● John Carmack       │ │
│ │   worker • alive 12s │ │
│ │   ┌───────────────┐  │ │
│ │   │ task-153 [HIGH]│  │ │  ← current task inline
│ │   │ Quality spec   │  │ │
│ │   │ in_progress 25m│  │ │
│ │   └───────────────┘  │ │
│ │   Done today: 3      │ │
│ └─────────────────────┘ │
├─────────────────────────┤
│ Activity (live)          │  ← scrolling feed, newest first
│ 11:45  Carmack  task-153│
│   Status: open → in_pro │
│ 11:42  Ken  task-125    │
│   Sprint schema merged  │
├─────────────────────────┤
│ [Ops] [Board] [Timeline]│  ← bottom nav (fixed)
└─────────────────────────┘
```

**Desktop layout (2-column):**
- Left: Agent cards grid (2-3 columns) with inline current tasks
- Right: Activity feed (sticky, scrolls independently)
- Alerts banner spans full width above both columns

**Key design decisions:**
- **Agent cards collapsed by default on mobile** — one line per agent (dot + name + current task title). Tap to expand full card with task detail, stats, and actions. This keeps the pulse scan to ~5 lines instead of 5 screens. Desktop shows expanded cards in grid.
- Agent card shows *current task inline* — no need to cross-reference the board. This is the "unified view" the team identified as missing.
- Alerts section surfaces classified errors from the error classifier (task-175). Shows category, severity, recovery hint, retry count. Replaces the meaningless colored dot.
- Activity feed is live (SSE) — new events appear at the top without polling.

### 2. Board (Kanban)

Task-centric view. Columns by status, cards are draggable.

**Mobile layout:**
- Horizontal swipe between columns (one column visible at a time)
- Column header shows count + swipe indicator dots
- Pull-to-refresh

```
┌─────────────────────────┐
│ Board         [filter ▼]│
├─────────────────────────┤
│ ● ● ◉ ●                │  ← column indicator dots
│                         │
│ IN PROGRESS (4)         │
│ ┌─────────────────────┐ │
│ │ task-153 [HIGH]      │ │
│ │ Quality standards    │ │
│ │ Carmack • 25m        │ │
│ │ ────────── 80%       │ │  ← flow time bar
│ └─────────────────────┘ │
│ ┌─────────────────────┐ │
│ │ task-125 [HIGH]      │ │
│ │ Sprint support       │ │
│ │ Ken • 1h 12m         │ │
│ └─────────────────────┘ │
│                         │
│       ← swipe →         │
├─────────────────────────┤
│ [Ops] [Board] [Timeline]│
└─────────────────────────┘
```

**Desktop layout:**
- 6 columns: VERIFY → REVIEW → IN PROGRESS → BLOCKED → OPEN → BACKLOG
- Active/Review columns 50% wider (existing pattern, proven)
- Drag-and-drop between columns triggers `PATCH /tasks/:id` with status change
- Sprint selector dropdown (from `GET /sprints`)
- Project filter tabs

**Actions from board:**
- Drag card → status change (validates transitions, shows error on invalid)
- Tap card → task detail sheet (slide-up on mobile, modal on desktop)
- Long-press card → quick actions menu (assign, change priority, block)
- "+" button on column → create task with pre-set status

### 3. Timeline (Gantt)

Time-based view. Horizontal axis = time, rows = agents.

**Mobile layout:**
- Rotated: time axis vertical (top = now, scroll down = past)
- Agent rows become horizontal bands
- Pinch-to-zoom for time range
- Tap block → task detail sheet

```
┌─────────────────────────┐
│ Timeline  [4h 8h 12h 24]│
├─────────────────────────┤
│      Carmack  Ken  Knuth│
│ now ─┬───────┬─────┬────│
│      │ t-153 │t-125│    │
│      │ spec  │spri │    │
│      │       │     │    │
│ -1h ─┤       ├─────┤    │
│      │       │     │    │
│      ├───────┤     │    │
│      │ t-175 │     │    │
│      │ error │     │    │
│ -2h ─┤  spec ├─────┤    │
│      │       │t-126│    │
│      │       │smoke│    │
├─────────────────────────┤
│ [Ops] [Board] [Timeline]│
└─────────────────────────┘
```

**Desktop layout:**
- Standard horizontal Gantt (existing pattern)
- Agent rows with status-colored blocks
- "Now" line, configurable range (4h/8h/12h/24h)
- Hover tooltip with task detail, click for full modal
- Collapsible idle agent rows

### 4. Sprint (new view)

Sprint-scoped view for time-boxed planning. Always visible in bottom nav (consistent 4-tab layout, no layout shift). Shows empty state with "No active sprint — create one" when no sprints exist.

**Mobile layout:**
- Sprint header: name, date range, progress bar (done/total)
- Goals checklist (from sprint.goals)
- Task list grouped by status, collapsible
- Burndown: simple line chart (tasks remaining vs time)

**Desktop layout:**
- Left: sprint info + burndown chart
- Right: task list grouped by assignee with status badges
- Sprint selector tabs at top

---

## Live Data: SSE Events

Replace polling with Server-Sent Events. The fleet server pushes events; the dashboard subscribes.

### New Endpoint: `GET /events`

```
GET /events
Accept: text/event-stream
Authorization: Bearer {token}  (optional — dashboard auth via URL param)

Response: text/event-stream
```

### Event Types

```typescript
// Task events
{ event: "task:created",   data: { task: Task } }
{ event: "task:updated",   data: { task: Task, changes: string[] } }
{ event: "task:status",    data: { taskId: string, from: TaskStatus, to: TaskStatus, agent: string } }
{ event: "task:assigned",  data: { taskId: string, from?: string, to: string } }

// Agent events
{ event: "agent:heartbeat", data: { agent: string, state: HeartbeatState, ageSec: number } }
{ event: "agent:status",    data: { agent: string, status: AgentStatus } }
{ event: "agent:error",     data: { agent: string, error: ClassifiedError } }
{ event: "agent:restart",   data: { agent: string, by: string } }

// Sprint events
{ event: "sprint:created",  data: { sprint: Sprint } }
{ event: "sprint:closed",   data: { sprint: Sprint } }

// System events
{ event: "system:ping",     data: { ts: string } }  // keepalive every 30s
```

### Client-Side State Management

```typescript
// stores/fleet-store.ts (Zustand)

interface FleetStore {
  agents: Agent[]
  tasks: Task[]
  activity: ActivityEvent[]
  sprints: Sprint[]
  alerts: ClassifiedError[]

  // SSE connection state
  connected: boolean
  lastEventTs: string | null

  // Actions (called from SSE handler + user interactions)
  updateTask: (task: Task) => void
  updateAgent: (agent: Agent) => void
  pushActivity: (event: ActivityEvent) => void
  pushAlert: (error: ClassifiedError) => void
  dismissAlert: (id: string) => void
}
```

**SSE hook:**

```typescript
// hooks/use-sse.ts
function useSSE(store: FleetStore) {
  useEffect(() => {
    const es = new EventSource(`/events?token=${token}`)

    es.addEventListener("task:updated", (e) => {
      const { task } = JSON.parse(e.data)
      store.updateTask(task)
    })

    es.addEventListener("agent:heartbeat", (e) => {
      const { agent, state, ageSec } = JSON.parse(e.data)
      store.updateAgent({ name: agent, heartbeat: { state, ageSec } })
    })

    es.addEventListener("agent:error", (e) => {
      const { agent, error } = JSON.parse(e.data)
      store.pushAlert({ ...error, affectedAgent: agent })
    })

    // ... other event handlers

    return () => es.close()
  }, [])
}
```

**Initial load:** On connect, the dashboard fetches full state from `GET /agents`, `GET /tasks`, `GET /activity`, `GET /sprints`. After that, SSE events keep state up to date incrementally. If the SSE connection drops, the dashboard reconnects and re-fetches full state.

### Heartbeat Polling Fallback

SSE replaces the 10-second poll for task and activity updates. However, agent heartbeat state still needs periodic refresh — heartbeats are written to files by agents, not pushed through the API. Two options:

- **Option A:** Server polls heartbeat files every 15s and pushes `agent:heartbeat` events via SSE. Dashboard is purely reactive.
- **Option B:** Dashboard polls `GET /agents` every 15s for heartbeat data only. SSE covers everything else.

**Recommendation: Option A.** The server already reads heartbeat files for the `/agents` endpoint. Adding a 15-second internal tick that emits SSE events is trivial and keeps the dashboard purely SSE-driven.

---

## Actions (What Users Can Do)

The current dashboard is read-only. v2 adds these actions:

### From Operations View
- **Restart agent** — button on agent card → `POST /agents/:name/restart` (with confirmation dialog)
- **Dismiss alert** — clear a classified error from the alert banner
- **Quick-assign** — tap unassigned task → agent picker → `PATCH /tasks/:id`

### From Board View
- **Drag-and-drop status change** — drag card between columns → `PATCH /tasks/:id {status}`
- **Create task** — "+" button → slide-up form → `POST /tasks`
- **Edit task** — tap card → detail sheet with editable fields → `PATCH /tasks/:id`
- **Change priority** — long-press card → priority picker
- **Assign/reassign** — long-press card → agent picker
- **Block/unblock** — long-press → "Block" with reason input / "Unblock"

### From Timeline View
- **Restart agent** — tap agent name → context menu
- **View task** — tap block → detail sheet

### From Sprint View
- **Create sprint** — button → form with name, dates, goals → `POST /sprints`
- **Close sprint** — button with confirmation → `PATCH /sprints/:id/close`
- **Move task to sprint** — drag or menu → `PATCH /tasks/:id {sprintId}`

### Confirmation Pattern
All destructive or state-changing actions show a confirmation:
- **Mobile:** Bottom sheet with action description + "Confirm" / "Cancel"
- **Desktop:** Inline popover near the trigger element

---

## API Changes Needed

### New Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/events` | SSE event stream (task, agent, sprint, system events) |
| GET | `/tasks/stats` | Summary stats: counts by status, by assignee, by project. Avoids client-side aggregation on mobile. |
| GET | `/sprints/current` | Active sprint with task stats (done/total/blocked). Convenience endpoint for sprint view header. |

### Endpoint Modifications

| Endpoint | Change | Reason |
|----------|--------|--------|
| `PATCH /tasks/:id` | Emit SSE `task:updated` + `task:status` events after write | Live updates to all connected dashboards |
| `POST /tasks` | Emit SSE `task:created` event after write | Live task creation visibility |
| `POST /agents/:name/restart` | Emit SSE `agent:restart` event | Dashboard shows restart in real-time |
| `GET /agents` | Add `classifiedErrors` field per agent (from watchdog state) | Surface error classifier data |
| `GET /dashboard` | Serve Vite-built `dist/index.html` instead of inline HTML | New build artifact |

### SSE Implementation (Server-Side)

```typescript
// src/server/sse.ts

const clients = new Set<Response>()

export function addSSEClient(res: Response) {
  clients.add(res)
  res.addEventListener("close", () => clients.delete(res))
}

export function broadcast(event: string, data: unknown) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const client of clients) {
    client.write(payload)
  }
}

// Heartbeat tick (every 15s)
setInterval(() => {
  for (const agent of getAgentStatuses()) {
    broadcast("agent:heartbeat", {
      agent: agent.name,
      state: agent.heartbeat.state,
      ageSec: agent.heartbeat.ageSec,
    })
  }
}, 15_000)

// Keepalive (every 30s)
setInterval(() => {
  broadcast("system:ping", { ts: new Date().toISOString() })
}, 30_000)
```

### Where to Emit Events

Hook into existing task/agent operations:

| Operation | File | Emit |
|-----------|------|------|
| `updateTask()` | `src/tasks/store.ts` | `task:updated`, `task:status` (if status changed), `task:assigned` (if assignee changed) |
| `createTask()` | `src/tasks/store.ts` | `task:created` |
| Task API handlers | `src/server/index.ts` | Call `broadcast()` after store write |
| Agent restart | `src/server/index.ts` POST handler | `agent:restart` |
| Watchdog error | `src/watchdog/daemon.ts` | `agent:error` |

---

## Mobile-First Layout System

### Breakpoints

```
sm:  640px   (large phone landscape)
md:  768px   (tablet portrait)
lg:  1024px  (tablet landscape / small laptop)
xl:  1280px  (desktop)
```

### Navigation

**Mobile (< md):** Fixed bottom tab bar with 3-4 tabs (Ops / Board / Timeline / Sprint if active). Icons + labels. Active tab highlighted.

**Desktop (>= md):** Top nav bar with tabs. Status summary inline in header.

### Responsive Patterns

| Component | Mobile | Desktop |
|-----------|--------|---------|
| Agent cards | Collapsed list (tap to expand) | 2-3 column grid (expanded) |
| Board columns | Horizontal swipe (1 visible) | Side-by-side (all visible) |
| Timeline | Vertical (time = Y axis) | Horizontal (time = X axis) |
| Task detail | Full-screen sheet (slide up) | Side panel or modal |
| Activity feed | Below agent cards (scrollable) | Sticky right sidebar |
| Sprint view | Stacked sections | 2-column layout |
| Create task form | Full-screen sheet | Inline popover or side panel |
| Alerts | Collapsible banner | Persistent top bar |

### Touch Interactions

- **Swipe left/right** on board: navigate between columns
- **Pull down** anywhere: force refresh (re-fetch full state)
- **Long press** on card: quick actions context menu
- **Tap** on card: detail sheet
- **Drag** on board cards: status change (with haptic feedback if available)

---

## Component Architecture

```
src/
  components/
    layout/
      BottomNav.tsx          # Mobile tab bar
      TopNav.tsx             # Desktop nav
      Shell.tsx              # Layout wrapper (nav + content)
    operations/
      AgentCard.tsx          # Agent with inline task
      AlertBanner.tsx        # Classified error alerts
      ActivityFeed.tsx       # Live event stream
      OperationsView.tsx     # Composed view
    board/
      BoardColumn.tsx        # Single column with cards
      BoardView.tsx          # Swipeable columns (mobile) / grid (desktop)
      TaskCard.tsx           # Draggable card
      CreateTaskForm.tsx     # Task creation slide-up
    timeline/
      TimelineView.tsx       # Gantt chart
      TimelineBlock.tsx      # Status-colored block
    sprint/
      SprintView.tsx         # Sprint dashboard
      BurndownChart.tsx      # Simple line chart
    shared/
      TaskDetail.tsx         # Full task detail sheet/modal
      AgentPicker.tsx        # Agent selection (for assign)
      StatusBadge.tsx        # Color-coded status pill
      PriorityBadge.tsx      # Priority indicator
      ConfirmDialog.tsx      # Confirmation bottom sheet / popover
  hooks/
    use-sse.ts               # SSE connection + event dispatch
    use-fleet-store.ts       # Zustand store
  lib/
    api.ts                   # REST client (fetch wrappers)
    format.ts                # Time formatting, truncation
```

---

## Migration Path

### Phase 1 — Foundation

1. Scaffold React + Vite project in `src/dashboard/`
2. Zustand store with initial data fetch (`GET /agents`, `/tasks`, `/activity`)
3. Shell layout with bottom nav (mobile) + top nav (desktop)
4. Operations view: agent cards + activity feed (read-only)
5. Serve built bundle from `GET /dashboard`

**Milestone:** Dashboard loads, shows current state, refreshes via polling (SSE not yet).

### Phase 2 — SSE + Board

1. Add `GET /events` SSE endpoint to server
2. Wire SSE hook to Zustand store
3. Board view with swipeable columns (mobile)
4. Task detail sheet
5. Drag-and-drop status changes

**Milestone:** Live updates, interactive board.

### Phase 3 — Timeline + Actions + Notifications

1. Timeline view (vertical mobile, horizontal desktop)
2. Task creation form
3. Agent restart button
4. Alert banner with classified errors
5. Sprint view (empty state when no sprints)
6. Browser push notifications for critical/fatal alerts (Notification API + permission prompt). Highest-value mobile feature — PM gets "Carmack blocked: disk full on sg-dev" without opening the dashboard.

**Milestone:** Full feature parity with v1 + actions + mobile-first + push alerts.

### Phase 4 — Polish

1. Offline indicator + reconnection logic
2. Keyboard shortcuts (desktop)
3. Dark/light theme (carry forward from v1)
4. Performance: virtualized lists for large task counts

---

## Open Questions

1. **Auth for SSE.** EventSource doesn't support custom headers. Options: (a) token in query param (current pattern), (b) cookie-based auth, (c) initial handshake via fetch then upgrade. Query param is simplest and consistent with current dashboard auth.
2. **Offline support.** Should the dashboard work offline with cached data? Service worker + IndexedDB would enable this, but adds significant complexity. Recommend: no offline support for v1, show clear "disconnected" state.
3. **Multi-fleet.** The dashboard currently serves one fleet. If the user manages multiple fleets, should there be a fleet switcher? Defer until needed.
