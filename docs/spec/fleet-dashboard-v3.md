# Fleet Dashboard v3 — Design Specification

This is the north star document for the fleet dashboard redesign. Every design decision and its reasoning is documented here. No code is written before this spec is reviewed and locked.

---

## 1. Goals & Success Criteria

**Goal:** Real-time fleet health awareness and ability to act on problems without switching to Discord or a terminal.

**Success criteria:**

| ID | Criterion | How to verify |
|----|-----------|---------------|
| SC1 | A user on a 375px phone can triage the fleet in 10 seconds without scrolling or tapping | Load dashboard on iPhone SE viewport. All KPI numbers + alert state + agent status visible in first viewport. |
| SC2 | Status changes appear within 5 seconds, no manual reload | Agent updates task status via CLI → dashboard reflects change within 5s. Measured with stopwatch. |
| SC3 | 5 key actions are available directly from the dashboard | Restart agent, reassign task, change task status, create task, close sprint — all achievable without leaving the dashboard. |
| SC4 | Zero-context readable — a person seeing the dashboard for the first time understands what they're looking at | No jargon without labels. Status indicators use triple encoding (color + shape + text). Every number has a label. |

---

## 2. Users & Use Cases

### User Tiers

| Tier | User | Relationship | Default view | Primary question |
|------|------|-------------|-------------|-----------------|
| 1 | Fleet lead | Assigns work, triages blockers | Panel A (Health) | "Who is stuck and what should I reassign?" |
| 2 | Project owner / boss | Checks overall progress | Panel B (Progress) | "Is the team making progress on what I asked for?" |
| 3a | Reviewer | Reviews PRs, validates quality | Board (filtered to review) | "What's in my review queue?" |
| 3b | Ops | Monitors infrastructure | Panel A (Health) | "Is everything running?" |

### Interaction Modes

**Quick check (30 seconds):** Triggered by habit (morning check), notification, or idle glance. Needs: KPI strip + alert banner + agent status list. One screen, no interaction. Answer: "everything fine" or "something needs attention."

**Deep investigation (5+ minutes):** Triggered by a red flag from the quick check. Needs: expand agent card, open task detail, check timeline, restart agent or reassign task. Interactive, multi-view.

### Key Insight

Most dashboards mix operational health and project progress into one view and confuse both audiences. This dashboard separates them:

- **Panel A (Health)** — "are the agents working?" Agent status, blocked tasks, errors, uptime. Lead and Ops live here.
- **Panel B (Progress)** — "what are we building and how far along?" Sprint burn, tasks completed, what shipped recently. Boss lives here. Doesn't need to know which agent did what.

---

## 3. Information Architecture

### Navigation

4-tab bottom nav (mobile) / top nav (desktop):

```
[ Health ] [ Progress ] [ Board ] [ Timeline ]
```

All 4 tabs always visible — no conditional tab count, no layout shift.

### Panel A — Health (default for lead/ops)

**Above fold (375px, no scroll):**

```
┌─────────────────────────────┐
│ Fleet Dashboard    Live 12s │  header
├─────────────────────────────┤
│ 4 online  1 blocked  12 act│  KPI strip (4 numbers)
├─────────────────────────────┤
│ ⚠ Carmack: ssh_timeout      │  alert banner (only if alerts)
│   retry 2/5 • needs human   │
├─────────────────────────────┤
│ ● Carmack   task-153  25m  │  agent rows (collapsed)
│ ● Ken       task-125  1h   │
│ ● Knuth     task-034  40m  │
│ ○ Linus     idle           │
└─────────────────────────────┘
```

**KPI strip (4 numbers max):**
1. Agents online (green number)
2. Blocked tasks (red number, 0 = gray)
3. Active tasks (neutral number)
4. Done today (neutral number)

**Agent rows (collapsed, 5-7 data points):**
- Status indicator (dot: color + shape)
- Agent name
- Current task ID + title (truncated)
- Elapsed time on current task
- Error badge (count, severity color) — only if errors exist

**Agent rows (expanded, tap to reveal):**
- Role, server, heartbeat age
- Watchdog: consecutive failures, last restart
- Classified errors: category, message, recovery hint, needs-human flag
- All active tasks: ID, title, priority badge, status badge, elapsed
- Last action: task ID, text, time ago
- Footer: done today, events today

**Alert banner:**
- Only rendered when alerts exist — no phantom "0 errors" clutter
- Severity-colored border (red = critical/fatal, amber = warning)
- Content: agent name, error category, recovery action, needs-human flag
- Dismissible per alert

### Panel B — Progress (default for boss)

**Above fold:**

