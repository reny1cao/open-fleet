/**
 * Timeline View — Gantt-lite visualization of agent task activity.
 * Horizontal time axis, one row per agent, task blocks colored by status.
 *
 * Usage: renderTimeline(container, tasks, agents, { hours: 24 })
 *
 * Expects:
 *   tasks: Task[] from GET /tasks (with notes[] containing status_change events)
 *   agents: Agent[] from GET /agents (with name, role, status, activeTasks)
 *
 * Renders into the given container element as self-contained HTML+CSS.
 */

// ── Status colors (matches dashboard theme) ──
const TL_STATUS_COLORS = {
  in_progress: 'var(--accent)',
  review:      'var(--purple)',
  verify:      'var(--cyan)',
  done:        'var(--green)',
  blocked:     'var(--red)',
  open:        'var(--yellow)',
  backlog:     'var(--text-muted)',
  cancelled:   'var(--text-muted)',
};

// ── CSS for timeline view ──
const TIMELINE_CSS = `
.tl-container {
  padding: 16px 24px;
  overflow-x: auto;
  overflow-y: auto;
  height: 100%;
}

.tl-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.tl-header h2 {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}

.tl-range-btns {
  display: flex;
  gap: 4px;
}

.tl-range-btn {
  background: none;
  border: 1px solid var(--border);
  color: var(--text-muted);
  padding: 3px 10px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  font-family: ui-monospace, monospace;
}

.tl-range-btn:hover { color: var(--text); background: var(--surface-hover); }
.tl-range-btn.active { color: var(--text); border-color: var(--accent); background: var(--surface-hover); }

.tl-chart {
  position: relative;
  min-width: 800px;
}

.tl-time-axis {
  display: flex;
  margin-left: 140px;
  border-bottom: 1px solid var(--border);
  padding-bottom: 4px;
  margin-bottom: 2px;
}

.tl-time-label {
  font-size: 10px;
  font-family: ui-monospace, monospace;
  color: var(--text-muted);
  text-align: center;
  flex: 1;
  min-width: 0;
}

.tl-row {
  display: flex;
  align-items: center;
  height: 36px;
  border-bottom: 1px solid var(--border);
}

.tl-row:hover { background: var(--surface-hover); }

.tl-agent-label {
  width: 140px;
  flex-shrink: 0;
  padding: 0 12px;
  font-size: 12px;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tl-agent-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.tl-track {
  flex: 1;
  position: relative;
  height: 24px;
  min-width: 0;
}

.tl-block {
  position: absolute;
  height: 18px;
  top: 3px;
  border-radius: 3px;
  cursor: pointer;
  min-width: 4px;
  display: flex;
  align-items: center;
  padding: 0 4px;
  overflow: hidden;
  font-size: 10px;
  font-family: ui-monospace, monospace;
  color: rgba(255,255,255,0.9);
  transition: opacity 0.15s;
}

.tl-block:hover {
  opacity: 0.85;
  z-index: 10;
}

.tl-block-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tl-now-line {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--red);
  z-index: 5;
  pointer-events: none;
}

.tl-now-label {
  position: absolute;
  top: -16px;
  font-size: 9px;
  color: var(--red);
  font-family: ui-monospace, monospace;
  transform: translateX(-50%);
}

.tl-empty {
  text-align: center;
  color: var(--text-muted);
  padding: 40px;
  font-size: 13px;
}

.tl-tooltip {
  position: fixed;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 11px;
  z-index: 1000;
  pointer-events: none;
  max-width: 300px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
}

.tl-tooltip-title { font-weight: 600; margin-bottom: 2px; }
.tl-tooltip-meta { color: var(--text-muted); font-family: ui-monospace, monospace; }

/* Boot-check status indicator */
.tl-boot-status {
  font-size: 9px;
  padding: 1px 5px;
  border-radius: 3px;
  font-family: ui-monospace, monospace;
}

.tl-boot-ok { background: rgba(63,185,80,0.15); color: var(--green); }
.tl-boot-warn { background: rgba(210,153,34,0.15); color: var(--yellow); }
.tl-boot-fail { background: rgba(248,81,73,0.15); color: var(--red); }
`;

