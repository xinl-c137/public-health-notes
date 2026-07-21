const state = { notes: [], attachments: [], loaded: new Map(), currentNote: null };
const $ = (selector) => document.querySelector(selector);

const escapeHtml = (value = "") => value
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;");

function inline(text) {
  const formulas = [];
  const stashFormula = (source, displayMode) => {
    const index = formulas.push({ source, displayMode }) - 1;
    return `\uE000MATH${index}\uE001`;
  };
  text = text
    .replace(/\$\$([^\r\n]+?)\$\$/g, (_, source) => stashFormula(source, true))
    .replace(/(?<!\$)\$([^\r\n$]+?)\$(?!\$)/g, (_, source) => stashFormula(source, false));
  return escapeHtml(text)
    .replace(/!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, size) => embeddedAsset(target, size))
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" loading="lazy">')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (_, target, label) => wikiLink(target, label))
    .replace(/\[\[([^\]]+)\]\]/g, (_, target) => wikiLink(target, target.split("/").pop()))
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>")
    .replace(/==(.+?)==/g, "<mark>$1</mark>")
    .replace(/&lt;(u|sup|sub)&gt;([\s\S]*?)&lt;\/\1&gt;/gi, "<$1>$2</$1>")
    .replace(/\uE000MATH(\d+)\uE001/g, (_, index) => renderLatex(formulas[Number(index)].source, formulas[Number(index)].displayMode));
}

function renderLatex(source, displayMode = false) {
  if (!window.katex) return `<code class="latex-fallback">${escapeHtml(source)}</code>`;
  try {
    const normalized = source.trim()
      .replaceAll("\\begin{gather}", "\\begin{gathered}")
      .replaceAll("\\end{gather}", "\\end{gathered}")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replaceAll("　", "\\quad ");
    return katex.renderToString(normalized, {
      displayMode,
      throwOnError: false,
      strict: "ignore",
      trust: false,
      output: "htmlAndMathml"
    });
  } catch {
    return `<code class="latex-fallback">${escapeHtml(source)}</code>`;
  }
}

function embeddedAsset(target, size = "") {
  const clean = target.replaceAll("\\", "/");
  const basename = clean.split("/").pop().toLowerCase();
  const category = (state.currentNote?.category || "").toLowerCase();
  const matches = state.attachments.filter(item => {
    const name = item.name.toLowerCase();
    const relative = item.relative.toLowerCase();
    return name === basename || name === `${basename}.md` || relative.endsWith(clean.toLowerCase()) || relative.endsWith(`${clean.toLowerCase()}.md`);
  });
  const asset = matches.find(item => item.relative.toLowerCase().includes(`/${category}/`)) || matches[0];
  const width = /^\d+$/.test(size) ? ` style="max-width:${Math.min(Number(size), 1200)}px"` : "";
  if (!asset) return `<span class="missing-asset" title="附件尚未找到">图片：${escapeHtml(target)}</span>`;
  const url = asset.url.split("/").map((part, index) => index ? encodeURIComponent(part) : part).join("/");
  if (/\.(png|jpe?g|gif|webp|svg|avif)$/i.test(asset.name)) return `<img class="note-image" src="${url}" alt="${escapeHtml(target)}" loading="lazy"${width}>`;
  return `<a class="attachment-link" href="${url}" target="_blank">附件：${escapeHtml(target)}</a>`;
}

function wikiLink(target, label) {
  const clean = target.replace(/\.md$/i, "");
  const match = state.notes.find(n => n.path.replace(/\.md$/i, "") === clean || n.title === clean || n.path.replace(/\.md$/i, "").endsWith(`/${clean}`));
  return match ? `<a href="#/note/${encodeURIComponent(match.path)}">${escapeHtml(label)}</a>` : `<span class="broken-link">${escapeHtml(label)}</span>`;
}

