const state = {
  rows: [],
  filters: {
    section: "All",
    date: "",
  },
  source: "",
};

// Legacy completion key (for migration)
const COMPLETION_KEY = "workouts-exercises-completed";
const completedExercises = new Set(JSON.parse(localStorage.getItem(COMPLETION_KEY) || "[]"));

// New user data storage
const USER_DATA_KEY = "workouts-user-data";
const WEIGHT_UNIT_KEY = "workouts-weight-unit";

let userData = JSON.parse(localStorage.getItem(USER_DATA_KEY) || "{}");
let weightUnit = localStorage.getItem(WEIGHT_UNIT_KEY) || "kg";

const sectionFilter = document.getElementById("sectionFilter");
const dateFilter = document.getElementById("dateFilter");
const dateOptions = document.getElementById("dateOptions");
const scheduleEl = document.getElementById("schedule");
const filterSummary = document.getElementById("filterSummary");
const dataSource = document.getElementById("dataSource");

const daysCompletedEl = document.getElementById("daysCompleted");
const daysTotalEl = document.getElementById("daysTotal");

const sectionOrder = ["Warm-up", "Main", "Cool-down", "Mobility", "Rest", "Pre-comp"];
const dayOrder = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

const openIndexedDb = () =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open("workouts-sqlite", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("files");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const readCachedDb = async () => {
  try {
    const db = await openIndexedDb();
    return await new Promise((resolve) => {
      const request = db.transaction("files").objectStore("files").get("workouts.sqlite");
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    });
  } catch (error) {
    return null;
  }
};

const cacheDb = async (buffer) => {
  try {
    const db = await openIndexedDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction("files", "readwrite");
      tx.objectStore("files").put(buffer, "workouts.sqlite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (error) {
    console.warn("Unable to cache SQLite DB", error);
  }
};

const formatDate = (iso) => {
  if (!iso) return "";
  const parsed = new Date(`${iso}T00:00:00`);
  return parsed.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
};

// Legacy save for backwards compatibility
const saveCompletion = () => {
  localStorage.setItem(COMPLETION_KEY, JSON.stringify(Array.from(completedExercises)));
};

// New user data save/load
const saveUserData = () => {
  localStorage.setItem(USER_DATA_KEY, JSON.stringify(userData));
};

const saveWeightUnit = () => {
  localStorage.setItem(WEIGHT_UNIT_KEY, weightUnit);
};

const getExerciseKey = (exercise) =>
  [exercise.date, exercise.section, exercise.exercise, exercise.sets, exercise.reps, exercise.rest]
    .filter(Boolean)
    .join("::");

const getUserData = (key) => {
  return userData[key] || { completed: false, weight: "", rpe: "", notes: "" };
};

const setUserData = (key, field, value) => {
  if (!userData[key]) {
    userData[key] = { completed: false, weight: "", rpe: "", notes: "" };
  }
  userData[key][field] = value;
  saveUserData();
};

const hasUserInputs = (key) => {
  const data = userData[key];
  if (!data) return false;
  return data.weight || data.rpe || data.notes;
};

const buildOptionList = (select, values) => {
  select.innerHTML = "";
  const allOption = document.createElement("option");
  allOption.value = "All";
  allOption.textContent = "All";
  select.appendChild(allOption);

  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });
};

const getDistinct = (rows, key) =>
  Array.from(new Set(rows.map((row) => row[key]).filter(Boolean)));

const sortSections = (values) =>
  [...values].sort((a, b) => {
    const indexA = sectionOrder.indexOf(a);
    const indexB = sectionOrder.indexOf(b);
    if (indexA === -1 && indexB === -1) return a.localeCompare(b);
    if (indexA === -1) return 1;
    if (indexB === -1) return -1;
    return indexA - indexB;
  });

const sortDays = (values) =>
  [...values].sort((a, b) => {
    const indexA = dayOrder.indexOf(a);
    const indexB = dayOrder.indexOf(b);
    if (indexA === -1 && indexB === -1) return a.localeCompare(b);
    if (indexA === -1) return 1;
    if (indexB === -1) return -1;
    return indexA - indexB;
  });

const isExerciseComplete = (exercise) => {
  const key = getExerciseKey(exercise);
  const data = getUserData(key);
  return completedExercises.has(key) || data.completed;
};

const isDayComplete = (rows, date) => {
  const dayExercises = rows.filter(r => r.date === date);
  if (dayExercises.length === 0) return false;
  return dayExercises.every(exercise => isExerciseComplete(exercise));
};

const updateProgress = () => {
  const dates = getDistinct(state.rows, "date");
  const totalDays = dates.length;
  const completedDays = dates.filter(date => isDayComplete(state.rows, date)).length;

  daysCompletedEl.textContent = completedDays;
  daysTotalEl.textContent = totalDays;
};

