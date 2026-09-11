// AUTO-GENERATED from backend/src — do not edit. Run `node scripts/sync-edge-shared.mjs`.
/**
 * Enhances the existing self-contained admin page with a server-backed user
 * browser. The original page stays small and stable; this module only replaces
 * the user-list renderer and adds controls for SQL-backed filters/sorting.
 */
const STYLE = `
  .admin-user-controls{display:grid;gap:10px;margin-top:10px;padding:12px;border:1px solid var(--line);border-radius:14px;background:var(--surface-soft)}
  .admin-user-controls[hidden]{display:none!important}.admin-user-filter-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.admin-user-filter{display:grid;gap:5px;min-width:0}.admin-user-filter span{color:var(--mut);font-size:10px;font-weight:700}.admin-user-filter input,.admin-user-filter select{width:100%;min-width:0;min-height:39px;padding:7px 9px;font-size:11px}.admin-user-filter-actions{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}.admin-user-summary{color:var(--mut);font-size:11px;font-variant-numeric:tabular-nums}
  .admin-sort{display:inline-flex;align-items:center;gap:5px;padding:0;border:0;background:transparent;color:inherit;font:inherit;font-weight:inherit;cursor:pointer;white-space:nowrap}.admin-sort:hover{color:var(--brand)}.admin-sort-indicator{display:inline-grid;width:16px;height:16px;place-items:center;border-radius:5px;background:#eeeae4;color:#8a8178;font-size:9px;line-height:1}.admin-sort.on{color:var(--brand)}.admin-sort.on .admin-sort-indicator{background:var(--brand-soft);color:var(--brand)}
  .admin-pagination{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:10px;padding:9px 4px 0}.admin-page-buttons{display:flex;align-items:center;gap:5px;flex-wrap:wrap}.admin-page-button{min-width:34px;min-height:34px;padding:4px 8px;border:1px solid var(--line);border-radius:9px;background:var(--surface);color:var(--txt);font-weight:700;cursor:pointer}.admin-page-button:hover:not(:disabled){border-color:#d6c5b5;background:var(--surface-soft)}.admin-page-button.on{border-color:var(--brand);background:var(--brand);color:#fff}.admin-page-button:disabled{cursor:not-allowed;opacity:.45}.admin-page-meta{color:var(--mut);font-size:11px;font-variant-numeric:tabular-nums}
  @media (min-width:760px){.admin-user-filter-grid{grid-template-columns:repeat(4,minmax(0,1fr))}}
`;

