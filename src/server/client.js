// Comment client injected into every artifact by the plugin.
//
// Reads window.__ARTIFACT__ = { id, server }. Highlight text, add a comment, and
// the comment is posted to the shared comment server, which dispatches it into
// the OpenCode session that published the artifact.
(function () {
  if (window.__ARTIFACT_CLIENT__) return;
  window.__ARTIFACT_CLIENT__ = true;

  var CFG = window.__ARTIFACT__ || {};
  var ID = CFG.id || "unknown";
  var BASE = (CFG.server || "").replace(/\/$/, "") || (location.origin.startsWith("http") ? location.origin : "http://127.0.0.1:4789");

  var css = document.createElement("style");
  css.textContent = [
    ".cmt-fab{position:fixed;z-index:2147483000;display:none;background:#0f172a;color:#fff;border:0;border-radius:8px;padding:6px 10px;font:600 12px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;cursor:pointer;box-shadow:0 4px 14px rgba(15,23,42,.25)}",
    ".cmt-pop{position:fixed;z-index:2147483001;width:330px;max-width:calc(100vw - 24px);background:#fff;border:1px solid #e2e8f0;border-radius:12px;box-shadow:0 12px 32px rgba(15,23,42,.18);padding:12px;display:none;font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a}",
    ".cmt-pop .q{font-size:12px;color:#475569;background:#f1f5f9;border-left:3px solid #94a3b8;padding:6px 8px;border-radius:6px;margin-bottom:8px;max-height:72px;overflow:auto}",
    ".cmt-pop textarea{width:100%;min-height:70px;resize:vertical;border:1px solid #cbd5e1;border-radius:8px;padding:8px;font:inherit;font-size:13px;box-sizing:border-box}",
    ".cmt-pop .row2{display:flex;gap:8px;justify-content:flex-end;margin-top:8px}",
    ".cmt-pop button{border:0;border-radius:8px;padding:7px 12px;font-size:12.5px;font-weight:600;cursor:pointer}",
    ".cmt-pop .send{background:#16a34a;color:#fff}",
    ".cmt-pop .send[disabled]{opacity:.6;cursor:default}",
    ".cmt-pop .cancel{background:#f1f5f9;color:#475569}",
    ".cmt-mark{background:#fef08a;border-bottom:2px solid #eab308;cursor:pointer;border-radius:2px}",
    ".cmt-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#0f172a;color:#fff;padding:10px 16px;border-radius:10px;font:13px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;z-index:2147483002;opacity:0;transition:opacity .2s;pointer-events:none;max-width:80vw;text-align:center}",
    ".cmt-toast.show{opacity:1}",
    ".cmt-count{position:fixed;right:18px;bottom:18px;background:#fff;border:1px solid #e2e8f0;border-radius:999px;padding:7px 12px;font:12px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#475569;box-shadow:0 4px 14px rgba(15,23,42,.12);z-index:2147483000}",
    ".cmt-count b{color:#0f172a}",
    ".cmt-count.off{color:#b45309;border-color:#fde68a;background:#fffbeb}"
  ].join("");
  document.head.appendChild(css);

  var fab = document.createElement("button");
  fab.className = "cmt-fab"; fab.textContent = "Add comment";
  var pop = document.createElement("div");
  pop.className = "cmt-pop";
  pop.innerHTML = '<div class="q"></div><textarea placeholder="What should change here?"></textarea><div class="row2"><button class="cancel">Cancel</button><button class="send">Send to session</button></div>';
  var toast = document.createElement("div"); toast.className = "cmt-toast";
  var count = document.createElement("div"); count.className = "cmt-count off"; count.textContent = "relay offline";
  document.body.appendChild(fab); document.body.appendChild(pop); document.body.appendChild(toast); document.body.appendChild(count);

  var quote = pop.querySelector(".q"), text = pop.querySelector("textarea");
  var sendBtn = pop.querySelector(".send"), cancelBtn = pop.querySelector(".cancel");
  var savedRange = null, savedSel = "", savedCtx = "", n = 0;

  function showToast(m) { toast.textContent = m; toast.classList.add("show"); setTimeout(function () { toast.classList.remove("show"); }, 2800); }
  function setCount() { count.classList.remove("off"); count.innerHTML = "<b>" + n + "</b> " + (n === 1 ? "comment" : "comments"); }
  function getContext(node) {
    var el = node && node.nodeType === 1 ? node : node && node.parentElement;
    if (!el || !el.closest) return "";
    var row = el.closest("tr") || el.closest("section") || el.closest("li") || el.closest("div");
    return row ? row.textContent.replace(/\s+/g, " ").trim().slice(0, 140) : "";
  }

  document.addEventListener("mouseup", function (e) {
    if (e.target.closest && (e.target.closest(".cmt-pop") || e.target.closest(".cmt-fab"))) return;
    var sel = window.getSelection();
    var t = sel ? sel.toString().trim() : "";
    if (t.length < 3 || sel.rangeCount === 0) { fab.style.display = "none"; return; }
    savedRange = sel.getRangeAt(0).cloneRange();
    savedSel = t; savedCtx = getContext(savedRange.startContainer);
    fab.style.display = "block";
    fab.style.left = Math.max(8, Math.min(e.clientX, window.innerWidth - 140)) + "px";
    fab.style.top = Math.min(e.clientY + 12, window.innerHeight - 44) + "px";
  });
  fab.addEventListener("mousedown", function (e) { e.preventDefault(); });
  fab.addEventListener("click", function () {
    fab.style.display = "none";
    quote.textContent = savedSel.length > 220 ? savedSel.slice(0, 220) + "..." : savedSel;
    pop.style.display = "block";
    var r = savedRange.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 346)) + "px";
    pop.style.top = Math.max(8, Math.min(r.bottom + 8, window.innerHeight - 230)) + "px";
    text.value = ""; text.focus();
  });
  cancelBtn.addEventListener("click", function () { pop.style.display = "none"; });
  sendBtn.addEventListener("click", function () {
    var c = text.value.trim();
    if (!c) { text.focus(); return; }
    sendBtn.disabled = true; sendBtn.textContent = "Sending...";
    fetch(BASE + "/comment", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ artifact: ID, selection: savedSel, context: savedCtx, comment: c })
    }).then(function (r) { return r.json(); }).then(function (d) {
      sendBtn.disabled = false; sendBtn.textContent = "Send to session";
      pop.style.display = "none";
      if (d && d.ok) { n++; setCount(); markRange(savedRange, c); showToast("Comment sent to the session"); }
      else { showToast("Saved, but dispatch failed. Check the server."); }
    }).catch(function () {
      sendBtn.disabled = false; sendBtn.textContent = "Send to session";
      pop.style.display = "none";
      showToast("Could not reach the comment server");
    });
  });

  function markRange(range, note) {
    if (!range) return;
    try { var s = document.createElement("span"); s.className = "cmt-mark"; s.title = note; range.surroundContents(s); } catch (e) {}
  }
  function rehighlight(txt, note) {
    var w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    while (w.nextNode()) {
      var node = w.currentNode;
      if (node.parentElement && node.parentElement.classList.contains("cmt-mark")) continue;
      var i = node.nodeValue.indexOf(txt);
      if (i >= 0) {
        var r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + txt.length);
        try { var s = document.createElement("span"); s.className = "cmt-mark"; s.title = note; r.surroundContents(s); } catch (e) {}
        return;
      }
    }
  }
  document.addEventListener("click", function (e) {
    var m = e.target.closest && e.target.closest(".cmt-mark");
    if (m && m.title) showToast(m.title);
  });

  fetch(BASE + "/comments?artifact=" + encodeURIComponent(ID))
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (!d || !d.comments) return;
      n = d.comments.length; setCount();
      d.comments.forEach(function (c) { if (c.selection) rehighlight(c.selection, c.comment); });
    }).catch(function () {});
})();