/**
 * Extract time spans for each task per agent from task notes.
 * Returns: { agentName: [{ taskId, title, status, start, end, priority }] }
 */
function extractTaskSpans(tasks) {
  const spans = {};

  for (const task of tasks) {
    if (!task.assignee) continue;
    const agent = task.assignee;
    if (!spans[agent]) spans[agent] = [];

    // Build status timeline from notes
    const statusChanges = task.notes
      .filter(n => n.type === 'status_change')
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    if (statusChanges.length === 0) {
      // No status changes — use createdAt → now or completedAt
      const start = new Date(task.startedAt || task.createdAt);
      const end = task.completedAt ? new Date(task.completedAt) : new Date();
      spans[agent].push({
        taskId: task.id,
        title: task.title,
        status: task.status,
        priority: task.priority,
        start,
        end,
      });
      continue;
    }

    // Create a span for each status period
    for (let i = 0; i < statusChanges.length; i++) {
      const change = statusChanges[i];
      const nextChange = statusChanges[i + 1];
      const status = change.newValue || task.status;
      const start = new Date(change.timestamp);
      const end = nextChange ? new Date(nextChange.timestamp) : (task.completedAt ? new Date(task.completedAt) : new Date());

      // Skip done/cancelled spans (they're endpoints, not active work)
      if (status === 'done' || status === 'cancelled') continue;

      spans[agent].push({
        taskId: task.id,
        title: task.title,
        status,
        priority: task.priority,
        start,
        end,
      });
    }
  }

  return spans;
}

/**
 * Generate time axis labels for a given range.
 */
function generateTimeLabels(startTime, endTime, count) {
  const labels = [];
  const step = (endTime - startTime) / count;
  for (let i = 0; i <= count; i++) {
    const t = new Date(startTime + step * i);
    const h = t.getHours().toString().padStart(2, '0');
    const m = t.getMinutes().toString().padStart(2, '0');
    labels.push(`${h}:${m}`);
  }
  return labels;
}

/**
 * Main render function.
 * @param {HTMLElement} container
 * @param {Task[]} tasks
 * @param {Agent[]} agents
 * @param {{ hours?: number, onRestart?: (name) => void, bootStatus?: Record<string, string> }} opts
 */