const SCRIPT = `
const adminUserListState = {
  page: 1,
  pageSize: 100,
  sort: "createdAt",
  direction: "desc",
  lastQuery: "",
};

const userSearchRow = $("#uq")?.closest(".row");
if (userSearchRow && !$("#uFilterToggle")) {
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.id = "uFilterToggle";
  toggle.className = "btn secondary";
  toggle.textContent = "فیلترها";
  userSearchRow.appendChild(toggle);

  const panel = document.createElement("div");
  panel.id = "uFilterPanel";
  panel.className = "admin-user-controls";
  panel.hidden = true;
  panel.innerHTML =
    '<div class="admin-user-filter-grid">' +
      '<label class="admin-user-filter"><span>وضعیت اشتراک</span><select id="uSubscription"><option value="all">همه</option><option value="active">فعال</option><option value="expired">منقضی</option><option value="none">بدون اشتراک</option></select></label>' +
      '<label class="admin-user-filter"><span>حداقل روز فعال</span><input id="uMinActive" type="number" min="0" inputmode="numeric" placeholder="مثلاً ۵"></label>' +
      '<label class="admin-user-filter"><span>حداکثر روز فعال</span><input id="uMaxActive" type="number" min="0" inputmode="numeric" placeholder="بدون محدودیت"></label>' +
      '<label class="admin-user-filter"><span>حداقل حجم داده (MB)</span><input id="uMinData" type="number" min="0" step="0.01" inputmode="decimal" placeholder="مثلاً ۱"></label>' +
      '<label class="admin-user-filter"><span>ثبت‌نام از</span><input id="uRegisteredFrom" type="date"></label>' +
      '<label class="admin-user-filter"><span>ثبت‌نام تا</span><input id="uRegisteredTo" type="date"></label>' +
      '<label class="admin-user-filter"><span>آخرین حضور از</span><input id="uActiveFrom" type="date"></label>' +
      '<label class="admin-user-filter"><span>آخرین حضور تا</span><input id="uActiveTo" type="date"></label>' +
      '<label class="admin-user-filter"><span>انقضا از</span><input id="uExpiresFrom" type="date"></label>' +
      '<label class="admin-user-filter"><span>انقضا تا</span><input id="uExpiresTo" type="date"></label>' +
    '</div>' +
    '<div class="admin-user-filter-actions"><span class="admin-user-summary" id="uFilterHint">مرتب‌سازی با فلش کنار عنوان ستون‌ها انجام می‌شود.</span><span><button class="btn secondary mini" type="button" id="uClearFilters">پاک کردن</button> <button class="btn mini" type="button" id="uApplyFilters">اعمال فیلتر</button></span></div>';
  userSearchRow.insertAdjacentElement("afterend", panel);

  toggle.onclick = () => { panel.hidden = !panel.hidden; };
  $("#uApplyFilters").onclick = () => { adminUserListState.page = 1; loadUsers(); };
  $("#uClearFilters").onclick = () => {
    ["#uMinActive", "#uMaxActive", "#uMinData", "#uRegisteredFrom", "#uRegisteredTo", "#uActiveFrom", "#uActiveTo", "#uExpiresFrom", "#uExpiresTo"].forEach((id) => { $(id).value = ""; });
    $("#uSubscription").value = "all";
    adminUserListState.page = 1;
    loadUsers();
  };
}

function adminUserDateParam(id, endOfDay) {
  const value = $(id)?.value;
  if (!value) return "";
  return value + (endOfDay ? "T23:59:59.999Z" : "T00:00:00.000Z");
}

function adminUserNumericParam(id) {
  const raw = $(id)?.value;
  if (raw === "" || raw == null) return "";
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? String(Math.trunc(value)) : "";
}

function adminUserDataBytesParam(id) {
  const raw = $(id)?.value;
  if (raw === "" || raw == null) return "";
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? String(Math.round(value * 1024 * 1024)) : "";
}

function adminUserQuery() {
  const params = new URLSearchParams();
  const q = $("#uq").value.trim();
  if (q) params.set("q", q);
  params.set("page", String(adminUserListState.page));
  params.set("limit", String(adminUserListState.pageSize));
  params.set("sort", adminUserListState.sort);
  params.set("direction", adminUserListState.direction);

  const subscription = $("#uSubscription")?.value || "all";
  if (subscription !== "all") params.set("subscription", subscription);
  const minActiveDays = adminUserNumericParam("#uMinActive");
  const maxActiveDays = adminUserNumericParam("#uMaxActive");
  const minDataBytes = adminUserDataBytesParam("#uMinData");
  if (minActiveDays) params.set("minActiveDays", minActiveDays);
  if (maxActiveDays) params.set("maxActiveDays", maxActiveDays);
  if (minDataBytes) params.set("minDataBytes", minDataBytes);

  const dates = [
    ["registeredFrom", adminUserDateParam("#uRegisteredFrom", false)],
    ["registeredTo", adminUserDateParam("#uRegisteredTo", true)],
    ["activeFrom", adminUserDateParam("#uActiveFrom", false)],
    ["activeTo", adminUserDateParam("#uActiveTo", true)],
    ["expiresFrom", adminUserDateParam("#uExpiresFrom", false)],
    ["expiresTo", adminUserDateParam("#uExpiresTo", true)],
  ];
  dates.forEach(([key, value]) => { if (value) params.set(key, value); });
  return params;
}

function adminSortHeader(label, key) {
  const active = adminUserListState.sort === key;
  const arrow = !active ? "↕" : adminUserListState.direction === "asc" ? "↑" : "↓";
  return '<button class="admin-sort' + (active ? ' on' : '') + '" type="button" data-user-sort="' + key + '"><span>' + esc(label) + '</span><span class="admin-sort-indicator" aria-hidden="true">' + arrow + '</span></button>';
}

function adminSubscriptionCell(user) {
  if (user.subscriptionActive) return "<span class='pill ok'>" + esc(user.planId || "فعال") + "</span>";
  if (user.subscriptionStatus === "expired" || user.expiresAt) return "<span class='pill bad'>منقضی</span>";
  return "<span class='pill mut'>بدون اشتراک</span>";
}

function adminPageButtons(pagination) {
  const totalPages = Math.max(1, Number(pagination.totalPages || 1));
  const page = Math.min(Math.max(1, Number(pagination.page || 1)), totalPages);
  const start = Math.max(1, Math.min(page - 2, totalPages - 4));
  const end = Math.min(totalPages, start + 4);
  let html = '<button class="admin-page-button" type="button" data-user-page="' + (page - 1) + '"' + (page <= 1 ? ' disabled' : '') + '>قبلی</button>';
  for (let i = start; i <= end; i += 1) {
    html += '<button class="admin-page-button' + (i === page ? ' on' : '') + '" type="button" data-user-page="' + i + '">' + fa(i) + '</button>';
  }
  html += '<button class="admin-page-button" type="button" data-user-page="' + (page + 1) + '"' + (page >= totalPages ? ' disabled' : '') + '>بعدی</button>';
  return html;
}

async function loadUsers() {
  loading("uResults", 3);
  const q = $("#uq").value.trim();
  if (q !== adminUserListState.lastQuery) {
    adminUserListState.lastQuery = q;
    adminUserListState.page = 1;
  }
  try {
    const result = await api("/users?" + adminUserQuery().toString());
    const pagination = result.pagination || { page: 1, pageSize: result.users.length || 100, total: result.users.length, totalPages: 1 };
    adminUserListState.page = Number(pagination.page || 1);
    if (!result.users.length) {
      $("#uResults").innerHTML = emptyState(q ? "کاربری با این شماره یا نام کاربری و فیلترهای فعلی پیدا نشد." : "کاربری با فیلترهای فعلی پیدا نشد.");
      return;
    }

    openDetailByTarget.uResults = null;
    const labels = ["کاربر", "روز فعال", "آخرین حضور", "حجم داده", "رکورد", "اشتراک", "انقضا", "ثبت‌نام"];
    const head = [
      adminSortHeader("کاربر", "name"),
      adminSortHeader("روز فعال", "activeDays"),
      adminSortHeader("آخرین حضور", "lastActiveAt"),
      adminSortHeader("حجم داده", "syncDataBytes"),
      adminSortHeader("رکورد", "syncRecordCount"),
      adminSortHeader("اشتراک", "subscription"),
      adminSortHeader("انقضا", "expiresAt"),
      adminSortHeader("ثبت‌نام", "createdAt"),
    ].map((value) => "<th>" + value + "</th>").join("");
    const body = result.users.map((u) => expandablePair([
      identityCell(u.phone, u.username),
      fa(u.activeDays),
      dt(u.lastActiveAt),
      formatBytes(u.syncDataBytes),
      fa(u.syncRecordCount),
      adminSubscriptionCell(u),
      dt(u.expiresAt),
      dt(u.createdAt),
    ], labels, u.id, "user-" + u.id, 8)).join("");

    const first = pagination.total ? (pagination.page - 1) * pagination.pageSize + 1 : 0;
    const last = Math.min(pagination.total, pagination.page * pagination.pageSize);
    $("#uResults").innerHTML =
      '<div class="table-wrap responsive-table"><table><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>' +
      '<div class="admin-pagination"><span class="admin-page-meta">نمایش ' + fa(first) + ' تا ' + fa(last) + ' از ' + fa(pagination.total) + ' کاربر · صفحه ' + fa(pagination.page) + ' از ' + fa(pagination.totalPages) + '</span><span class="admin-page-buttons">' + adminPageButtons(pagination) + '</span></div>';

    bindExpandableRows("uResults");
    document.querySelectorAll("#uResults [data-user-sort]").forEach((button) => {
      button.onclick = (event) => {
        event.stopPropagation();
        const key = button.dataset.userSort;
        if (adminUserListState.sort === key) adminUserListState.direction = adminUserListState.direction === "asc" ? "desc" : "asc";
        else {
          adminUserListState.sort = key;
          adminUserListState.direction = key === "name" ? "asc" : "desc";
        }
        adminUserListState.page = 1;
        loadUsers();
      };
    });
    document.querySelectorAll("#uResults [data-user-page]").forEach((button) => {
      button.onclick = () => {
        if (button.disabled) return;
        adminUserListState.page = Number(button.dataset.userPage || 1);
        loadUsers();
      };
    });
  } catch (error) {
    errorState("uResults", error.message || "فهرست کاربران دریافت نشد", loadUsers);
  }
}

$("#uSearch").onclick = () => { adminUserListState.page = 1; loadUsers(); };
`;

export function withAdminUserListUi(page: string): string {
  const styleMarker = "</style>";
  const bootMarker = "boot();\n</script>";
  if (!page.includes(styleMarker) || !page.includes(bootMarker)) {
    throw new Error("admin user list UI markers no longer match ADMIN_PAGE");
  }
  return page
    .replace(styleMarker, `${STYLE}\n</style>`)
    .replace(bootMarker, `${SCRIPT}\nboot();\n</script>`);
}