```
┌─────────────────────────────┐
│ Fleet Dashboard    Live 12s │
├─────────────────────────────┤
│ Sprint 3        ████░░ 67% │  sprint bar + name
│ ☑ Auth endpoint  ☑ Deploy   │  goals checklist
│ ☐ Dashboard v3              │
├─────────────────────────────┤
│ Completed today (4)         │  recent completions
│  task-153 Quality standards │
│  task-103 Auto STATUS.md    │
│  task-126 Status vocabulary │
│  task-125 Sprint support    │
├─────────────────────────────┤
│ ■■■■ 12 done  ■■ 4 active  │  status distribution bar
│ ■ 1 blocked  ■■ 3 open     │
└─────────────────────────────┘
```

**Sprint section:**
- Sprint name + date range + days remaining
- Progress bar (done/total with percentage)
- Goals checklist (checked/unchecked) — from `sprint.goals`

**Recently completed:**
- Tasks completed in last 24h, newest first
- Task ID + title + assignee

**Status distribution:**
- Horizontal stacked bar or simple counts by status
- Blocked count prominent (red) if > 0

**Empty state (no active sprint):**
- "No active sprint" headline
- "Create Sprint" CTA button

### Board & Timeline

Shared views for deep investigation. Both audiences use these when the quick check surfaces something that needs digging.

**Board:** 6-column Kanban (verify → review → in_progress → blocked → open → backlog). Mobile: swipe between columns. Desktop: all visible. Drag-and-drop for status changes. "+" to create task.

**Timeline:** Horizontal Gantt (desktop) / vertical (mobile). Agent rows with status-colored task blocks. Time range selector (4h/8h/12h/24h).

---

## 4. UI/UX Design

### Visual Language

**Background:** Dark (slate-900 `#0f172a`). High contrast for readability. Matches Vercel's approach — white on dark is WCAG AAA.

**Semantic colors (4 + 1 accent):**

| Color | Hex | Usage |
|-------|-----|-------|
| Green | `#22c55e` | Alive, done, success |
| Amber | `#eab308` | Stale, warning, in review |
| Red | `#ef4444` | Dead, blocked, error, critical |
| Gray | `#6b7280` | Off, unknown, inactive |
| Blue | `#3b82f6` | Accent (links, active tab, primary action) |

No other colors. Every color carries meaning.

**Typography scale (4px base):**

| Level | Size | Weight | Usage |
|-------|------|--------|-------|
| KPI | 28px | Bold | Headline numbers in KPI strip |
| Section | 16px | Semibold | Section headings |
| Body | 14px | Regular | Card content, labels |
| Caption | 12px | Regular | Metadata, timestamps, secondary info |
| Mono | 12px | Regular (monospace) | Task IDs, technical values |

**Spacing:** 4px base unit. Scale: 4, 8, 12, 16, 24, 32, 48px. Card padding: 12px. Gap between cards: 8px. Section gap: 24px.

### Status Indicators — Triple Encoding

Every status uses 3 redundant channels so it's readable in grayscale and by colorblind users:

| Status | Color | Shape | Label |
|--------|-------|-------|-------|
| Alive | Green | Filled circle | "online" |
| Stale | Amber | Half-filled circle | "stale" |
| Dead | Red | X in circle | "dead" |
| Off | Gray | Empty circle | "offline" |
| Blocked | Red | Square (stop) | "blocked" |
| In Progress | Green | Rotating arrow | "active" |
| Review | Amber | Eye icon | "review" |
| Done | Green | Checkmark | "done" |

**Size:** 10px inline in agent rows, 16px in KPI strip.

**Card status accent:** 3px left border in status color (Grafana pattern). Provides scannable colored edge without requiring users to parse individual icons.

### Interactions

**Actions use bottom sheets, not modals.** Bottom sheets slide up from the bottom on mobile — thumb-reachable, doesn't obscure context. On desktop, renders as a popover near the trigger element.

**Swipe-to-act:** Single swipe-left gesture on agent card reveals the most common action for that state:
- Alive agent → "Restart"
- Blocked task → "Reassign"
- Review task → "Approve"

**No confirmation dialogs.** The swipe gesture IS the confirmation — it requires intentional horizontal motion, which is distinct from scrolling. Undo toast appears for 5 seconds after action.

### Loading States

**Skeleton screens, not spinners.** Content-shaped shimmer placeholders:
- KPI strip: 4 rectangular shimmer blocks
- Agent rows: 4-5 line-height shimmer rows
- Cards: rounded rectangle shimmer

**Timing:** 200ms delay before showing skeleton (prevents flicker on fast loads). 300ms minimum display time (prevents flash).