function parseFrontmatter(source) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { body: source, properties: [] };
  const properties = [];
  let current = null;
  const cleanValue = value => value.trim().replace(/^['"]|['"]$/g, "");
  for (const line of match[1].replace(/\r/g, "").split("\n")) {
    const property = line.match(/^([^\s:#][^:]*):\s*(.*)$/);
    if (property) {
      current = { key: property[1].trim(), values: [] };
      const value = cleanValue(property[2]);
      if (value) {
        if (value.startsWith("[") && value.endsWith("]")) current.values.push(...value.slice(1, -1).split(",").map(cleanValue).filter(Boolean));
        else current.values.push(value);
      }
      properties.push(current);
      continue;
    }
    const listItem = line.match(/^\s*-\s+(.+)$/);
    if (listItem && current) current.values.push(cleanValue(listItem[1]));
  }
  return { body: source.slice(match[0].length), properties };
}

function renderProperties(properties) {
  if (!properties.length) return "";
  const preferredOrder = { "时间": 0, aliases: 1, tags: 2 };
  const icons = { "时间": "◷", aliases: "↗", tags: "◇" };
  const labels = { "时间": "时间", aliases: "别名", tags: "标签" };
  const sorted = [...properties].sort((a, b) => (preferredOrder[a.key] ?? 99) - (preferredOrder[b.key] ?? 99));
  return `<section class="note-properties" aria-label="笔记属性">
    <div class="properties-title">笔记属性</div>
    <dl>${sorted.map(property => {
      const values = property.key === "时间"
        ? property.values.map(value => value.replace(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?/, "$1/$2/$3 $4:$5"))
        : property.values;
      const valueHtml = property.key === "tags"
        ? values.map(value => `<span class="property-chip">${escapeHtml(value)}</span>`).join("")
        : values.map(value => `<span class="property-value">${escapeHtml(value)}</span>`).join("");
      return `<div class="property-row"><dt><span class="property-icon" aria-hidden="true">${icons[property.key] || "·"}</span>${escapeHtml(labels[property.key] || property.key)}</dt><dd>${valueHtml || '<span class="property-empty">—</span>'}</dd></div>`;
    }).join("")}</dl>
  </section>`;
}

function parseListLine(line) {
  const match = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.+)$/);
  if (!match) return null;
  const tabs = (match[1].match(/\t/g) || []).length;
  const spaces = match[1].replace(/\t/g, "").length;
  const spaceLevels = spaces ? 1 + Math.floor((spaces - 1) / 4) : 0;
  return {
    level: tabs + spaceLevels,
    type: /^\d/.test(match[2]) ? "ol" : "ul",
    content: match[3]
  };
}

function renderListBlock(items) {
  if (!items.length) return "";
  const minimumLevel = Math.min(...items.map(item => item.level));
  const normalized = items.map(item => ({ ...item, level: item.level - minimumLevel }));

  function renderLevel(start, level, type) {
    let html = `<${type}>`;
    let index = start;
    while (index < normalized.length) {
      const item = normalized[index];
      if (item.level < level || (item.level === level && item.type !== type)) break;
      if (item.level > level) {
        const nested = renderLevel(index, item.level, item.type);
        html += nested.html;
        index = nested.index;
        continue;
      }
      html += `<li>${inline(item.content)}`;
      index++;
      while (index < normalized.length && normalized[index].level > level) {
        const nested = renderLevel(index, normalized[index].level, normalized[index].type);
        html += nested.html;
        index = nested.index;
      }
      html += "</li>";
    }
    return { html: `${html}</${type}>`, index };
  }

  let html = "", index = 0;
  while (index < normalized.length) {
    const rendered = renderLevel(index, normalized[index].level, normalized[index].type);
    html += rendered.html;
    index = rendered.index;
  }
  return html;
}

function markdown(source) {
  source = source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
  const lines = source.replace(/\r/g, "").split("\n");
  let html = "", inCode = false, code = [], paragraph = [];
  const flushParagraph = () => { if (paragraph.length) { html += `<p>${inline(paragraph.join(" "))}</p>`; paragraph = []; } };
  const closeBlocks = () => { flushParagraph(); };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("```")) {
      closeBlocks();
      if (inCode) { html += `<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`; code = []; }
      inCode = !inCode; continue;
    }
    if (inCode) { code.push(line); continue; }
    const trimmed = line.trim();
    const singleLineMath = trimmed.match(/^\$\$(.+)\$\$$/);
    if (singleLineMath) {
      closeBlocks();
      html += `<div class="math-block">${renderLatex(singleLineMath[1], true)}</div>`;
      continue;
    }
    if (trimmed === "$$" || trimmed === ">$$") {
      closeBlocks();
      const mathLines = [];
      const quoted = trimmed.startsWith(">");
      while (++i < lines.length && !/^>?\$\$$/.test(lines[i].trim())) {
        mathLines.push(quoted ? lines[i].replace(/^>\s?/, "") : lines[i]);
      }
      html += `<div class="math-block">${renderLatex(mathLines.join("\n"), true)}</div>`;
      continue;
    }
    if (/^\s*\|.+\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) {
      closeBlocks();
      const cells = row => row.trim().replace(/^\||\|$/g, "").split("|").map(cell => cell.trim());
      const headers = cells(line); i++;
      const rows = [];
      while (i + 1 < lines.length && /^\s*\|.+\|\s*$/.test(lines[i + 1])) rows.push(cells(lines[++i]));
      html += `<div class="table-wrap"><table><thead><tr>${headers.map(cell => `<th>${inline(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${inline(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) { closeBlocks(); const level = heading[1].length; const text = heading[2]; const id = text.replace(/[^\w\u4e00-\u9fa5]+/g, "-").replace(/^-|-$/g, ""); html += `<h${level} id="${id}">${inline(text)}</h${level}>`; continue; }
    const callout = line.match(/^>\s*\[!([^\]]+)\]\s*(.*)$/);
    if (callout) { closeBlocks(); html += `<aside class="callout"><div class="callout-title">${inline(callout[2] || callout[1])}</div></aside>`; continue; }
    if (/^>/.test(line)) { closeBlocks(); html += `<blockquote>${inline(line.replace(/^>\s?/, ""))}</blockquote>`; continue; }
    const listItem = parseListLine(line);
    if (listItem) {
      flushParagraph();
      const items = [listItem];
      while (i + 1 < lines.length) {
        const nextItem = parseListLine(lines[i + 1]);
        if (!nextItem) break;
        items.push(nextItem);
        i++;
      }
      html += renderListBlock(items);
      continue;
    }
    if (/^---+$/.test(line.trim())) { closeBlocks(); html += "<hr>"; continue; }
    if (!line.trim()) { closeBlocks(); continue; }
    paragraph.push(line.trim());
  }
  closeBlocks();
  return html;
}

async function loadNotes() {
  const [noteResponse, attachmentResponse] = await Promise.all([
    fetch("content/notes.json", { cache: "no-store" }),
    fetch("content/attachments.json", { cache: "no-store" }).catch(() => null)
  ]);
  if (!noteResponse.ok) throw new Error("无法读取笔记索引");
  state.notes = await noteResponse.json();
  if (attachmentResponse?.ok) state.attachments = await attachmentResponse.json();
  $("#noteCount").textContent = `${state.notes.length} 篇公开笔记`;
  renderTree();
  await route();
}

function groupedNotes() {
  return state.notes.reduce((groups, note) => {
    const group = note.category || note.path.split("/")[0] || "未分类";
    (groups[group] ||= []).push(note);
    return groups;
  }, {});
}

function renderTree() {
  const activePath = decodeURIComponent(location.hash.match(/^#\/note\/(.+)$/)?.[1] || "");
  const activeCategory = state.notes.find(note => note.path === activePath)?.category;
  const saved = JSON.parse(localStorage.getItem("openCourseGroups") || "[]");
  $("#noteTree").innerHTML = Object.entries(groupedNotes()).map(([group, notes]) => {
    const isOpen = group === activeCategory || saved.includes(group);
    return `
    <section class="tree-group${isOpen ? "" : " collapsed"}" data-group="${escapeHtml(group)}">
      <button class="tree-title" type="button" aria-expanded="${isOpen}" aria-label="展开或收起${escapeHtml(group)}">
        <span>${escapeHtml(group)}</span><span class="tree-chevron" aria-hidden="true">⌄</span>
      </button>
      <div class="tree-items">
        ${notes.sort((a, b) => a.title.localeCompare(b.title, "zh-CN", { numeric: true })).map(note => `<a class="tree-link" data-path="${escapeHtml(note.path)}" href="#/note/${encodeURIComponent(note.path)}">${escapeHtml(note.title)}</a>`).join("")}
      </div>
    </section>`;
  }).join("");
}

function saveOpenGroups() {
  const openGroups = [...document.querySelectorAll(".tree-group:not(.collapsed)")].map(group => group.dataset.group);
  localStorage.setItem("openCourseGroups", JSON.stringify(openGroups));
}

function openNoteGroup(path) {
  const note = state.notes.find(item => item.path === path);
  if (!note) return;
  const group = [...document.querySelectorAll(".tree-group")].find(item => item.dataset.group === note.category);
  if (group?.classList.contains("collapsed")) {
    group.classList.remove("collapsed");
    group.querySelector(".tree-title").setAttribute("aria-expanded", "true");
    saveOpenGroups();
  }
}

function renderHome() {
  const groups = Object.entries(groupedNotes());
  $("#mainContent").innerHTML = `<div class="home">
    <section class="hero">
      <span class="hero-label">开放 · 系统 · 互助</span>
      <h1>把复杂的知识，<br>整理成清晰的路径。</h1>
      <p>这里收录公共卫生课程笔记、重点梳理与复习资料。愿每一次查阅，都让知识的轮廓更清楚一点。</p>
    </section>
    <section class="course-grid">
      ${groups.map(([group, notes], i) => `<a class="course-card" href="#/note/${encodeURIComponent(notes[0].path)}">
        <span class="course-index">0${i + 1} / COURSE</span>
        <h2>${escapeHtml(group)}</h2>
        <p>${notes.length} 篇笔记 · 持续整理</p><span class="course-arrow">↗</span>
      </a>`).join("")}
    </section>
  </div>`;
  document.title = "公卫研习室｜公共卫生课程笔记";
}

async function getNote(note) {
  if (state.loaded.has(note.path)) return state.loaded.get(note.path);
  const rawPath = note.file || `content/${note.path}`;
  const path = rawPath.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(path);
  if (!response.ok) throw new Error(`找不到笔记：${note.title}`);
  const content = await response.text();
  state.loaded.set(note.path, content);
  return content;
}

async function renderNote(path) {
  const note = state.notes.find(item => item.path === path);
  if (!note) return renderNotFound();
  state.currentNote = note;
  const source = await getNote(note);
  const parsed = parseFrontmatter(source);
  $("#mainContent").innerHTML = `<article class="note">
    <div class="breadcrumbs"><a href="#/">首页</a>　/　${escapeHtml(note.category || "笔记")}</div>
    <header class="note-header">
      <span class="eyebrow">${escapeHtml(note.category || "Public Health")}</span>
      <h1>${escapeHtml(note.title)}</h1>
      ${renderProperties(parsed.properties)}
      <div class="note-meta"><span>约 ${Math.max(1, Math.ceil(parsed.body.length / 600))} 分钟阅读</span></div>
    </header>
    <div class="markdown-body">${markdown(parsed.body)}</div>
  </article>`;
  document.title = `${note.title}｜公卫研习室`;
  openNoteGroup(path);
  document.querySelectorAll(".tree-link").forEach(link => link.classList.toggle("active", link.dataset.path === path));
  window.scrollTo(0, 0);
}

function renderNotFound(message = "没有找到这篇笔记") {
  $("#mainContent").innerHTML = `<div class="loading"><h2>${escapeHtml(message)}</h2><p><a href="#/">返回首页</a></p></div>`;
}

async function route() {
  closeSidebar();
  const match = location.hash.match(/^#\/note\/(.+)$/);
  try { match ? await renderNote(decodeURIComponent(match[1])) : renderHome(); }
  catch (error) { renderNotFound(error.message); }
}

async function search(query) {
  const q = query.trim().toLowerCase();
  if (!q) { $("#searchResults").innerHTML = '<div class="empty-result">输入关键词，搜索全部公开笔记</div>'; return; }
  const matches = [];
  await Promise.all(state.notes.map(async note => {
    const content = await getNote(note).catch(() => "");
    if (`${note.title} ${note.description || ""} ${content}`.toLowerCase().includes(q)) matches.push(note);
  }));
  $("#searchResults").innerHTML = matches.length ? matches.map(note => `<a class="result" href="#/note/${encodeURIComponent(note.path)}"><strong>${escapeHtml(note.title)}</strong><span>${escapeHtml(note.category || "未分类")} · ${escapeHtml(note.description || "打开查看笔记")}</span></a>`).join("") : '<div class="empty-result">没有找到相关内容，换个关键词试试</div>';
}

function openSearch() { $("#searchDialog").showModal(); $("#searchInput").value = ""; search(""); setTimeout(() => $("#searchInput").focus(), 30); }
function closeSidebar() { $("#sidebar").classList.remove("open"); $("#overlay").classList.remove("show"); }

$("#themeButton").addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("theme", next);
});
$("#searchTrigger").addEventListener("click", openSearch);
$("#searchClose").addEventListener("click", () => $("#searchDialog").close());
$("#searchInput").addEventListener("input", event => search(event.target.value));
$("#searchResults").addEventListener("click", () => $("#searchDialog").close());
$("#menuButton").addEventListener("click", () => { $("#sidebar").classList.add("open"); $("#overlay").classList.add("show"); });
$("#sidebarClose").addEventListener("click", closeSidebar);
$("#overlay").addEventListener("click", closeSidebar);
$("#noteTree").addEventListener("click", event => {
  const button = event.target.closest(".tree-title");
  if (!button) return;
  const group = button.closest(".tree-group");
  const collapsed = group.classList.toggle("collapsed");
  button.setAttribute("aria-expanded", String(!collapsed));
  saveOpenGroups();
});
window.addEventListener("hashchange", route);
window.addEventListener("keydown", event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); openSearch(); } });

document.documentElement.dataset.theme = localStorage.getItem("theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
loadNotes().catch(error => renderNotFound(`${error.message}，请确认已通过本地服务器打开网站。`));