const applyFilters = () => {
  state.filters = {
    section: sectionFilter.value,
    date: dateFilter.value,
  };
  renderSchedule();
};

const filterRows = (rows, filters) =>
  rows.filter((row) => {
    if (filters.section !== "All" && row.section !== filters.section) return false;
    if (filters.date && row.date !== filters.date) return false;
    return true;
  });

const groupRowsByDate = (rows) => {
  const grouped = new Map();
  rows.forEach((row) => {
    if (!grouped.has(row.date)) {
      grouped.set(row.date, {
        date: row.date,
        day: row.day,
        phase: row.phase,
        week: row.week,
        sections: new Map(),
      });
    }
    const group = grouped.get(row.date);
    if (!group.sections.has(row.section)) {
      group.sections.set(row.section, []);
    }
    group.sections.get(row.section).push(row);
  });
  return Array.from(grouped.values()).sort((a, b) => a.date.localeCompare(b.date));
};

const createExerciseInputs = (exerciseKey, exerciseCard) => {
  const data = getUserData(exerciseKey);
  const shouldExpand = hasUserInputs(exerciseKey);

  // Toggle button
  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.className = "exercise-log-toggle";
  toggleBtn.innerHTML = shouldExpand
    ? '<span class="toggle-icon">−</span> Hide Log'
    : '<span class="toggle-icon">+</span> Log Weight & Notes';

  // Inputs container
  const inputsContainer = document.createElement("div");
  inputsContainer.className = "exercise-inputs" + (shouldExpand ? " expanded" : "");

  // Weight row
  const weightRow = document.createElement("div");
  weightRow.className = "exercise-input-row";

  const weightLabel = document.createElement("label");
  weightLabel.textContent = "Weight";
  weightLabel.className = "input-label";

  const weightInput = document.createElement("input");
  weightInput.type = "number";
  weightInput.step = "0.5";
  weightInput.min = "0";
  weightInput.placeholder = "0";
  weightInput.className = "exercise-weight-input";
  weightInput.value = data.weight || "";

  const unitSelect = document.createElement("select");
  unitSelect.className = "exercise-unit-select";
  unitSelect.innerHTML = `
    <option value="kg" ${weightUnit === "kg" ? "selected" : ""}>kg</option>
    <option value="lbs" ${weightUnit === "lbs" ? "selected" : ""}>lbs</option>
  `;

  const rpeLabel = document.createElement("label");
  rpeLabel.textContent = "RPE";
  rpeLabel.className = "input-label";

  const rpeSelect = document.createElement("select");
  rpeSelect.className = "exercise-rpe-select";
  rpeSelect.innerHTML = `
    <option value="">-</option>
    <option value="5" ${data.rpe === "5" ? "selected" : ""}>5</option>
    <option value="5.5" ${data.rpe === "5.5" ? "selected" : ""}>5.5</option>
    <option value="6" ${data.rpe === "6" ? "selected" : ""}>6</option>
    <option value="6.5" ${data.rpe === "6.5" ? "selected" : ""}>6.5</option>
    <option value="7" ${data.rpe === "7" ? "selected" : ""}>7</option>
    <option value="7.5" ${data.rpe === "7.5" ? "selected" : ""}>7.5</option>
    <option value="8" ${data.rpe === "8" ? "selected" : ""}>8</option>
    <option value="8.5" ${data.rpe === "8.5" ? "selected" : ""}>8.5</option>
    <option value="9" ${data.rpe === "9" ? "selected" : ""}>9</option>
    <option value="9.5" ${data.rpe === "9.5" ? "selected" : ""}>9.5</option>
    <option value="10" ${data.rpe === "10" ? "selected" : ""}>10</option>
  `;

  const weightGroup = document.createElement("div");
  weightGroup.className = "input-group weight-group";
  weightGroup.appendChild(weightLabel);
  const weightInputs = document.createElement("div");
  weightInputs.className = "weight-inputs";
  weightInputs.appendChild(weightInput);
  weightInputs.appendChild(unitSelect);
  weightGroup.appendChild(weightInputs);

  const rpeGroup = document.createElement("div");
  rpeGroup.className = "input-group rpe-group";
  rpeGroup.appendChild(rpeLabel);
  rpeGroup.appendChild(rpeSelect);

  weightRow.appendChild(weightGroup);
  weightRow.appendChild(rpeGroup);

  // Notes row
  const notesRow = document.createElement("div");
  notesRow.className = "exercise-notes-row";

  const notesLabel = document.createElement("label");
  notesLabel.textContent = "Notes";
  notesLabel.className = "input-label";

  const notesInput = document.createElement("textarea");
  notesInput.className = "exercise-user-notes";
  notesInput.placeholder = "How did it feel? Form cues, adjustments...";
  notesInput.rows = 2;
  notesInput.value = data.notes || "";

  notesRow.appendChild(notesLabel);
  notesRow.appendChild(notesInput);

  inputsContainer.appendChild(weightRow);
  inputsContainer.appendChild(notesRow);

  // Event handlers
  toggleBtn.addEventListener("click", () => {
    const isExpanded = inputsContainer.classList.contains("expanded");
    inputsContainer.classList.toggle("expanded");
    toggleBtn.innerHTML = isExpanded
      ? '<span class="toggle-icon">+</span> Log Weight & Notes'
      : '<span class="toggle-icon">−</span> Hide Log';
  });

  weightInput.addEventListener("input", () => {
    setUserData(exerciseKey, "weight", weightInput.value);
  });

  unitSelect.addEventListener("change", () => {
    weightUnit = unitSelect.value;
    saveWeightUnit();
    // Update all unit selects on the page
    document.querySelectorAll(".exercise-unit-select").forEach((sel) => {
      sel.value = weightUnit;
    });
  });

  rpeSelect.addEventListener("change", () => {
    setUserData(exerciseKey, "rpe", rpeSelect.value);
  });

  notesInput.addEventListener("input", () => {
    setUserData(exerciseKey, "notes", notesInput.value);
  });

  return { toggleBtn, inputsContainer };
};