### Empty States

Every component has a designed empty state:
- Headline explaining what would be here ("No agents registered")
- Secondary text with context ("Agents appear here when they connect")
- CTA if applicable ("Add agent" button)

---

## 5. Data & API Contracts

### Endpoint Response Shapes

Every response shape is documented. The frontend must handle each shape defensively.

**`GET /agents/summary`** (no auth, cached, <100ms response)
```typescript
{
  agents: Agent[],
  updatedAt: string | null   // ISO timestamp of last cache refresh
}
```

**`GET /tasks`** (auth required)
```typescript
Task[]   // Raw array, sorted by updatedAt desc
```

**`GET /activity?since=4h&limit=50`** (no auth)
```typescript
{
  events: ActivityEvent[],
  since: string              // ISO timestamp of cutoff
}
```

**`GET /sprints/current`** (no auth)
```typescript
{
  sprint: Sprint,
  stats: { done: number, total: number, blocked: number },
  tasks: Task[]
} | null                     // null when no active sprint
```

**`GET /tasks/stats`** (no auth, also used for token validation)
```typescript
{
  total: number,
  byStatus: Record<TaskStatus, number>,
  byAssignee: Record<string, number>,
  byProject: Record<string, number>,
  completedToday: number
}
```

**`PATCH /tasks/:id`** (auth required)
```typescript
// Request body:
{ status?: TaskStatus, assignee?: string, note?: string, blockedReason?: string }

// Response:
Task                         // Updated task object
```

**`POST /tasks`** (auth required)
```typescript
// Request body:
{ title: string, assignee?: string, priority?: TaskPriority, description?: string, status?: "open" | "backlog", sprintId?: string }

// Response:
Task                         // Created task object (201)
```

**`POST /agents/:name/restart`** (auth required)
```typescript
{ agent: string, status: string, session: string }
```

### Defensive Handling Rules

1. Every fetch call has individual `.catch(() => fallback)` — never crashes on network error
2. Every response is validated: `Array.isArray(res.agents) ? res.agents : []`
3. Every store selector uses `?? []` for array fields
4. Nested objects use optional chaining: `agent.heartbeat?.ageSec`

---

## 6. Connection & State Model

### SSE Implementation

**Library:** `@microsoft/fetch-event-source` instead of native `EventSource`.

**Why:** Native EventSource doesn't support custom headers (Bearer auth), doesn't support POST, and has no backoff hooks. `fetch-event-source` provides all three while maintaining the same event model.

**Caddy configuration:** Add `flush_interval -1` to the reverse_proxy block for `/events` — Caddy must not buffer SSE responses.

### Event Types

```
event: task:created       data: { task: Task }
event: task:updated       data: { task: Task, changes: string[] }
event: task:status        data: { taskId, from, to, agent }
event: task:assigned      data: { taskId, from?, to }
event: agent:heartbeat    data: { agent, state, ageSec }
event: agent:status       data: { agent, status }
event: agent:error        data: { agent, error: ClassifiedError }
event: agent:restart      data: { agent, by }
event: sprint:created     data: { sprint }
event: sprint:closed      data: { sprint }
event: system:ping        data: { ts }
```

**Event IDs:** Every event includes a monotonic `id:` field. On reconnect, the client sends `Last-Event-ID` — the server replays missed events from that point.

### Connection State Machine

```
CONNECTED (green dot, "Live Xs")
    ↓ connection lost
SILENT (0-2s, no indicator change — prevents flicker)
    ↓ still disconnected after 2s
DEGRADED (yellow banner: "Reconnecting...")
    ↓ still disconnected after 2min
OFFLINE (red banner: "Connection lost. Last updated: HH:MM:SS")
    ↓ connection restored at any point
RECONNECTING → full REST refetch → resume SSE deltas → CONNECTED
```

**Header always shows:** "Last updated: HH:MM:SS" — even when connected. This is the user's trust anchor.

### Tab Visibility Optimization

- Tab hidden (`visibilitychange` event) → close SSE connection, switch to 30-second REST poll
- Tab visible → reopen SSE, full refetch to catch up
- Prevents browser from throttling SSE in background tabs and wasting battery on mobile

### State Management (Zustand)

