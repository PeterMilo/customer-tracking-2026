(function () {
  "use strict";

  var STORAGE_KEY = "ledger_time_tracker_v1";
  var MINUTES_PER_CLICK = 5;

  /** @type {{customers: Array<{id:string,name:string,tasks:Array<{id:string,name:string,minutes:number,kind:string}>}>}} */
  var state = loadState();

  var grid = document.getElementById("customerGrid");
  var emptyState = document.getElementById("emptyState");
  var totalTodayEl = document.getElementById("totalToday");
  var newCustomerInput = document.getElementById("newCustomerInput");
  var addCustomerBtn = document.getElementById("addCustomerBtn");
  var resetAllBtn = document.getElementById("resetAllBtn");

  // ---------- persistence ----------

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { customers: [] };
      var parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.customers)) return { customers: [] };
      parsed.customers.forEach(function (c) {
        if (!("activeTimer" in c) || c.activeTimer === undefined) c.activeTimer = null;
      });
      return parsed;
    } catch (e) {
      console.error("Could not read saved data, starting fresh.", e);
      return { customers: [] };
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.error("Could not save data.", e);
      alert("Your changes couldn't be saved locally. Your browser storage may be full or blocked.");
    }
  }

  // ---------- helpers ----------

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function formatMinutes(totalMinutes) {
    var h = Math.floor(totalMinutes / 60);
    var m = totalMinutes % 60;
    return h + "h " + String(m).padStart(2, "0") + "m";
  }

  function formatElapsed(ms) {
    var totalSeconds = Math.max(0, Math.floor(ms / 1000));
    var h = Math.floor(totalSeconds / 3600);
    var m = Math.floor((totalSeconds % 3600) / 60);
    var s = totalSeconds % 60;
    return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  }

  function defaultTasks() {
    return [
      { id: uid(), name: "Billable", minutes: 0, kind: "billable" },
      { id: uid(), name: "Account Management", minutes: 0, kind: "account" }
    ];
  }

  function findCustomer(customerId) {
    return state.customers.find(function (c) { return c.id === customerId; });
  }

  function findTask(customer, taskId) {
    return customer.tasks.find(function (t) { return t.id === taskId; });
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ---------- mutations ----------

  function addCustomer(name) {
    var trimmed = name.trim();
    if (!trimmed) return;
    state.customers.push({ id: uid(), name: trimmed, tasks: defaultTasks(), activeTimer: null });
    saveState();
    render();
  }

  function removeCustomer(customerId) {
    var customer = findCustomer(customerId);
    if (!customer) return;
    if (!confirm('Remove "' + customer.name + '" and all of its tracked time? This cannot be undone.')) return;
    state.customers = state.customers.filter(function (c) { return c.id !== customerId; });
    saveState();
    render();
  }

  function addMinutes(customerId, taskId, delta) {
    var customer = findCustomer(customerId);
    if (!customer) return;
    var task = findTask(customer, taskId);
    if (!task) return;
    task.minutes = Math.max(0, task.minutes + delta);
    saveState();
    renderTaskRow(customerId, taskId);
    updateCustomerTotal(customerId);
    updateGrandTotal();
  }

  function addCustomTask(customerId, name) {
    var trimmed = name.trim();
    if (!trimmed) return;
    var customer = findCustomer(customerId);
    if (!customer) return;
    customer.tasks.push({ id: uid(), name: trimmed, minutes: 0, kind: "custom" });
    saveState();
    render();
  }

  function removeTask(customerId, taskId) {
    var customer = findCustomer(customerId);
    if (!customer) return;
    customer.tasks = customer.tasks.filter(function (t) { return t.id !== taskId; });
    if (customer.activeTimer && customer.activeTimer.taskId === taskId) {
      customer.activeTimer = null;
    }
    saveState();
    render();
  }

  function startTimer(customerId, taskId) {
    var customer = findCustomer(customerId);
    if (!customer) return;
    var task = findTask(customer, taskId);
    if (!task) return;
    customer.activeTimer = { taskId: taskId, startedAt: Date.now() };
    saveState();
    renderCard(customerId);
  }

  function stopTimer(customerId) {
    var customer = findCustomer(customerId);
    if (!customer || !customer.activeTimer) return;
    var elapsedMs = Date.now() - customer.activeTimer.startedAt;
    var taskId = customer.activeTimer.taskId;
    var task = findTask(customer, taskId);
    var elapsedMinutes = Math.round(elapsedMs / 60000);
    if (task) task.minutes = Math.max(0, task.minutes + elapsedMinutes);
    customer.activeTimer = null;
    saveState();
    renderCard(customerId);
    if (task) renderTaskRow(customerId, taskId);
    updateCustomerTotal(customerId);
    updateGrandTotal();
  }

  function reorderCustomer(draggedId, targetId, insertAfter) {
    if (draggedId === targetId) return;
    var fromIndex = state.customers.findIndex(function (c) { return c.id === draggedId; });
    if (fromIndex === -1) return;
    var draggedItem = state.customers.splice(fromIndex, 1)[0];

    if (!targetId) {
      // No target card (dropped on empty grid space) — send to the end.
      state.customers.push(draggedItem);
    } else {
      var targetIndex = state.customers.findIndex(function (c) { return c.id === targetId; });
      if (targetIndex === -1) {
        state.customers.push(draggedItem);
      } else {
        state.customers.splice(insertAfter ? targetIndex + 1 : targetIndex, 0, draggedItem);
      }
    }
    saveState();
    render();
  }

  function resetAllTimers() {
    if (state.customers.length === 0) return;
    if (!confirm("Reset every timer for every customer back to zero? Customers and custom tasks stay, only the tracked time is cleared.")) return;
    state.customers.forEach(function (c) {
      c.tasks.forEach(function (t) { t.minutes = 0; });
      c.activeTimer = null;
    });
    saveState();
    render();
  }

  // ---------- rendering ----------

  function taskRowHtml(customerId, task) {
    return (
      '<div class="task-row ' + task.kind + '" data-task-id="' + task.id + '">' +
        '<div class="task-info">' +
          '<div class="task-name">' + escapeHtml(task.name) + '</div>' +
          '<div class="task-time">' + formatMinutes(task.minutes) + '</div>' +
        '</div>' +
        '<div class="task-actions">' +
          '<button class="pill-btn subtract" data-action="subtract" title="Remove 5 minutes">−</button>' +
          '<button class="pill-btn add" data-action="add" title="Add 5 minutes">+5</button>' +
          (task.kind === "custom"
            ? '<button class="task-remove" data-action="remove-task" title="Delete this task">✕</button>'
            : '') +
        '</div>' +
      '</div>'
    );
  }

  function liveTimerHtml(customer) {
    if (customer.tasks.length === 0) return "";

    if (customer.activeTimer) {
      var activeTask = findTask(customer, customer.activeTimer.taskId);
      var taskName = activeTask ? escapeHtml(activeTask.name) : "task";
      var elapsed = formatElapsed(Date.now() - customer.activeTimer.startedAt);
      return (
        '<div class="live-timer running">' +
          '<span class="rec-dot" aria-hidden="true"></span>' +
          '<span class="live-timer-label">Tracking <strong>' + taskName + '</strong></span>' +
          '<span class="live-timer-clock" data-role="live-clock">' + elapsed + '</span>' +
          '<button class="btn btn-stop" data-action="stop-timer">Stop</button>' +
        '</div>'
      );
    }

    var options = customer.tasks.map(function (t) {
      return '<option value="' + t.id + '">' + escapeHtml(t.name) + '</option>';
    }).join("");

    return (
      '<div class="live-timer">' +
        '<select data-role="timer-task-select" aria-label="Task to track">' + options + '</select>' +
        '<button class="btn btn-start" data-action="start-timer">Start</button>' +
      '</div>'
    );
  }

  function customerCardHtml(customer) {
    var total = customer.tasks.reduce(function (sum, t) { return sum + t.minutes; }, 0);
    var rows = customer.tasks.map(function (t) { return taskRowHtml(customer.id, t); }).join("");
    return (
      '<div class="card" data-customer-id="' + customer.id + '" draggable="false">' +
        '<div class="card-head">' +
          '<span class="drag-handle" title="Drag to reorder" aria-hidden="true">⠿</span>' +
          '<div class="card-title">' + escapeHtml(customer.name) + '</div>' +
          '<div class="card-total" data-role="customer-total">' + formatMinutes(total) + '</div>' +
          '<button class="card-remove" data-action="remove-customer" title="Remove customer">✕</button>' +
        '</div>' +
        liveTimerHtml(customer) +
        rows +
        '<div class="add-task-row">' +
          '<input type="text" placeholder="Custom task name…" maxlength="40" data-role="new-task-input" />' +
          '<button class="add-task-btn" data-action="add-task">+ Task</button>' +
        '</div>' +
      '</div>'
    );
  }

  function render() {
    grid.innerHTML = state.customers.map(customerCardHtml).join("");
    emptyState.hidden = state.customers.length > 0;
    updateGrandTotal();
  }

  function renderCard(customerId) {
    var customer = findCustomer(customerId);
    var oldCard = grid.querySelector('.card[data-customer-id="' + customerId + '"]');
    if (!customer || !oldCard) return;
    var wrapper = document.createElement("div");
    wrapper.innerHTML = customerCardHtml(customer);
    oldCard.replaceWith(wrapper.firstElementChild);
  }

  function tickClocks() {
    state.customers.forEach(function (c) {
      if (!c.activeTimer) return;
      var clockEl = grid.querySelector('.card[data-customer-id="' + c.id + '"] [data-role="live-clock"]');
      if (clockEl) clockEl.textContent = formatElapsed(Date.now() - c.activeTimer.startedAt);
    });
  }

  function renderTaskRow(customerId, taskId) {
    var customer = findCustomer(customerId);
    var task = findTask(customer, taskId);
    var row = grid.querySelector('.card[data-customer-id="' + customerId + '"] .task-row[data-task-id="' + taskId + '"]');
    if (!row || !task) return;
    var timeEl = row.querySelector(".task-time");
    timeEl.textContent = formatMinutes(task.minutes);
    timeEl.classList.remove("pulse");
    void timeEl.offsetWidth; // restart animation
    timeEl.classList.add("pulse");
  }

  function updateCustomerTotal(customerId) {
    var customer = findCustomer(customerId);
    if (!customer) return;
    var total = customer.tasks.reduce(function (sum, t) { return sum + t.minutes; }, 0);
    var el = grid.querySelector('.card[data-customer-id="' + customerId + '"] [data-role="customer-total"]');
    if (el) el.textContent = formatMinutes(total);
  }

  function updateGrandTotal() {
    var total = state.customers.reduce(function (sum, c) {
      return sum + c.tasks.reduce(function (s, t) { return s + t.minutes; }, 0);
    }, 0);
    totalTodayEl.textContent = formatMinutes(total);
  }

  // ---------- events ----------

  addCustomerBtn.addEventListener("click", function () {
    addCustomer(newCustomerInput.value);
    newCustomerInput.value = "";
    newCustomerInput.focus();
  });

  newCustomerInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") addCustomerBtn.click();
  });

  resetAllBtn.addEventListener("click", resetAllTimers);

  grid.addEventListener("click", function (e) {
    var actionEl = e.target.closest("[data-action]");
    if (!actionEl) return;
    var card = e.target.closest(".card[data-customer-id]");
    if (!card) return;
    var customerId = card.getAttribute("data-customer-id");
    var action = actionEl.getAttribute("data-action");

    if (action === "remove-customer") {
      removeCustomer(customerId);
      return;
    }
    if (action === "add-task") {
      var input = card.querySelector('[data-role="new-task-input"]');
      addCustomTask(customerId, input.value);
      return;
    }
    if (action === "start-timer") {
      var select = card.querySelector('[data-role="timer-task-select"]');
      if (select) startTimer(customerId, select.value);
      return;
    }
    if (action === "stop-timer") {
      stopTimer(customerId);
      return;
    }

    var taskRow = e.target.closest(".task-row[data-task-id]");
    if (taskRow) {
      var taskId = taskRow.getAttribute("data-task-id");
      if (action === "add") addMinutes(customerId, taskId, MINUTES_PER_CLICK);
      if (action === "subtract") addMinutes(customerId, taskId, -MINUTES_PER_CLICK);
      if (action === "remove-task") removeTask(customerId, taskId);
    }
  });

  grid.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && e.target.matches('[data-role="new-task-input"]')) {
      var card = e.target.closest(".card[data-customer-id]");
      addCustomTask(card.getAttribute("data-customer-id"), e.target.value);
    }
  });

  // ---------- drag-and-drop reordering ----------
  // Only the small grip icon (.drag-handle) arms dragging on its card, so
  // clicking/selecting text in buttons and inputs elsewhere is unaffected.

  var dropIndicatorClasses = ["drag-over-top", "drag-over-bottom"];

  function clearDragIndicators() {
    grid.querySelectorAll(".card").forEach(function (c) {
      c.classList.remove(dropIndicatorClasses[0], dropIndicatorClasses[1]);
    });
  }

  grid.addEventListener("mousedown", function (e) {
    var handle = e.target.closest(".drag-handle");
    var card = e.target.closest(".card[data-customer-id]");
    if (card) card.setAttribute("draggable", handle ? "true" : "false");
  });

  grid.addEventListener("dragstart", function (e) {
    var card = e.target.closest(".card[data-customer-id]");
    if (!card || card.getAttribute("draggable") !== "true") return;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", card.getAttribute("data-customer-id"));
    card.classList.add("dragging");
  });

  grid.addEventListener("dragend", function (e) {
    var card = e.target.closest(".card[data-customer-id]");
    if (card) {
      card.classList.remove("dragging");
      card.setAttribute("draggable", "false");
    }
    clearDragIndicators();
  });

  grid.addEventListener("dragover", function (e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    var card = e.target.closest(".card[data-customer-id]");
    if (!card || card.classList.contains("dragging")) {
      clearDragIndicators();
      return;
    }
    var rect = card.getBoundingClientRect();
    var isAfter = (e.clientY - rect.top) > rect.height / 2;
    clearDragIndicators();
    card.classList.add(isAfter ? "drag-over-bottom" : "drag-over-top");
  });

  grid.addEventListener("drop", function (e) {
    e.preventDefault();
    var draggedId = e.dataTransfer.getData("text/plain");
    if (!draggedId) return;
    var card = e.target.closest(".card[data-customer-id]");
    if (!card) {
      reorderCustomer(draggedId, null, false);
    } else {
      var targetId = card.getAttribute("data-customer-id");
      var rect = card.getBoundingClientRect();
      var isAfter = (e.clientY - rect.top) > rect.height / 2;
      reorderCustomer(draggedId, targetId, isAfter);
    }
    clearDragIndicators();
  });

  // ---------- init ----------

  render();
  tickClocks();
  setInterval(tickClocks, 1000);

  // Keep running timers accurate/paused correctly if the tab is hidden and
  // the browser throttles timers - resync the moment it's visible again.
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) tickClocks();
  });
})();
