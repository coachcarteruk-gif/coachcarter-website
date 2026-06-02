(function () {
  const framework = window.MARKETING_FRAMEWORK;
  const STORAGE_KEY = "coachcarter.marketingMap.state.v1";
  const svg = document.getElementById("mapSvg");
  const inspector = document.getElementById("inspectorContent");
  const workNextList = document.getElementById("workNextList");
  const searchInput = document.getElementById("searchInput");
  const statusFilter = document.getElementById("statusFilter");
  const detailMode = document.getElementById("detailMode");
  const resetViewBtn = document.getElementById("resetViewBtn");
  const addThoughtBtn = document.getElementById("addThoughtBtn");
  const exportBtn = document.getElementById("exportBtn");
  const importInput = document.getElementById("importInput");

  const DEFAULT_STATUS = "not-started";
  const NODE_WIDTHS = {
    area: 170,
    concept: 145,
    idea: 138,
    thought: 150
  };

  let state = loadState();
  let selectedId = state.lastSelectedId || "center";
  let pan = state.ui.pan || { x: 0, y: 0 };
  let scale = state.ui.scale || 1;
  let isPanning = false;
  let panStart = null;
  let lastNodes = [];
  let lastNodeMap = new Map();

  const statusLabels = Object.fromEntries(framework.statuses.map((status) => [status.id, status.label]));

  function loadState() {
    const empty = {
      statuses: {},
      notes: {},
      promptAnswers: {},
      checklists: {},
      customIdeas: [],
      customThoughts: [],
      customLinks: [],
      workNext: [],
      lastSelectedId: "center",
      ui: { pan: { x: 0, y: 0 }, scale: 1 }
    };

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return empty;
      return { ...empty, ...JSON.parse(raw) };
    } catch (error) {
      console.warn("Could not load Marketing Map state", error);
      return empty;
    }
  }

  function saveState() {
    state.lastSelectedId = selectedId;
    state.ui = { pan, scale };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function slugId(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function statusFor(id) {
    return state.statuses[id] || DEFAULT_STATUS;
  }

  function setStatus(id, status) {
    state.statuses[id] = status;
    saveState();
    render();
  }

  function noteFor(id) {
    return state.notes[id] || "";
  }

  function setNote(id, value) {
    state.notes[id] = value;
    saveState();
  }

  function promptKey(nodeId, promptIndex) {
    return `${nodeId}::${promptIndex}`;
  }

  function answerFor(nodeId, promptIndex) {
    return state.promptAnswers[promptKey(nodeId, promptIndex)] || "";
  }

  function setAnswer(nodeId, promptIndex, value) {
    state.promptAnswers[promptKey(nodeId, promptIndex)] = value;
    saveState();
  }

  function allAreas() {
    return framework.areas;
  }

  function allConcepts() {
    return framework.areas.flatMap((area) =>
      area.concepts.map((concept) => ({ ...concept, areaId: area.id, areaTitle: area.title }))
    );
  }

  function allIdeas() {
    const builtIn = framework.areas.flatMap((area) =>
      area.concepts.flatMap((concept) =>
        concept.ideas.map((idea) => ({
          ...idea,
          areaId: area.id,
          areaTitle: area.title,
          conceptId: concept.id,
          conceptTitle: concept.title,
          custom: false
        }))
      )
    );
    return builtIn.concat(state.customIdeas.map((idea) => ({ ...idea, custom: true })));
  }

  function allThoughts() {
    return state.customThoughts;
  }

  function findItem(id) {
    if (id === "center") {
      return {
        kind: "center",
        id: "center",
        title: framework.title,
        summary: "A private, map-first workspace for translating lead generation, offer design, and money model thinking into CoachCarter implementation."
      };
    }
    const area = framework.areas.find((item) => item.id === id);
    if (area) return { ...area, kind: "area" };

    const concept = allConcepts().find((item) => item.id === id);
    if (concept) return { ...concept, kind: "concept" };

    const idea = allIdeas().find((item) => item.id === id);
    if (idea) return { ...idea, kind: "idea" };

    const thought = state.customThoughts.find((item) => item.id === id);
    if (thought) return { ...thought, kind: "thought" };

    return null;
  }

  function titleFor(id) {
    const item = findItem(id);
    return item ? item.title : id;
  }

  function matchesFilters(node) {
    const query = searchInput.value.trim().toLowerCase();
    const filter = statusFilter.value;
    const item = findItem(node.id);
    if (!item) return false;
    const text = [
      item.title,
      item.summary,
      item.type,
      item.areaTitle,
      item.conceptTitle,
      (item.tags || []).join(" ")
    ].join(" ").toLowerCase();
    const queryMatch = !query || text.includes(query);
    const statusMatch = filter === "all" || statusFor(node.id) === filter;
    return queryMatch && statusMatch;
  }

  function makeNode(id, kind, x, y, subtitle) {
    const item = findItem(id);
    return {
      id,
      kind,
      x,
      y,
      title: item ? item.title : id,
      subtitle,
      width: NODE_WIDTHS[kind] || 150,
      height: kind === "area" ? 78 : 68
    };
  }

  function layoutNodes() {
    const nodes = [makeNode("center", "center", 0, 0, "Founder workspace")];
    const links = [];
    const areas = allAreas();
    const areaRadius = 500;
    const selected = findItem(selectedId);
    const selectedAreaId = selected && selected.kind === "area"
      ? selected.id
      : selected && selected.areaId
        ? selected.areaId
        : null;
    const selectedConceptId = selected && selected.kind === "concept"
      ? selected.id
      : selected && selected.conceptId
        ? selected.conceptId
        : null;

    areas.forEach((area, index) => {
      const angle = -Math.PI / 2 + (index / areas.length) * Math.PI * 2;
      const x = Math.cos(angle) * areaRadius;
      const y = Math.sin(angle) * areaRadius;
      nodes.push(makeNode(area.id, "area", x, y, `${area.concepts.length} concepts`));
      links.push(["center", area.id, "area"]);

      if (detailMode.value === "concepts" || detailMode.value === "selected") {
        const showConcepts = detailMode.value === "concepts" || area.id === selectedAreaId || selectedId === "center";
        if (showConcepts) {
          const spread = area.concepts.length > 1 ? 0.7 : 0;
          area.concepts.forEach((concept, conceptIndex) => {
            const localOffset = area.concepts.length > 1
              ? -spread / 2 + (conceptIndex / (area.concepts.length - 1)) * spread
              : 0;
            const conceptAngle = angle + localOffset;
            const conceptRadius = detailMode.value === "concepts" ? 165 : 175;
            const cx = x + Math.cos(conceptAngle) * conceptRadius;
            const cy = y + Math.sin(conceptAngle) * conceptRadius;
            nodes.push(makeNode(concept.id, "concept", cx, cy, area.title));
            links.push([area.id, concept.id, "concept"]);
          });
        }
      }

      if (detailMode.value === "selected" && area.id === selectedAreaId) {
        const ideas = allIdeas().filter((idea) => idea.areaId === area.id && (!selectedConceptId || idea.conceptId === selectedConceptId));
        const ideaBaseAngle = angle;
        ideas.slice(0, 12).forEach((idea, ideaIndex) => {
          const ideaSpread = ideas.length > 1 ? 1.05 : 0;
          const ideaAngle = ideaBaseAngle - ideaSpread / 2 + (ideaIndex / Math.max(1, ideas.length - 1)) * ideaSpread;
          const parent = idea.conceptId || area.id;
          const parentNode = nodes.find((node) => node.id === parent) || nodes.find((node) => node.id === area.id);
          const ix = parentNode.x + Math.cos(ideaAngle) * 155;
          const iy = parentNode.y + Math.sin(ideaAngle) * 155;
          nodes.push(makeNode(idea.id, "idea", ix, iy, idea.type || "Idea"));
          links.push([parent, idea.id, "idea"]);
        });
      }
    });

    state.customThoughts.forEach((thought, index) => {
      const col = index % 2;
      const row = Math.floor(index / 2);
      nodes.push(makeNode(thought.id, "thought", -640 + col * 190, 545 + row * 92, "Loose thought"));
    });

    framework.links.forEach(([from, to]) => links.push([from, to, "system"]));
    state.customLinks.forEach((link) => links.push([link.from, link.to, "manual"]));

    return { nodes, links };
  }

  function lineText(text, maxChars) {
    const words = String(text || "").split(/\s+/);
    const lines = [];
    let current = "";
    words.forEach((word) => {
      if ((current + " " + word).trim().length > maxChars && current) {
        lines.push(current);
        current = word;
      } else {
        current = (current + " " + word).trim();
      }
    });
    if (current) lines.push(current);
    return lines.slice(0, 3);
  }

  function renderMap() {
    const { nodes, links } = layoutNodes();
    lastNodes = nodes;
    lastNodeMap = new Map(nodes.map((node) => [node.id, node]));

    const visibleNodes = nodes.filter(matchesFilters);
    const visibleIds = new Set(visibleNodes.map((node) => node.id));
    const selectedVisible = visibleIds.has(selectedId);

    const edgeMarkup = links
      .filter(([from, to]) => lastNodeMap.has(from) && lastNodeMap.has(to))
      .map(([from, to, kind]) => {
        const source = lastNodeMap.get(from);
        const target = lastNodeMap.get(to);
        const dimmed = !visibleIds.has(source.id) || !visibleIds.has(target.id);
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const c1x = source.x + dx * 0.45;
        const c1y = source.y + dy * 0.05;
        const c2x = source.x + dx * 0.55;
        const c2y = source.y + dy * 0.95;
        return `<path class="edge ${kind === "manual" ? "manual" : ""} ${dimmed ? "dimmed" : ""}" d="M ${source.x} ${source.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${target.x} ${target.y}" />`;
      })
      .join("");

    const nodeMarkup = nodes.map((node) => {
      const isSelected = node.id === selectedId;
      const dimmed = !visibleIds.has(node.id) || (searchInput.value && !matchesFilters(node) && !isSelected);
      const status = statusFor(node.id);
      if (node.kind === "center") {
        return `
          <g class="node center ${isSelected ? "selected" : ""} ${dimmed && !selectedVisible ? "dimmed" : ""}" data-id="${node.id}" transform="translate(${node.x}, ${node.y})">
            <circle r="74"></circle>
            <text text-anchor="middle" y="-4">${escapeHtml(node.title)}</text>
            <text class="node-subtitle" text-anchor="middle" y="18">${escapeHtml(node.subtitle)}</text>
          </g>`;
      }

      const lines = lineText(node.title, node.kind === "area" ? 18 : 16);
      const textLines = lines.map((line, index) =>
        `<text text-anchor="middle" y="${-11 + index * 15}">${escapeHtml(line)}</text>`
      ).join("");
      return `
        <g class="node ${node.kind} ${isSelected ? "selected" : ""} ${dimmed ? "dimmed" : ""}" data-id="${node.id}" transform="translate(${node.x}, ${node.y})">
          <rect x="${-node.width / 2}" y="${-node.height / 2}" width="${node.width}" height="${node.height}" rx="7"></rect>
          ${textLines}
          <text class="node-subtitle" text-anchor="middle" y="${node.height / 2 - 12}">${escapeHtml(node.subtitle || statusLabels[status])}</text>
          <circle class="status-dot ${status}" cx="${node.width / 2 - 14}" cy="${-node.height / 2 + 14}" r="7"></circle>
        </g>`;
    }).join("");

    svg.innerHTML = `<g id="viewport" transform="translate(${pan.x}, ${pan.y}) scale(${scale})">${edgeMarkup}${nodeMarkup}</g>`;

    svg.querySelectorAll(".node").forEach((nodeElement) => {
      nodeElement.addEventListener("click", (event) => {
        event.stopPropagation();
        selectedId = nodeElement.getAttribute("data-id");
        saveState();
        render();
      });
    });
  }

  function renderInspector() {
    const item = findItem(selectedId) || findItem("center");
    if (!item) return;

    const status = statusFor(item.id);
    const prompts = item.prompts || [];
    const tags = item.tags || [];

    let html = `
      <p class="eyebrow">${escapeHtml(item.kind || "map")}</p>
      <h2>${escapeHtml(item.title)}</h2>
      <p class="summary">${escapeHtml(item.summary || "")}</p>
      ${tags.length ? `<div class="tag-list">${tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
      <div class="meta-row">
        <label>Status
          <select data-action="status" data-id="${escapeHtml(item.id)}">
            ${framework.statuses.map((option) => `<option value="${option.id}" ${option.id === status ? "selected" : ""}>${option.label}</option>`).join("")}
          </select>
        </label>
      </div>
      <div class="section">
        <h3>Notes</h3>
        <textarea data-action="note" data-id="${escapeHtml(item.id)}" placeholder="Write your thinking here">${escapeHtml(noteFor(item.id))}</textarea>
      </div>
    `;

    if (item.bookRefs && item.bookRefs.length) {
      html += `
        <div class="section">
          <h3>Book coverage</h3>
          <div class="tag-list">${item.bookRefs.map((ref) => `<span class="tag">${escapeHtml(ref)}</span>`).join("")}</div>
        </div>
      `;
    }

    if (prompts.length) {
      html += `
        <div class="section">
          <h3>Guided journal</h3>
          ${prompts.map((prompt, index) => `
            <div class="prompt">
              <label for="prompt-${escapeHtml(item.id)}-${index}">${escapeHtml(prompt)}</label>
              <textarea id="prompt-${escapeHtml(item.id)}-${index}" data-action="prompt" data-id="${escapeHtml(item.id)}" data-index="${index}">${escapeHtml(answerFor(item.id, index))}</textarea>
            </div>
          `).join("")}
        </div>
      `;
    }

    if (item.kind === "area") {
      const concepts = item.concepts || [];
      html += `
        <div class="section">
          <h3>Concepts</h3>
          <div class="item-list">
            ${concepts.map((concept) => itemButton(concept.id, concept.title, concept.summary)).join("")}
          </div>
        </div>
        ${addIdeaForm(item.id, "area")}
      `;
    }

    if (item.kind === "concept") {
      const ideas = allIdeas().filter((idea) => idea.conceptId === item.id);
      html += `
        <div class="section">
          <h3>Implementation ideas</h3>
          <div class="item-list">
            ${ideas.length ? ideas.map((idea) => itemButton(idea.id, idea.title, idea.type || "Idea")).join("") : `<div class="empty">No ideas yet.</div>`}
          </div>
        </div>
        ${addIdeaForm(item.id, "concept")}
      `;
    }

    if (item.kind === "idea") {
      html += `
        <div class="section">
          <h3>Checklist</h3>
          ${checklistMarkup(item)}
        </div>
        <div class="section">
          <h3>Focus</h3>
          <button type="button" data-action="toggle-work-next" data-id="${escapeHtml(item.id)}">
            ${state.workNext.includes(item.id) ? "Remove from Work Next" : "Add to Work Next"}
          </button>
        </div>
      `;
    }

    if (item.kind === "thought") {
      html += `
        <div class="section">
          <h3>Loose thought</h3>
          <label>Title
            <input data-action="thought-title" data-id="${escapeHtml(item.id)}" value="${escapeHtml(item.title)}">
          </label>
          <div class="section">
            <button type="button" class="danger" data-action="delete-thought" data-id="${escapeHtml(item.id)}">Delete thought</button>
          </div>
        </div>
      `;
    }

    html += connectionForm(item.id);
    inspector.innerHTML = html;
    wireInspector();
  }

  function itemButton(id, title, subtitle) {
    return `
      <button class="item-button" type="button" data-action="select" data-id="${escapeHtml(id)}">
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(subtitle || statusLabels[statusFor(id)])}</span>
      </button>
    `;
  }

  function addIdeaForm(parentId, parentType) {
    return `
      <div class="section">
        <h3>Add implementation idea</h3>
        <div class="add-row">
          <input data-role="new-idea-title" placeholder="Idea title">
          <select data-role="new-idea-type">
            <option>Website/product</option>
            <option>Content</option>
            <option>Outreach</option>
            <option>Referral</option>
            <option>Partnership</option>
            <option>Paid ads</option>
            <option>Email/SMS follow-up</option>
            <option>Manual process</option>
            <option>Measurement</option>
          </select>
          <button type="button" data-action="add-idea" data-parent-id="${escapeHtml(parentId)}" data-parent-type="${escapeHtml(parentType)}">Add</button>
        </div>
      </div>
    `;
  }

  function checklistFor(item) {
    if (state.checklists[item.id]) return state.checklists[item.id];
    return (item.checklist || []).map((text, index) => ({ id: `${item.id}-seed-${index}`, text, done: false }));
  }

  function setChecklist(itemId, checklist) {
    state.checklists[itemId] = checklist;
    saveState();
  }

  function checklistMarkup(item) {
    const checklist = checklistFor(item);
    return `
      <div class="checklist">
        ${checklist.length ? checklist.map((check) => `
          <div class="check-row" data-check-id="${escapeHtml(check.id)}">
            <input type="checkbox" data-action="check-toggle" data-id="${escapeHtml(item.id)}" data-check-id="${escapeHtml(check.id)}" ${check.done ? "checked" : ""}>
            <input type="text" data-action="check-text" data-id="${escapeHtml(item.id)}" data-check-id="${escapeHtml(check.id)}" value="${escapeHtml(check.text)}">
            <button type="button" class="secondary" data-action="check-delete" data-id="${escapeHtml(item.id)}" data-check-id="${escapeHtml(check.id)}">Remove</button>
          </div>
        `).join("") : `<div class="empty">No checklist items yet.</div>`}
        <div class="add-row">
          <input data-role="new-check-text" placeholder="New checklist item">
          <button type="button" data-action="check-add" data-id="${escapeHtml(item.id)}">Add</button>
        </div>
      </div>
    `;
  }

  function connectionForm(currentId) {
    const choices = [
      ...framework.areas.map((area) => ({ id: area.id, title: area.title })),
      ...allConcepts().map((concept) => ({ id: concept.id, title: `${concept.areaTitle}: ${concept.title}` })),
      ...state.customThoughts.map((thought) => ({ id: thought.id, title: `Thought: ${thought.title}` }))
    ].filter((choice) => choice.id !== currentId);

    return `
      <div class="section">
        <h3>Connections</h3>
        <div class="add-row">
          <select data-role="connect-target">
            ${choices.map((choice) => `<option value="${escapeHtml(choice.id)}">${escapeHtml(choice.title)}</option>`).join("")}
          </select>
          <button type="button" data-action="connect-node" data-id="${escapeHtml(currentId)}">Connect</button>
        </div>
      </div>
    `;
  }

  function wireInspector() {
    inspector.querySelectorAll("[data-action='status']").forEach((element) => {
      element.addEventListener("change", () => setStatus(element.dataset.id, element.value));
    });

    inspector.querySelectorAll("[data-action='note']").forEach((element) => {
      element.addEventListener("input", () => setNote(element.dataset.id, element.value));
    });

    inspector.querySelectorAll("[data-action='prompt']").forEach((element) => {
      element.addEventListener("input", () => setAnswer(element.dataset.id, element.dataset.index, element.value));
    });

    inspector.querySelectorAll("[data-action='select']").forEach((element) => {
      element.addEventListener("click", () => {
        selectedId = element.dataset.id;
        saveState();
        render();
      });
    });

    inspector.querySelectorAll("[data-action='add-idea']").forEach((element) => {
      element.addEventListener("click", () => {
        const titleInput = inspector.querySelector("[data-role='new-idea-title']");
        const typeInput = inspector.querySelector("[data-role='new-idea-type']");
        const title = titleInput.value.trim();
        if (!title) return;
        const parent = findItem(element.dataset.parentId);
        const customIdea = {
          id: slugId("idea"),
          title,
          type: typeInput.value,
          tags: ["custom"],
          areaId: parent.kind === "area" ? parent.id : parent.areaId,
          areaTitle: parent.kind === "area" ? parent.title : parent.areaTitle,
          conceptId: parent.kind === "concept" ? parent.id : null,
          conceptTitle: parent.kind === "concept" ? parent.title : null,
          summary: "Custom CoachCarter implementation idea.",
          checklist: []
        };
        state.customIdeas.push(customIdea);
        selectedId = customIdea.id;
        saveState();
        render();
      });
    });

    inspector.querySelectorAll("[data-action='toggle-work-next']").forEach((element) => {
      element.addEventListener("click", () => toggleWorkNext(element.dataset.id));
    });

    inspector.querySelectorAll("[data-action^='check-']").forEach((element) => {
      element.addEventListener("change", () => handleChecklistAction(element));
      element.addEventListener("click", () => handleChecklistAction(element));
      element.addEventListener("input", () => handleChecklistAction(element));
    });

    inspector.querySelectorAll("[data-action='connect-node']").forEach((element) => {
      element.addEventListener("click", () => {
        const target = inspector.querySelector("[data-role='connect-target']");
        if (!target.value) return;
        const exists = state.customLinks.some((link) => link.from === element.dataset.id && link.to === target.value);
        if (!exists) {
          state.customLinks.push({ from: element.dataset.id, to: target.value });
          saveState();
          render();
        }
      });
    });

    inspector.querySelectorAll("[data-action='thought-title']").forEach((element) => {
      element.addEventListener("input", () => {
        const thought = state.customThoughts.find((item) => item.id === element.dataset.id);
        if (!thought) return;
        thought.title = element.value;
        saveState();
        renderMap();
        renderWorkNext();
      });
    });

    inspector.querySelectorAll("[data-action='delete-thought']").forEach((element) => {
      element.addEventListener("click", () => {
        state.customThoughts = state.customThoughts.filter((thought) => thought.id !== element.dataset.id);
        state.customLinks = state.customLinks.filter((link) => link.from !== element.dataset.id && link.to !== element.dataset.id);
        state.workNext = state.workNext.filter((id) => id !== element.dataset.id);
        selectedId = "center";
        saveState();
        render();
      });
    });
  }

  function handleChecklistAction(element) {
    const action = element.dataset.action;
    const item = findItem(element.dataset.id);
    if (!item) return;
    const checklist = checklistFor(item);

    if (action === "check-toggle") {
      const check = checklist.find((row) => row.id === element.dataset.checkId);
      if (check) check.done = element.checked;
      setChecklist(item.id, checklist);
      renderWorkNext();
    }

    if (action === "check-text") {
      const check = checklist.find((row) => row.id === element.dataset.checkId);
      if (check) check.text = element.value;
      setChecklist(item.id, checklist);
    }

    if (action === "check-delete") {
      setChecklist(item.id, checklist.filter((row) => row.id !== element.dataset.checkId));
      renderInspector();
    }

    if (action === "check-add") {
      const input = inspector.querySelector("[data-role='new-check-text']");
      const text = input.value.trim();
      if (!text) return;
      checklist.push({ id: slugId("check"), text, done: false });
      setChecklist(item.id, checklist);
      renderInspector();
    }
  }

  function toggleWorkNext(id) {
    if (state.workNext.includes(id)) {
      state.workNext = state.workNext.filter((itemId) => itemId !== id);
    } else {
      state.workNext.push(id);
    }
    saveState();
    render();
  }

  function renderWorkNext() {
    const items = state.workNext.map(findItem).filter(Boolean);
    if (!items.length) {
      workNextList.innerHTML = `<div class="empty">Add ideas to this queue when you want them to rise above the map noise.</div>`;
      return;
    }

    workNextList.innerHTML = items.map((item, index) => {
      const checklist = item.kind === "idea" ? checklistFor(item) : [];
      const done = checklist.filter((check) => check.done).length;
      const total = checklist.length;
      return `
        <div class="queue-item">
          <strong>${escapeHtml(item.title)}</strong>
          <span>${escapeHtml(item.areaTitle || item.kind)}${total ? ` - ${done}/${total} checklist` : ""}</span>
          <div class="queue-controls">
            <button type="button" data-action="queue-select" data-id="${escapeHtml(item.id)}">Open</button>
            <button type="button" data-action="queue-up" data-index="${index}" ${index === 0 ? "disabled" : ""}>Up</button>
            <button type="button" data-action="queue-down" data-index="${index}" ${index === items.length - 1 ? "disabled" : ""}>Down</button>
            <button type="button" data-action="queue-remove" data-id="${escapeHtml(item.id)}">Remove</button>
          </div>
        </div>
      `;
    }).join("");

    workNextList.querySelectorAll("[data-action='queue-select']").forEach((button) => {
      button.addEventListener("click", () => {
        selectedId = button.dataset.id;
        detailMode.value = "selected";
        saveState();
        render();
      });
    });

    workNextList.querySelectorAll("[data-action='queue-remove']").forEach((button) => {
      button.addEventListener("click", () => toggleWorkNext(button.dataset.id));
    });

    workNextList.querySelectorAll("[data-action='queue-up']").forEach((button) => {
      button.addEventListener("click", () => moveQueueItem(Number(button.dataset.index), -1));
    });

    workNextList.querySelectorAll("[data-action='queue-down']").forEach((button) => {
      button.addEventListener("click", () => moveQueueItem(Number(button.dataset.index), 1));
    });
  }

  function moveQueueItem(index, direction) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= state.workNext.length) return;
    const copy = state.workNext.slice();
    const [item] = copy.splice(index, 1);
    copy.splice(nextIndex, 0, item);
    state.workNext = copy;
    saveState();
    renderWorkNext();
  }

  function exportState() {
    const payload = {
      exportedAt: new Date().toISOString(),
      frameworkVersion: framework.version,
      state
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "marketing-map-state.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function importState(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        state = parsed.state || parsed;
        selectedId = state.lastSelectedId || "center";
        pan = state.ui && state.ui.pan ? state.ui.pan : { x: 0, y: 0 };
        scale = state.ui && state.ui.scale ? state.ui.scale : 1;
        saveState();
        render();
      } catch (error) {
        alert("That file could not be imported.");
      }
    };
    reader.readAsText(file);
  }

  function resetView() {
    pan = { x: svg.clientWidth / 2, y: svg.clientHeight / 2 };
    scale = detailMode.value === "areas" ? 0.6 : 0.58;
    saveState();
    renderMap();
  }

  function addThought() {
    const title = window.prompt("Loose thought title");
    if (!title || !title.trim()) return;
    const thought = {
      id: slugId("thought"),
      title: title.trim(),
      summary: "A free-floating thought you can connect later."
    };
    state.customThoughts.push(thought);
    selectedId = thought.id;
    saveState();
    render();
  }

  function bindCanvas() {
    svg.addEventListener("mousedown", (event) => {
      isPanning = true;
      svg.classList.add("is-panning");
      panStart = { x: event.clientX - pan.x, y: event.clientY - pan.y };
    });

    window.addEventListener("mousemove", (event) => {
      if (!isPanning) return;
      pan = { x: event.clientX - panStart.x, y: event.clientY - panStart.y };
      saveState();
      renderMap();
    });

    window.addEventListener("mouseup", () => {
      isPanning = false;
      svg.classList.remove("is-panning");
    });

    svg.addEventListener("wheel", (event) => {
      event.preventDefault();
      const oldScale = scale;
      const direction = event.deltaY > 0 ? -1 : 1;
      const nextScale = Math.min(2.4, Math.max(0.45, scale + direction * 0.08));
      const rect = svg.getBoundingClientRect();
      const mx = event.clientX - rect.left;
      const my = event.clientY - rect.top;
      const worldX = (mx - pan.x) / oldScale;
      const worldY = (my - pan.y) / oldScale;
      scale = nextScale;
      pan = { x: mx - worldX * scale, y: my - worldY * scale };
      saveState();
      renderMap();
    }, { passive: false });
  }

  function bindGlobalControls() {
    [searchInput, statusFilter, detailMode].forEach((element) => {
      element.addEventListener("input", render);
      element.addEventListener("change", render);
    });

    resetViewBtn.addEventListener("click", resetView);
    addThoughtBtn.addEventListener("click", addThought);
    exportBtn.addEventListener("click", exportState);
    importInput.addEventListener("change", () => {
      const file = importInput.files && importInput.files[0];
      if (file) importState(file);
      importInput.value = "";
    });
  }

  function render() {
    renderMap();
    renderInspector();
    renderWorkNext();
  }

  bindCanvas();
  bindGlobalControls();
  if (!state.ui || !state.ui.pan || (state.ui.pan.x === 0 && state.ui.pan.y === 0)) {
    pan = { x: Math.max(420, svg.clientWidth / 2), y: Math.max(360, svg.clientHeight / 2) };
    scale = 0.6;
  }
  render();
})();