```typescript
interface FleetStore {
  // Data
  agents: Agent[]
  tasks: Task[]
  activity: ActivityEvent[]
  sprints: Sprint[]
  alerts: ClassifiedError[]

  // Connection
  connected: boolean
  connectionState: "connected" | "silent" | "degraded" | "offline"
  lastUpdatedTs: string | null

  // UI
  view: "health" | "progress" | "board" | "timeline"
  loading: boolean

  // Actions
  reset: () => void
  fetchAll: () => Promise<void>
  updateTask: (task: Task) => void
  updateAgent: (partial: Partial<Agent> & { name: string }) => void
  pushActivity: (event: ActivityEvent) => void
  pushAlert: (error: ClassifiedError) => void
  dismissAlert: (index: number) => void
  setView: (view: View) => void
}
```

**Invariant:** Array fields are initialized as `[]` and never set to `null`/`undefined`. The `reset()` action restores all fields to initial values.

---

## 7. Auth

### Current Implementation

1. **Login screen:** Single password field + "Sign in" button. Centered, minimal.
2. **Validation:** `GET /tasks/stats` with `Authorization: Bearer <token>`. 200 = valid, anything else = "Invalid token" error.
3. **Storage:** `localStorage("fleet_token")`. Read on every API call for instant sign-out effect.
4. **Sign-out:** Clears localStorage, calls `store.reset()`, returns to login screen.
5. **URL param support:** `?token=xyz` auto-saves to localStorage and strips from URL (backward compatible).

### Future Migration

Before external users: migrate from localStorage token to cookie-based auth or handshake-ticket pattern. The current approach exposes the token in browser dev tools, which is acceptable for internal use but not for external access.

---

## 8. Error Handling & Resilience

### API Layer

```typescript
// Every fetch: individual catch, never crashes
const agents = await api.fetchAgents().catch(() => [])
const tasks = await api.fetchTasks().catch(() => [])

// Every response: shape validation
const res = await get<{ agents: Agent[] }>("/agents/summary")
return Array.isArray(res.agents) ? res.agents : []
```

### Store Layer

```typescript
// Every selector: null guard
const agents = useFleetStore((s) => s.agents ?? [])

// Every nested access: optional chaining
agent.heartbeat?.ageSec
agent.watchdog?.consecutiveFailures
agent.dailyStats?.completed ?? 0
```

### Component Layer

Every component renders 3 states:

| State | What shows | Trigger |
|-------|-----------|---------|
| Loading | Skeleton shimmer | `loading === true` |
| Empty | Headline + CTA | Data array is empty |
| Error | Message + retry button | Fetch failed |

**Alert banner:** Only rendered when `alerts.length > 0`. No phantom empty state.

### Crash Prevention Principle

The dashboard must never show a white screen. If every API call fails, every endpoint returns garbage, and the SSE connection never connects — the dashboard should show: login screen → empty state with "No data available" → retry button. No uncaught exceptions. No `.map()` on undefined.

---

## 9. Performance Targets

| Metric | Target | How to measure |
|--------|--------|----------------|
| First meaningful paint | <2s on 4G | Lighthouse throttled to Slow 4G |
| SSE event → UI update | <200ms | Timestamp diff: event.ts vs Date.now() at render |
| JS bundle (gzipped) | <100KB | `vite build` output |
| CSS bundle (gzipped) | <10KB | `vite build` output |
| Total transfer (first load) | <250KB | Network tab, cache disabled |
| Agent cards visible without scroll | >=3 | iPhone SE (375px) viewport test |
| Memory (steady state) | <50MB | Chrome DevTools Memory tab after 10min |
| Activity feed cap | 200 events max | Zustand store `.slice(0, 200)` |

### Bundle Budget

Current: 230KB JS (70KB gzip). Target: under 100KB gzip. Strategies:
- Tree-shake unused Zustand features
- Lazy-load Board and Timeline views (`React.lazy`)
- Evaluate whether TailwindCSS JIT produces smaller output than current

---

## 10. Technology & Architecture

### Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| UI framework | React 19 | Team expertise from SysBuilder. Component model suits card layouts. |
| Build tool | Vite | Fast HMR, single static bundle output. |
| State | Zustand | Proven in SysBuilder chat panel. Lightweight, SSE-friendly. |
| Styling | TailwindCSS | Utility-first, built-in responsive breakpoints, small output with JIT. |
| SSE client | @microsoft/fetch-event-source | Bearer auth support, backoff hooks, Last-Event-ID. |
| Server | Bun (fleet binary) | Serves API + static dashboard from single process. |

### File Structure

