// AUTO-GENERATED from backend/src — do not edit. Run `node scripts/sync-edge-shared.mjs`.
/**
 * Enhances the existing self-contained admin page with a server-backed user
 * browser. The original page stays small and stable; this module only replaces
 * the user-list renderer and adds controls for SQL-backed filters/sorting.
 */
const STYLE = `
  .admin-user-controls{display:grid;gap:10px;margin-top:10px;padding:12px;border:1px solid var(--line);border-radius:14px;background:var(--surface-soft)}
  .admin-user-controls[hidden]{display:none!important}.admin-user-filter-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.admin-user-filter{display:grid;gap:5px;min-width:0}.admin-user-filter span{color:var(--mut);font-size:10px;font-weight:700}.admin-user-filter input,.admin-user-filter select{width:100%;min-width:0;min-height:39px;padding:7px 9px;font-size:11px}.admin-user-filter-actions{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}.admin-user-summary{color:var(--mut);font-size:11px;font-weight:600;font-variant-numeric:tabular-nums}
  .admin-sort{display:inline-flex;align-items:center;gap:5px;padding:0;border:0;background:transparent;color:inherit;font:inherit;font-weight:inherit;cursor:pointer;white-space:nowrap}.admin-sort:hover{color:var(--brand)}.admin-sort-indicator{display:inline-grid;width:16px;height:16px;place-items:center;border-radius:5px;background:#eeeae4;color:#8a8178;font-size:9px;line-height:1}.admin-sort.on{color:var(--brand)}.admin-sort.on .admin-sort-indicator{background:var(--brand-soft);color:var(--brand)}
  .admin-pagination{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:10px;padding:9px 4px 0}.admin-page-buttons{display:flex;align-items:center;gap:5px;flex-wrap:wrap}.admin-page-button{min-width:70px;min-height:34px;padding:4px 10px;border:1px solid var(--line);border-radius:9px;background:var(--surface);color:var(--txt);font-weight:700;cursor:pointer}.admin-page-button:hover:not(:disabled){border-color:#d6c5b5;background:var(--surface-soft)}.admin-page-button:disabled{cursor:not-allowed;opacity:.45}.admin-page-meta{color:var(--mut);font-size:11px;font-variant-numeric:tabular-nums}
  @media (min-width:760px){.admin-user-filter-grid{grid-template-columns:repeat(4,minmax(0,1fr))}}
`;

