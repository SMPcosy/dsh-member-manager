    const ORGMAP_VERSION = 2;
    const ORGMAP_MAX_EDGES = 12;
    // 并联（同层兄弟）横向排列，串联（父→子）纵向连接：
    //   第 1 层 = 大总管；第 2 层 = 分组色块（横向并联）；第 3 层 = 各组组内成员（组内横向并联）。
    // 层与层之间用竖直总线连接，同层之间不画线。
    const ORGMAP_CARD_W = 188;
    const ORGMAP_LEAD_W = 230;
    // 右侧边栏 tab：类型 id 全注册唯一，kind 是 openTab 的页面身份。
    const ORGMAP_TAB_ID = "dsh-plugin-member-manager/orgmap";
    const ORGMAP_TAB_KIND = "member-orgmap";

    const ORGMAP_CSS = [
      "#mm-orgchart-root{position:relative;width:100%;height:100%;min-height:0;display:flex;",
      "flex-direction:column;font:12px/1.45 ui-sans-serif,system-ui,'Segoe UI','Microsoft YaHei',sans-serif;",
      "color:#1f2328;background:transparent;overflow:hidden}",
      "#mm-orgchart-root[data-embedded='1']{border:none;border-radius:0;box-shadow:none}",
      ".mmo-canvas{flex:1;min-height:0;overflow:auto;padding:8px 10px 4px;position:relative}",
      ".mmo-stage{position:relative;width:max-content;min-width:100%;padding:2px 4px 10px;box-sizing:border-box}",
      ".mmo-svg{position:absolute;left:0;top:0;pointer-events:none;overflow:visible;z-index:0}",
      ".mmo-lead-row{position:relative;z-index:1;display:flex;justify-content:center}",
      ".mmo-lead-row .mmo-card{width:" + ORGMAP_LEAD_W + "px}",
      ".mmo-groups{position:relative;z-index:1;display:flex;align-items:flex-start;justify-content:center;",
      "gap:28px;margin-top:38px}",
      ".mmo-cluster{display:flex;flex-direction:column;align-items:center;gap:12px}",
      ".mmo-chip{display:inline-flex;align-items:center;gap:6px;border-radius:7px;padding:3px 8px;",
      "font-size:11px;font-weight:600;color:#fff;background:#2f6feb;box-shadow:0 1px 2px rgba(23,32,46,.12);",
      "white-space:nowrap}",
      ".mmo-chip[data-gi='0']{background:#2f6feb}.mmo-chip[data-gi='1']{background:#b45309}",
      ".mmo-chip[data-gi='2']{background:#1a7f37}.mmo-chip[data-gi='3']{background:#8250df}",
      ".mmo-chip[data-gi='4']{background:#0e7490}.mmo-chip[data-gi='5']{background:#b42318}",
      ".mmo-chip-count{background:rgba(255,255,255,.24);border-radius:999px;padding:0 5px;font-size:10px;font-weight:500}",
      ".mmo-members{display:flex;align-items:stretch;gap:10px}",
      ".mmo-card{box-sizing:border-box;width:" + ORGMAP_CARD_W + "px;border:1px solid rgba(31,35,40,.14);",
      "border-radius:9px;padding:6px 8px;background:#fff;position:relative;transition:border-color .2s,box-shadow .2s}",
      ".mmo-card[data-active='1']{border-color:rgba(47,111,235,.55);box-shadow:0 0 0 2px rgba(47,111,235,.12)}",
      ".mmo-card[data-running='1']{background:linear-gradient(180deg,rgba(47,111,235,.06),#fff)}",
      ".mmo-row1{display:flex;align-items:center;gap:5px;min-width:0}",
      ".mmo-dot{width:7px;height:7px;border-radius:50%;background:#b8bfc7;flex:none}",
      ".mmo-dot[data-state='running']{background:#1a7f37;animation:mmo-pulse 1.4s ease-in-out infinite}",
      ".mmo-dot[data-state='idle']{background:#8c959f}",
      ".mmo-name{font-weight:600;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".mmo-model{font-size:10px;color:#6b747e;background:#f3f5f8;border-radius:5px;padding:1px 4px;",
      "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:110px;flex:none}",
      ".mmo-task{font-size:11px;color:#4a525b;margin-top:3px;display:-webkit-box;-webkit-line-clamp:2;",
      "-webkit-box-orient:vertical;overflow:hidden}",
      ".mmo-task[data-empty='1']{color:#9aa2ab}",
      ".mmo-meta{display:flex;gap:6px;margin-top:3px;font-size:10px;color:#6b747e;flex-wrap:wrap}",
      ".mmo-badge{font-size:9px;border-radius:4px;padding:0 4px;background:rgba(47,111,235,.12);color:#2f6feb}",
      ".mmo-ok{background:rgba(26,127,55,.12);color:#1a7f37}",
      ".mmo-foot{flex:none;display:flex;gap:10px;flex-wrap:wrap;padding:2px 12px 6px;font-size:10px;color:#6b747e}",
      ".mmo-fail{display:none;padding:2px 12px 4px;color:#b42318;font-size:11px}",
      ".mmo-branch{fill:none;stroke:rgba(100,116,139,.55);stroke-width:1.2;stroke-linejoin:round;stroke-linecap:round}",
      ".mmo-edge{fill:none;stroke:rgba(47,111,235,.5);stroke-width:1.4;stroke-linejoin:round}",
      ".mmo-edge[data-kind='dep']{stroke:rgba(154,103,0,.55);stroke-dasharray:3 3}",
      ".mmo-edge-active{stroke:#2f6feb;stroke-width:2;stroke-dasharray:7 5;animation:mmo-dash 0.8s linear infinite}",
      "@keyframes mmo-dash{to{stroke-dashoffset:-24}}",
      "@keyframes mmo-pulse{0%,100%{box-shadow:0 0 0 0 rgba(26,127,55,.45)}50%{box-shadow:0 0 0 4px rgba(26,127,55,0)}}",
      "@media (prefers-reduced-motion:reduce){.mmo-dot[data-state='running'],.mmo-edge-active{animation:none}}",
    ].join("");

    function orgmapFormatTokens(n) {
      const v = Number(n) || 0;
      if (v >= 1e9) return (v / 1e9).toFixed(1) + "B";
      if (v >= 1e6) return (v / 1e6).toFixed(1) + "M";
      if (v >= 1e3) return (v / 1e3).toFixed(1) + "k";
      return String(Math.round(v));
    }

    function orgmapShorten(text, max) {
      const s = String(text || "").replace(/\s+/g, " ").trim();
      if (!s) return "";
      const n = typeof max === "number" && max > 1 ? max : 40;
      return s.length <= n ? s : s.slice(0, n - 1) + "…";
    }

    const GROUP_COLORS = ["#2f6feb", "#b45309", "#1a7f37", "#8250df", "#0e7490", "#b42318"];

    /** 组织架构图：无窗口框、无位置按钮，固定渲染在右侧边栏 tab 里。 */
    function createOrgChartOverlay(options) {
      const doc = options.document;
      const win = options.window || (doc && doc.defaultView) || null;
      if (!doc || !doc.body) return null;
      const apiBase = options.apiBase;
      const t = typeof options.t === "function" ? options.t : (k) => k;
      const pollMs = options.pollMs || 2000;
      const reportError = typeof options.reportError === "function" ? options.reportError : () => {};
      const host = options.host || null;

      const STYLE_ID = "mm-orgchart-style";
      if (!doc.getElementById(STYLE_ID)) {
        const style = doc.createElement("style");
        style.id = STYLE_ID;
        style.textContent = ORGMAP_CSS;
        (doc.head || doc.body).appendChild(style);
      }

      const root = doc.createElement("div");
      root.id = "mm-orgchart-root";
      root.setAttribute("data-mm-orgchart", "1");
      root.setAttribute("data-embedded", "1");
      root.setAttribute("data-layout", "levels");

      const canvas = doc.createElement("div");
      canvas.className = "mmo-canvas";
      const stage = doc.createElement("div");
      stage.className = "mmo-stage";
      const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "mmo-svg");
      svg.setAttribute("aria-hidden", "true");
      stage.appendChild(svg);
      const leadRow = doc.createElement("div");
      leadRow.className = "mmo-lead-row";
      stage.appendChild(leadRow);
      const groupsRow = doc.createElement("div");
      groupsRow.className = "mmo-groups";
      stage.appendChild(groupsRow);
      canvas.appendChild(stage);

      const failLine = doc.createElement("div");
      failLine.className = "mmo-fail";
      const foot = doc.createElement("div");
      foot.className = "mmo-foot";

      root.appendChild(failLine);
      root.appendChild(canvas);
      root.appendChild(foot);

      const raf = (fn) => {
        try {
          if (win && typeof win.requestAnimationFrame === "function") win.requestAnimationFrame(fn);
          else setTimeout(fn, 16);
        } catch {
          fn();
        }
      };

      // ---- 渲染 ----
      let lastData = null;
      let cardIndex = new Map();
      let layout = { lead: null, groups: [] };
      let timer = null;
      let disposed = false;
      let fetching = false;
      let failed = 0;

      function el(tag, cls, text) {
        const node = doc.createElement(tag);
        if (cls) node.className = cls;
        if (text !== undefined && text !== null) node.textContent = String(text);
        return node;
      }

      function cardFor(m) {
        const card = el("div", "mmo-card");
        card.setAttribute("data-target", String(m.target || ""));
        const running = m.status === "running";
        const work = m.work || null;
        const inProgress = !!(work && work.status === "in_progress");
        if (running) card.setAttribute("data-running", "1");
        if (running || inProgress) card.setAttribute("data-active", "1");

        const row1 = el("div", "mmo-row1");
        const dot = el("span", "mmo-dot");
        dot.setAttribute("data-state", running ? "running" : m.status === "idle" ? "idle" : "unknown");
        row1.appendChild(dot);
        const name = el("span", "mmo-name", m.displayName || m.target || "");
        name.title = (m.displayName || m.target || "") + (m.title ? " · " + m.title : "");
        row1.appendChild(name);
        if (m.model) {
          const model = el("span", "mmo-model", orgmapShorten(String(m.model).replace(/^deepseek-/, ""), 18));
          model.title = m.provider ? m.provider + " / " + m.model : m.model;
          row1.appendChild(model);
        }
        card.appendChild(row1);

        const taskText = work ? orgmapShorten(work.subject, 46) : "";
        const task = el("div", "mmo-task", taskText || t("ocNoWork"));
        if (!taskText) task.setAttribute("data-empty", "1");
        card.appendChild(task);

        const meta = el("div", "mmo-meta");
        const usage = m.usage || {};
        meta.appendChild(el("span", "", orgmapFormatTokens(usage.total) + " tok"));
        if (usage.requests) meta.appendChild(el("span", "", usage.requests + " req"));
        meta.appendChild(el("span", "", typeof fmtDur === "function" ? fmtDur(m.elapsedMs) : ""));
        if (work && work.status) {
          const badge = el("span", "mmo-badge" + (work.status === "completed" ? " mmo-ok" : ""), work.status);
          meta.appendChild(badge);
        }
        card.appendChild(meta);
        return card;
      }

      function render(data) {
        lastData = data || {};
        const d = lastData;
        cardIndex = new Map();
        layout = { lead: null, groups: [] };
        leadRow.textContent = "";
        groupsRow.textContent = "";

        if (d.lead) {
          const leadCard = cardFor(d.lead);
          leadCard.setAttribute("data-role", "lead");
          cardIndex.set(String(d.lead.target || "lead"), leadCard);
          leadRow.appendChild(leadCard);
          layout.lead = leadCard;
        }

        const groups = Array.isArray(d.groups) ? d.groups : [];
        const ungrouped = Array.isArray(d.ungrouped) ? d.ungrouped : [];
        const sections = groups.map((g) => ({ name: g.name || t("ocUngrouped"), members: g.members || [] }));
        if (ungrouped.length) sections.push({ name: t("ocUngrouped"), members: ungrouped });

        sections.forEach((section, gi) => {
          const gidx = gi % 6;
          const cluster = el("div", "mmo-cluster");
          cluster.setAttribute("data-gi", String(gidx));
          const chip = el("div", "mmo-chip");
          chip.setAttribute("data-gi", String(gidx));
          chip.appendChild(el("span", "mmo-chip-name", section.name));
          chip.appendChild(el("span", "mmo-chip-count", String(section.members.length)));
          cluster.appendChild(chip);
          const membersBox = el("div", "mmo-members");
          const memberCards = [];
          for (const m of section.members) {
            const card = cardFor(m);
            card.setAttribute("data-gi", String(gidx));
            cardIndex.set(String(m.target || ""), card);
            membersBox.appendChild(card);
            memberCards.push(card);
          }
          cluster.appendChild(membersBox);
          groupsRow.appendChild(cluster);
          layout.groups.push({ chip: chip, members: memberCards, gi: gidx });
        });

        const totals = d.totals || {};
        foot.textContent = "";
        foot.appendChild(el("span", "", t("ocTotals") + " " + orgmapFormatTokens(totals.totalTokens) + " tok"));
        if (totals.requests !== undefined) foot.appendChild(el("span", "", totals.requests + " req"));
        const activeCount = (d.members || []).filter(
          (m) => m.status === "running" || (m.work && m.work.status === "in_progress"),
        ).length;
        foot.appendChild(el("span", "", t("ocActive") + " " + activeCount));
        if (d.taskCounts) {
          const done = d.taskCounts.completed || 0;
          const total = (d.taskCounts.pending || 0) + (d.taskCounts.in_progress || 0) + done;
          foot.appendChild(el("span", "", "任务 " + done + "/" + total));
        }
        if (d.generatedAt) foot.appendChild(el("span", "", t("ocSample") + " " + String(d.generatedAt).slice(11, 19)));

        raf(() => drawEdges(d));
      }

      function rectOf(node) {
        if (!node || typeof node.getBoundingClientRect !== "function") return null;
        const s = stage.getBoundingClientRect();
        const r = node.getBoundingClientRect();
        const width = typeof r.width === "number" ? r.width : (r.right || 0) - (r.left || 0);
        if (!width) return null;
        const left = r.left - s.left;
        const top = r.top - s.top;
        return {
          left: left,
          right: left + width,
          top: top,
          bottom: top + (r.height || 0),
          cx: left + width / 2,
          cy: top + (r.height || 0) / 2,
        };
      }

      function addPath(d, cls, color) {
        const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", d);
        path.setAttribute("class", cls);
        if (color) path.setAttribute("stroke", color);
        svg.appendChild(path);
      }

      function drawEdges(data) {
        if (!data) return;
        const w = Math.max(1, Math.ceil(stage.scrollWidth || stage.offsetWidth || 1));
        const h = Math.max(1, Math.ceil(stage.scrollHeight || stage.offsetHeight || 1));
        svg.setAttribute("viewBox", "0 0 " + w + " " + h);
        svg.setAttribute("width", String(w));
        svg.setAttribute("height", String(h));
        while (svg.firstChild) svg.removeChild(svg.firstChild);

        const lead = rectOf(layout.lead);
        const groups = layout.groups || [];

        // ---- 串联：大总管（第 1 层）→ 分组色块（第 2 层），纵向总线 ----
        const chips = groups.map((g) => ({ g: g, r: rectOf(g.chip) })).filter((c) => c.r);
        if (lead && chips.length) {
          const tops = chips.map((c) => c.r.top);
          const busY = lead.bottom + Math.max(14, (Math.min.apply(null, tops) - lead.bottom) / 2);
          addPath("M " + lead.cx.toFixed(1) + " " + lead.bottom.toFixed(1) + " V " + busY.toFixed(1), "mmo-branch");
          const xs = chips.map((c) => c.r.cx);
          const minX = Math.min.apply(null, xs);
          const maxX = Math.max.apply(null, xs);
          if (maxX - minX > 0.5) {
            addPath("M " + minX.toFixed(1) + " " + busY.toFixed(1) + " H " + maxX.toFixed(1), "mmo-branch");
          }
          for (const item of chips) {
            addPath(
              "M " + item.r.cx.toFixed(1) + " " + busY.toFixed(1) + " V " + item.r.top.toFixed(1),
              "mmo-branch",
            );
          }
        }

        // ---- 串联：分组（第 2 层）→ 组内成员（第 3 层），组色总线；组内成员横向并联 ----
        for (const g of groups) {
          const chip = rectOf(g.chip);
          const cards = g.members.map((card) => rectOf(card)).filter(Boolean);
          if (!chip || !cards.length) continue;
          const color = GROUP_COLORS[g.gi];
          const tops = cards.map((c) => c.top);
          const busY = Math.min.apply(null, tops) - 12;
          addPath("M " + chip.cx.toFixed(1) + " " + chip.bottom.toFixed(1) + " V " + busY.toFixed(1), "mmo-branch", color);
          const xs = cards.map((c) => c.cx);
          const minX = Math.min.apply(null, xs);
          const maxX = Math.max.apply(null, xs);
          if (maxX - minX > 0.5) {
            addPath("M " + minX.toFixed(1) + " " + busY.toFixed(1) + " H " + maxX.toFixed(1), "mmo-branch", color);
          }
          for (const c of cards) {
            addPath("M " + c.cx.toFixed(1) + " " + busY.toFixed(1) + " V " + c.top.toFixed(1), "mmo-branch", color);
          }
        }

        // ---- 动态线：分发 / 依赖，一律正交折线（父→子走纵向，同层走横向）----
        const edges = [];
        const push = (from, to, kind, status) => {
          if (!from || !to || from === to) return;
          const a = cardIndex.get(String(from));
          const b = cardIndex.get(String(to));
          if (!a || !b) return;
          edges.push({ a: a, b: b, kind: kind, status: status });
        };
        const dispatch = Array.isArray(data.dispatch) ? data.dispatch : [];
        for (const e of dispatch) {
          if (e.status === "completed") continue;
          push(e.from, e.to, "dispatch", e.status);
        }
        const dep = Array.isArray(data.dependency) ? data.dependency : [];
        for (const e of dep) {
          if (e.status === "completed") continue;
          push(e.from, e.to, "dep", e.status);
        }
        edges.slice(0, ORGMAP_MAX_EDGES).forEach((e, i) => {
          const a = rectOf(e.a);
          const b = rectOf(e.b);
          if (!a || !b) return;
          let d;
          if (b.top >= a.bottom) {
            const midY = (a.bottom + b.top) / 2;
            d =
              "M " + a.cx.toFixed(1) + " " + a.bottom.toFixed(1) +
              " V " + midY.toFixed(1) + " H " + b.cx.toFixed(1) + " V " + b.top.toFixed(1);
          } else if (b.bottom <= a.top) {
            const midY = (a.top + b.bottom) / 2;
            d =
              "M " + a.cx.toFixed(1) + " " + a.top.toFixed(1) +
              " V " + midY.toFixed(1) + " H " + b.cx.toFixed(1) + " V " + b.bottom.toFixed(1);
          } else {
            // 同一层：从下方绕行，避免压住卡片
            const laneY = Math.max(a.bottom, b.bottom) + 12 + (i % 3) * 6;
            d =
              "M " + a.cx.toFixed(1) + " " + a.bottom.toFixed(1) +
              " V " + laneY.toFixed(1) + " H " + b.cx.toFixed(1) + " V " + b.bottom.toFixed(1);
          }
          addPath(d, "mmo-edge" + (e.status === "in_progress" ? " mmo-edge-active" : ""), e.kind === "dep" ? "#b45309" : "#2f6feb");
        });
      }

      async function refresh(manual) {
        if (disposed || fetching) return;
        fetching = true;
        try {
          const res = await fetch(apiBase + "/orgmap", { headers: { accept: "application/json" } });
          const payload = await res.json();
          if (!res.ok || !payload || payload.ok === false) throw new Error((payload && payload.message) || "HTTP " + res.status);
          failed = 0;
          failLine.style.display = "none";
          render(payload.data);
        } catch (err) {
          failed += 1;
          failLine.style.display = "block";
          failLine.textContent = t("ocFail") + " " + (err && err.message ? err.message : String(err));
          if (failed === 1 || manual) reportError("组织架构图数据刷新", err);
        } finally {
          fetching = false;
        }
      }

      function start() {
        if (timer) return;
        refresh(true);
        timer = setInterval(() => refresh(false), pollMs);
        if (timer && typeof timer.unref === "function") timer.unref();
      }

      function destroy() {
        disposed = true;
        if (timer) clearInterval(timer);
        timer = null;
        if (root.parentNode) root.parentNode.removeChild(root);
      }

      (host || doc.body).appendChild(root);
      start();

      return {
        root: root,
        refresh: refresh,
        destroy: destroy,
        getData: () => lastData,
        isCollapsed: () => false,
        toggleCollapse: () => {},
      };
    }

