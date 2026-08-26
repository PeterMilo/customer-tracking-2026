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
    state.customers.push({ id: uid(), name: trimmed, tasks: defaultTasks() });
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
    saveState();
    render();
  }

  function resetAllTimers() {
    if (state.customers.length === 0) return;
    if (!confirm("Reset every timer for every customer back to zero? Customers and custom tasks stay, only the tracked time is cleared.")) return;
    state.customers.forEach(function (c) {
      c.tasks.forEach(function (t) { t.minutes = 0; });
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

  function customerCardHtml(customer) {
    var total = customer.tasks.reduce(function (sum, t) { return sum + t.minutes; }, 0);
    var rows = customer.tasks.map(function (t) { return taskRowHtml(customer.id, t); }).join("");
    return (
      '<div class="card" data-customer-id="' + customer.id + '">' +
        '<div class="card-head">' +
          '<div class="card-title">' + escapeHtml(customer.name) + '</div>' +
          '<div class="card-total" data-role="customer-total">' + formatMinutes(total) + '</div>' +
          '<button class="card-remove" data-action="remove-customer" title="Remove customer">✕</button>' +
        '</div>' +
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

  // ---------- init ----------

  render();
})();