const showRestDay = () => {
  filterSummary.textContent = "Rest day";
  scheduleEl.innerHTML = "";

  const restCard = document.createElement("div");
  restCard.className = "rest-day-card";
  restCard.innerHTML = `
    <div class="rest-day-icon">🧘</div>
    <h2 class="rest-day-title">No Training Today</h2>
    <p class="rest-day-message">Enjoy your rest day! Recovery is just as important as training.</p>
    <p class="rest-day-hint">Use the date filter to browse other sessions.</p>
  `;

  scheduleEl.appendChild(restCard);
};

const renderSchedule = () => {
  const filtered = filterRows(state.rows, state.filters);
  filterSummary.textContent = `Showing ${filtered.length} exercises`;
  scheduleEl.innerHTML = "";

  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No sessions match these filters.";
    scheduleEl.appendChild(empty);
    return;
  }

  const grouped = groupRowsByDate(filtered);

  grouped.forEach((session) => {
    const card = document.createElement("article");
    card.className = "day-card";

    const header = document.createElement("div");
    header.className = "day-header";

    const title = document.createElement("div");
    title.innerHTML = `<h2>${formatDate(session.date)}</h2>`;

    const meta = document.createElement("div");
    meta.className = "day-meta";
    meta.innerHTML = `<span>${session.day}</span><span>Week ${session.week}</span>`;

    const pill = document.createElement("div");
    pill.className = "phase-pill";
    pill.textContent = session.phase;

    header.appendChild(title);
    header.appendChild(meta);
    header.appendChild(pill);
    card.appendChild(header);

    const sectionEntries = Array.from(session.sections.entries()).sort((a, b) =>
      sortSections([a[0], b[0]]).indexOf(a[0]) - sortSections([a[0], b[0]]).indexOf(b[0])
    );

    sectionEntries.forEach(([section, exercises]) => {
      const block = document.createElement("div");
      block.className = "section-block";

      const headerRow = document.createElement("div");
      headerRow.className = "section-header";

      const title = document.createElement("div");
      title.className = "section-title";
      title.textContent = section;

      headerRow.appendChild(title);
      block.appendChild(headerRow);

      exercises.forEach((exercise) => {
        const exerciseCard = document.createElement("div");
        exerciseCard.className = "exercise-card";

        const exerciseKey = getExerciseKey(exercise);

        // Check both legacy and new storage for completion
        const legacyComplete = completedExercises.has(exerciseKey);
        const newData = getUserData(exerciseKey);
        const isComplete = legacyComplete || newData.completed;

        if (isComplete) {
          exerciseCard.classList.add("exercise-complete");
          // Migrate legacy to new storage
          if (legacyComplete && !newData.completed) {
            setUserData(exerciseKey, "completed", true);
          }
        }

        const header = document.createElement("div");
        header.className = "exercise-header";

        const name = document.createElement("div");
        name.className = "exercise-title";
        name.textContent = exercise.exercise;

        const meta = document.createElement("div");
        meta.className = "exercise-meta";
        meta.innerHTML = `
          <span>Sets: ${exercise.sets || "-"}</span>
          <span>Reps: ${exercise.reps || "-"}</span>
          <span>Rest: ${exercise.rest || "-"}</span>
        `;

        header.appendChild(name);
        header.appendChild(meta);
        exerciseCard.appendChild(header);

        // Add static notes from database if present
        if (exercise.notes) {
          const notes = document.createElement("div");
          notes.className = "exercise-notes";
          notes.textContent = exercise.notes;
          exerciseCard.appendChild(notes);
        }

        // Add collapsible user inputs
        const { toggleBtn, inputsContainer } = createExerciseInputs(exerciseKey, exerciseCard);
        exerciseCard.appendChild(toggleBtn);
        exerciseCard.appendChild(inputsContainer);

        // Complete button
        const button = document.createElement("button");
        button.type = "button";
        button.className = "exercise-complete-button";
        button.textContent = isComplete ? "Completed" : "Mark Complete";
        button.addEventListener("click", () => {
          const currentlyComplete = exerciseCard.classList.contains("exercise-complete");
          if (currentlyComplete) {
            exerciseCard.classList.remove("exercise-complete");
            button.textContent = "Mark Complete";
            setUserData(exerciseKey, "completed", false);
            completedExercises.delete(exerciseKey);
          } else {
            exerciseCard.classList.add("exercise-complete");
            button.textContent = "Completed";
            setUserData(exerciseKey, "completed", true);
            completedExercises.add(exerciseKey);
          }
          saveCompletion();
          updateProgress();
        });

        exerciseCard.appendChild(button);
        block.appendChild(exerciseCard);
      });

      card.appendChild(block);
    });

    scheduleEl.appendChild(card);
  });
};