function renderTimeline(container, tasks, agents, opts = {}) {
  const hours = opts.hours || 12;
  const now = Date.now();
  const startTime = now - hours * 60 * 60 * 1000;
  const endTime = now;
  const totalMs = endTime - startTime;

  // Inject CSS once
  if (!document.getElementById('tl-styles')) {
    const style = document.createElement('style');
    style.id = 'tl-styles';
    style.textContent = TIMELINE_CSS;
    document.head.appendChild(style);
  }

  const taskSpans = extractTaskSpans(tasks);
  const agentNames = agents.map(a => a.name);

  // Ensure all agents have a row even if no tasks
  for (const name of agentNames) {
    if (!taskSpans[name]) taskSpans[name] = [];
  }

  const timeLabels = generateTimeLabels(startTime, endTime, Math.min(hours, 12));
  const nowPct = 100; // now is always at the right edge

  // Range buttons
  const ranges = [4, 8, 12, 24];

  let html = `
    <div class="tl-container">
      <div class="tl-header">
        <h2>Timeline — last ${hours}h</h2>
        <div class="tl-range-btns">
          ${ranges.map(h => `
            <button class="tl-range-btn ${h === hours ? 'active' : ''}" data-hours="${h}">${h}h</button>
          `).join('')}
        </div>
      </div>
      <div class="tl-chart">
        <div class="tl-time-axis">
          ${timeLabels.map(l => `<div class="tl-time-label">${l}</div>`).join('')}
        </div>
  `;

  for (const agent of agents) {
    const name = agent.name;
    const spans = taskSpans[name] || [];
    const statusColor = agent.status === 'alive' ? 'var(--green)' :
                        agent.status === 'stale' ? 'var(--yellow)' : 'var(--text-muted)';

    // Boot-check status
    const bootStatus = opts.bootStatus?.[name];
    const bootBadge = bootStatus === 'pass' ? '<span class="tl-boot-status tl-boot-ok">boot:ok</span>' :
                      bootStatus === 'warn' ? '<span class="tl-boot-status tl-boot-warn">boot:warn</span>' :
                      bootStatus === 'fail' ? '<span class="tl-boot-status tl-boot-fail">boot:fail</span>' : '';

    // Restart button
    const restartBtn = opts.onRestart
      ? `<button class="tl-restart-btn" data-agent="${name}" title="Restart ${name}" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:11px;padding:0 4px;">↻</button>`
      : '';

    html += `
      <div class="tl-row">
        <div class="tl-agent-label">
          <span class="tl-agent-dot" style="background:${statusColor}"></span>
          <span>${name.split('-').pop()}</span>
          ${bootBadge}
          ${restartBtn}
        </div>
        <div class="tl-track">
    `;

    for (const span of spans) {
      const spanStart = Math.max(span.start.getTime(), startTime);
      const spanEnd = Math.min(span.end.getTime(), endTime);
      if (spanEnd <= spanStart) continue;

      const leftPct = ((spanStart - startTime) / totalMs) * 100;
      const widthPct = ((spanEnd - spanStart) / totalMs) * 100;
      const color = TL_STATUS_COLORS[span.status] || 'var(--text-muted)';
      const label = widthPct > 5 ? span.title : '';

      html += `
        <div class="tl-block"
             style="left:${leftPct}%;width:${widthPct}%;background:${color}"
             data-task-id="${span.taskId}"
             data-title="${span.title.replace(/"/g, '&quot;')}"
             data-status="${span.status}"
             data-start="${span.start.toISOString()}"
             data-end="${span.end.toISOString()}"
             data-priority="${span.priority}">
          <span class="tl-block-label">${label}</span>
        </div>
      `;
    }

    // Now line
    html += `
          <div class="tl-now-line" style="left:${nowPct}%">
            <span class="tl-now-label">now</span>
          </div>
        </div>
      </div>
    `;
  }

  html += `
      </div>
    </div>
  `;

  if (agents.length === 0) {
    html = '<div class="tl-empty">No agents configured</div>';
  }

  container.innerHTML = html;

  // ── Event handlers ──

  // Range buttons
  container.querySelectorAll('.tl-range-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const h = parseInt(btn.dataset.hours);
      renderTimeline(container, tasks, agents, { ...opts, hours: h });
    });
  });

  // Restart buttons
  if (opts.onRestart) {
    container.querySelectorAll('.tl-restart-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const name = btn.dataset.agent;
        if (confirm(`Restart agent ${name}?`)) {
          btn.textContent = '⟳';
          btn.disabled = true;
          opts.onRestart(name);
        }
      });
    });
  }

  // Block tooltips
  const tooltip = document.createElement('div');
  tooltip.className = 'tl-tooltip';
  tooltip.style.display = 'none';
  document.body.appendChild(tooltip);

  container.querySelectorAll('.tl-block').forEach(block => {
    block.addEventListener('mouseenter', (e) => {
      const start = new Date(block.dataset.start);
      const end = new Date(block.dataset.end);
      const durationMs = end - start;
      const durationMin = Math.round(durationMs / 60000);
      const durationStr = durationMin >= 60 ? `${Math.floor(durationMin/60)}h ${durationMin%60}m` : `${durationMin}m`;

      tooltip.innerHTML = `
        <div class="tl-tooltip-title">${block.dataset.title}</div>
        <div class="tl-tooltip-meta">
          ${block.dataset.taskId} · ${block.dataset.status} · ${block.dataset.priority}<br>
          ${start.toLocaleTimeString()} → ${end.toLocaleTimeString()} (${durationStr})
        </div>
      `;
      tooltip.style.display = 'block';
    });

    block.addEventListener('mousemove', (e) => {
      tooltip.style.left = (e.clientX + 12) + 'px';
      tooltip.style.top = (e.clientY - 10) + 'px';
    });

    block.addEventListener('mouseleave', () => {
      tooltip.style.display = 'none';
    });
  });
}

// ── Restart API helper ──
async function restartAgent(agentName, token) {
  const resp = await fetch(`/agents/${agentName}/restart`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
  });
  return resp.json();
}