```
src/dashboard/
  index.html
  vite.config.ts
  tailwind.config.js
  tsconfig.json
  package.json
  src/
    main.tsx
    App.tsx
    lib/
      api.ts              # REST client, token management
      types.ts            # All TypeScript interfaces
      format.ts           # Time formatting, truncation
      sse.ts              # fetch-event-source wrapper
    hooks/
      use-fleet-store.ts  # Zustand store
      use-connection.ts   # SSE + connection state machine
    components/
      LoginScreen.tsx
      layout/
        Shell.tsx          # Responsive wrapper
        BottomNav.tsx      # Mobile 4-tab nav
        TopNav.tsx         # Desktop nav + sign out
        ConnectionBanner.tsx # Yellow/red degraded/offline banner
      health/              # Panel A
        HealthView.tsx
        KpiStrip.tsx
        AlertBanner.tsx
        AgentRow.tsx       # Collapsed + expanded
        AgentDetail.tsx    # Expanded content
      progress/            # Panel B
        ProgressView.tsx
        SprintBar.tsx
        GoalsChecklist.tsx
        RecentCompletions.tsx
        StatusDistribution.tsx
      board/
        BoardView.tsx
        BoardColumn.tsx
        TaskCard.tsx
        CreateTaskForm.tsx
      timeline/
        TimelineView.tsx
        TimelineBlock.tsx
      shared/
        Skeleton.tsx       # Reusable skeleton loader
        EmptyState.tsx     # Reusable empty state
        StatusIndicator.tsx # Triple-encoded status (color+shape+text)
        PriorityBadge.tsx
        BottomSheet.tsx    # Action sheet (mobile) / popover (desktop)
        UndoToast.tsx      # Post-action undo
```

### Serving Model

The fleet binary (Bun) serves the dashboard:
- `GET /dashboard` → serves `src/dashboard/dist/index.html`
- `GET /dashboard/*` → serves static assets from `dist/`
- All API endpoints on the same origin — no CORS needed
- Dashboard build checked per-request using `existsSync` (not cached at module load) so rebuilds take effect without server restart

---

## 11. Testing & Verification Gate

### Before Every Commit

1. `npm run build` passes with no errors
2. Dashboard renders locally against live API (`vite dev` with proxy to `:4680`)
3. Login → Operations view shows agent data → Board view shows tasks
4. Zero console errors (no TypeError, no unhandled promise rejection)
5. Mobile viewport test: 375px width, no horizontal scroll, >=3 agent rows visible

### Review Checklist (Knuth)

- [ ] Every `.map()`, `.filter()`, `.some()`, `.find()` call has a guarded source (`?? []`)
- [ ] Every status indicator uses triple encoding (color + shape + text)
- [ ] Every component has loading, empty, and error states
- [ ] No unguarded nested property access (use `?.` on heartbeat, watchdog, dailyStats)
- [ ] Actions use bottom sheet pattern, not modal
- [ ] Dark theme contrast: all text meets WCAG AA (4.5:1 ratio)

### E2E Test Path

```
1. Open dashboard → login screen appears
2. Enter invalid token → "Invalid token" error
3. Enter valid token → Operations view loads
4. KPI strip shows correct counts
5. Agent rows show current tasks
6. Expand agent card → detail visible
7. Switch to Progress tab → sprint info loads
8. Switch to Board tab → tasks in columns
9. Drag task between columns → status updates
10. Sign out → login screen, store cleared
```

### Zero Tolerance Rule

"Compiles and passes type-check" is not done. "Renders against live API with no console errors and all user flows work" is done. Every commit must be verified against real data before pushing.

---

## Decisions Log

| Decision | Chosen | Rejected | Why |
|----------|--------|----------|-----|
| Panel split | A (Health) + B (Progress) | Single mixed view | Different audiences, different questions. Mixing confuses both. |
| Navigation | 4-tab bottom nav (always visible) | Hamburger menu / conditional tabs | Mobile: thumb-reachable. Always visible: no layout shift. |
| Status encoding | Triple (color + shape + text) | Color only | 8% of males are colorblind. Grayscale must work. |
| Actions | Bottom sheet + swipe | Modal with confirm button | Thumb-reachable, faster, no confirmation fatigue. |
| SSE library | @microsoft/fetch-event-source | Native EventSource | Bearer auth, backoff hooks, Last-Event-ID support. |
| Loading | Skeleton screens | Spinners | 20-30% lower perceived load time. Content-aware placeholders. |
| Background | Dark (slate-900) | Light | Higher contrast, better readability for status colors, matches Vercel research. |
| Card expansion | Collapsed by default (mobile) | Always expanded | 5 agents = 5 lines (collapsed) vs 5 screens (expanded). Quick check in one viewport. |
| Store guards | `?? []` on every selector | Trust initial state | Server responses can override initial state with null. Defense in depth. |
| Confirmation | No dialogs, undo toast | Confirm/Cancel dialogs | Swipe gesture is intentional. Undo is faster than asking permission. |