const hydrateFilters = (rows) => {
  const sections = sortSections(getDistinct(rows, "section"));
  const dates = getDistinct(rows, "date").sort();

  buildOptionList(sectionFilter, sections);

  dateOptions.innerHTML = "";
  dates.forEach((date) => {
    const option = document.createElement("option");
    option.value = date;
    dateOptions.appendChild(option);
  });
};

const loadFromJson = async () => {
  const response = await fetch("data/data.json");
  if (!response.ok) {
    throw new Error("Unable to load fallback JSON data.");
  }
  const rows = await response.json();
  state.source = "JSON fallback";
  dataSource.textContent = "Data source: JSON fallback";
  return rows;
};

const loadFromSqlite = async () => {
  if (!window.initSqlJs) {
    throw new Error("sql.js failed to load.");
  }

  const SQL = await window.initSqlJs({
    locateFile: (file) => `vendor/sqljs/${file}`,
  });

  let buffer = await readCachedDb();
  if (!buffer) {
    const response = await fetch("data/workouts.sqlite");
    if (!response.ok) {
      throw new Error("Unable to fetch SQLite database.");
    }
    buffer = await response.arrayBuffer();
    await cacheDb(buffer);
    state.source = "SQLite (fresh)";
    dataSource.textContent = "Data source: SQLite (fresh load)";
  } else {
    state.source = "SQLite (cached)";
    dataSource.textContent = "Data source: SQLite (cached)";
  }

  const db = new SQL.Database(new Uint8Array(buffer));
  const stmt = db.prepare(
    "SELECT date, day, phase, week, section, exercise, sets, reps, rest, notes FROM workouts ORDER BY date, id"
  );
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
};

const getTodayISO = () => {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const findNearestDate = (dates, targetDate) => {
  if (!dates.length) return null;
  const sorted = [...dates].sort();

  // If target date exists, return it
  if (sorted.includes(targetDate)) return targetDate;

  // Find the next upcoming date
  const futureDate = sorted.find(d => d > targetDate);
  if (futureDate) return futureDate;

  // No future dates, return most recent past date
  return sorted[sorted.length - 1];
};

const init = async () => {
  filterSummary.textContent = "Loading schedule…";
  try {
    state.rows = await loadFromSqlite();
  } catch (error) {
    console.warn("SQLite load failed, falling back to JSON.", error);
    state.rows = await loadFromJson();
  }

  hydrateFilters(state.rows);
  updateProgress();

  // Check if today has a training session
  const todayISO = getTodayISO();
  const availableDates = getDistinct(state.rows, "date");
  const todayHasSession = availableDates.includes(todayISO);

  if (todayHasSession) {
    // Today has a session - select it
    dateFilter.value = todayISO;
    state.filters.date = todayISO;
    renderSchedule();
  } else {
    // Rest day - show rest message
    showRestDay();
  }

  sectionFilter.addEventListener("change", applyFilters);
  dateFilter.addEventListener("change", applyFilters);
  dateFilter.addEventListener("keyup", (event) => {
    if (event.key === "Enter") {
      applyFilters();
    }
  });

  // Jump to Today link
  const jumpToToday = document.getElementById("jumpToToday");
  jumpToToday.addEventListener("click", (e) => {
    e.preventDefault();
    const today = getTodayISO();
    const dates = getDistinct(state.rows, "date");
    if (dates.includes(today)) {
      dateFilter.value = today;
      state.filters.date = today;
      renderSchedule();
    } else {
      dateFilter.value = "";
      state.filters.date = "";
      showRestDay();
    }
  });
};

init();