const SCRIPT = `
const adminUserListState = {
  cursor: null,
  history: [],
  nextCursor: null,
  page: 1,
  pageSize: 100,
  sort: "createdAt",
  direction: "desc",
  lastQuery: "",
};

function adminResetUserPagination() {
  adminUserListState.cursor = null;
  adminUserListState.history = [];
  adminUserListState.nextCursor = null;
  adminUserListState.page = 1;
}

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
      '<label class="admin-user-filter"><span>حداکثر حجم داده (MB)</span><input id="uMaxData" type="number" min="0" step="0.01" inputmode="decimal" placeholder="بدون محدودیت"></label>' +
      '<label class="admin-user-filter"><span>ثبت‌نام از</span><input id="uRegisteredFrom" type="date"></label>' +
      '<label class="admin-user-filter"><span>ثبت‌نام تا</span><input id="uRegisteredTo" type="date"></label>' +
      '<label class="admin-user-filter"><span>آخرین حضور از</span><input id="uActiveFrom" type="date"></label>' +
      '<label class="admin-user-filter"><span>آخرین حضور تا</span><input id="uActiveTo" type="date"></label>' +
      '<label class="admin-user-filter"><span>انقضا از</span><input id="uExpiresFrom" type="date"></label>' +
      '<label class="admin-user-filter"><span>انقضا تا</span><input id="uExpiresTo" type="date"></label>' +
    '</div>' +
    '<div class="admin-user-filter-actions"><span class="admin-user-summary" id="uFilterHint">هر صفحه حداکثر ۱۰۰ کاربر · مرتب‌سازی با فلش کنار ستون‌ها</span><span><button class="btn secondary mini" type="button" id="uClearFilters">پاک کردن</button> <button class="btn mini" type="button" id="uApplyFilters">اعمال فیلتر</button></span></div>';
  userSearchRow.insertAdjacentElement("afterend", panel);

  toggle.onclick = () => { panel.hidden = !panel.hidden; };
  $("#uApplyFilters").onclick = () => { adminResetUserPagination(); loadUsers(); };
  $("#uClearFilters").onclick = () => {
    ["#uMinActive", "#uMaxActive", "#uMinData", "#uMaxData", "#uRegisteredFrom", "#uRegisteredTo", "#uActiveFrom", "#uActiveTo", "#uExpiresFrom", "#uExpiresTo"].forEach((id) => { $(id).value = ""; });
    $("#uSubscription").value = "all";
    adminResetUserPagination();
    loadUsers();
  };
}

function adminUserDateParam(id, endOfDay) {
  const value = $(id)?.value;
  if (!value) return "";
  const date = new Date(value + (endOfDay ? "T23:59:59.999" : "T00:00:00"));
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
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
  if (adminUserListState.cursor) params.set("cursor", adminUserListState.cursor);
  params.set("limit", String(adminUserListState.pageSize));
  params.set("sort", adminUserListState.sort);
  params.set("direction", adminUserListState.direction);

  const subscription = $("#uSubscription")?.value || "all";
  if (subscription !== "all") params.set("subscription", subscription);
  const minActiveDays = adminUserNumericParam("#uMinActive");
  const maxActiveDays = adminUserNumericParam("#uMaxActive");
  const minDataBytes = adminUserDataBytesParam("#uMinData");
  const maxDataBytes = adminUserDataBytesParam("#uMaxData");
  if (minActiveDays) params.set("minActiveDays", minActiveDays);
  if (maxActiveDays) params.set("maxActiveDays", maxActiveDays);
  if (minDataBytes) params.set("minDataBytes", minDataBytes);
  if (maxDataBytes) params.set("maxDataBytes", maxDataBytes);

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

function adminUserPaginationControls(pagination, count) {
  const previousDisabled = adminUserListState.history.length === 0 ? " disabled" : "";
  const nextDisabled = pagination.hasNext && pagination.nextCursor ? "" : " disabled";
  return '<div class="admin-pagination"><span class="admin-page-meta">صفحه ' + fa(adminUserListState.page) + ' · ' + fa(count) + ' کاربر در این صفحه</span><span class="admin-page-buttons"><button class="admin-page-button" type="button" data-user-nav="previous"' + previousDisabled + '>قبلی</button><button class="admin-page-button" type="button" data-user-nav="next"' + nextDisabled + '>بعدی</button></span></div>';
}

async function loadUsers() {
  loading("uResults", 3);
  const q = $("#uq").value.trim();
  if (q !== adminUserListState.lastQuery) {
    adminUserListState.lastQuery = q;
    adminResetUserPagination();
  }
  try {
    const result = await api("/users?" + adminUserQuery().toString());
    const pagination = result.pagination || { pageSize: result.users.length || 100, hasNext: false, nextCursor: null };
    adminUserListState.nextCursor = pagination.nextCursor || null;

    if (!result.users.length) {
      $("#uResults").innerHTML = emptyState(q ? "کاربری با این شماره یا نام کاربری و فیلترهای فعلی پیدا نشد." : "کاربری با فیلترهای فعلی پیدا نشد.") + adminUserPaginationControls(pagination, 0);
    } else {
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

      $("#uResults").innerHTML =
        '<div class="table-wrap responsive-table"><table><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>' +
        adminUserPaginationControls(pagination, result.users.length);
      bindExpandableRows("uResults");
    }

    document.querySelectorAll("#uResults [data-user-sort]").forEach((button) => {
      button.onclick = (event) => {
        event.stopPropagation();
        const key = button.dataset.userSort;
        if (adminUserListState.sort === key) adminUserListState.direction = adminUserListState.direction === "asc" ? "desc" : "asc";
        else {
          adminUserListState.sort = key;
          adminUserListState.direction = key === "name" ? "asc" : "desc";
        }
        adminResetUserPagination();
        loadUsers();
      };
    });
    document.querySelectorAll("#uResults [data-user-nav]").forEach((button) => {
      button.onclick = () => {
        if (button.disabled) return;
        if (button.dataset.userNav === "next") {
          if (!adminUserListState.nextCursor) return;
          adminUserListState.history.push(adminUserListState.cursor);
          adminUserListState.cursor = adminUserListState.nextCursor;
          adminUserListState.page += 1;
        } else {
          adminUserListState.cursor = adminUserListState.history.pop() || null;
          adminUserListState.page = Math.max(1, adminUserListState.page - 1);
        }
        loadUsers();
      };
    });
  } catch (error) {
    errorState("uResults", error.message || "فهرست کاربران دریافت نشد", loadUsers);
  }
}

$("#uSearch").onclick = () => { adminResetUserPagination(); adminUserListState.lastQuery = $("#uq").value.trim(); loadUsers(); };
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
