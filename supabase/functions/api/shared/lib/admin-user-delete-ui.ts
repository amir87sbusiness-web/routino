// AUTO-GENERATED from backend/src — do not edit. Run `node scripts/sync-edge-shared.mjs`.
/**
 * Adds the destructive account-deletion control to the self-contained admin page
 * without coupling the main dashboard renderer to deletion semantics.
 *
 * The server remains the authority: this UI only previews the target and requires
 * a typed confirmation; `/admin/users/:id/delete` re-checks the same identity in
 * a locked database transaction before deleting anything.
 */
const STYLE = `
  .delete-zone{margin-top:14px;padding:14px;border:1px solid #efb5ae;border-radius:14px;background:var(--bad-soft)}
  .delete-zone-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:10px}.delete-zone-head strong{color:var(--bad);font-size:12px}.delete-zone-head p{margin:2px 0 0;color:#875552;font-size:11px}
  .delete-preview{display:none;margin-top:10px;padding:11px 12px;border:1px solid #efb5ae;border-radius:11px;background:#fff;color:var(--txt)}.delete-preview.on{display:block}.delete-preview b{display:block}.delete-preview span{display:block;margin-top:2px;color:var(--mut);font-size:11px}
  .delete-confirm-row{display:none;margin-top:10px}.delete-confirm-row.on{display:flex}.delete-confirm-row input{flex:1 1 220px;min-width:0}.delete-zone .btn:disabled{cursor:not-allowed}
`;

const HTML = `
      <div class="delete-zone" id="deleteUserZone">
        <div class="delete-zone-head"><div><strong>حذف کامل حساب</strong><p>اطلاعات شخصی و داده‌های اپ حذف می‌شوند و قابل بازگشت نیستند. سوابق پرداخت مالی حفظ می‌شوند اما از حساب حذف‌شده جدا می‌شوند. برای تأیید باید نام کاربری دقیق وارد شود.</p></div><span class="pill bad">خطرناک</span></div>
        <div class="row"><input id="deleteUserLookup" placeholder="نام کاربری دقیق (یا شماره برای حساب بدون نام کاربری)" aria-label="پیدا کردن حساب برای حذف" dir="auto"><button class="btn secondary" type="button" id="deleteUserLookupGo">بررسی حساب</button></div>
        <div class="delete-preview" id="deleteUserPreview" aria-live="polite"></div>
        <div class="row delete-confirm-row" id="deleteUserConfirmRow"><input id="deleteUserConfirm" placeholder="تأیید حذف" aria-label="تأیید حذف حساب" dir="auto" disabled><button class="btn danger" type="button" id="deleteUserGo" disabled>حذف برای همیشه</button></div>
        <div class="err" id="deleteUserErr" role="alert"></div>
      </div>
`;

const SCRIPT = `
const baseIdentityCell = identityCell;
identityCell = (phone, username) => {
  if (phone) return baseIdentityCell(phone, username);
  return '<div class="identity"><span class="identity-mark">×</span><span class="identity-copy"><b>حساب حذف‌شده</b><small>سابقهٔ مالی حفظ شده</small></span></div>';
};
const baseExpandablePair = expandablePair;
expandablePair = (cells, labels, userId, key, colspan) => {
  if (userId) return baseExpandablePair(cells, labels, userId, key, colspan);
  return '<tr>' + cells.map((cell, index) => '<td data-label="' + esc(labels[index]) + '">' + cell + '</td>').join("") + '</tr>';
};

let adminDeleteCandidate = null;
function resetAdminDeleteCandidate(message) {
  adminDeleteCandidate = null;
  $("#deleteUserPreview").classList.remove("on");
  $("#deleteUserPreview").innerHTML = "";
  $("#deleteUserConfirmRow").classList.remove("on");
  $("#deleteUserConfirm").value = "";
  $("#deleteUserConfirm").disabled = true;
  $("#deleteUserGo").disabled = true;
  $("#deleteUserErr").textContent = message || "";
}

$("#deleteUserLookup").addEventListener("input", () => resetAdminDeleteCandidate());
$("#deleteUserLookupGo").onclick = async () => {
  resetAdminDeleteCandidate();
  const raw = $("#deleteUserLookup").value.trim();
  if (!raw) { $("#deleteUserErr").textContent = "نام کاربری یا شماره را وارد کن."; return; }
  const usernameQuery = raw.startsWith("@") ? raw.slice(1).toLowerCase() : raw.toLowerCase();
  const button = $("#deleteUserLookupGo");
  button.disabled = true;
  try {
    const result = await api("/users?q=" + encodeURIComponent(raw.startsWith("@") ? raw.slice(1) : raw));
    const target = result.users.find((u) =>
      (u.username && u.username === usernameQuery) ||
      (!u.username && (localPhone(u.phone) === raw || u.phone === raw))
    );
    if (!target) { resetAdminDeleteCandidate("حساب دقیقی با این نام کاربری/شماره پیدا نشد."); return; }

    const expected = target.username || localPhone(target.phone);
    adminDeleteCandidate = { id: target.id, username: target.username, phone: target.phone, expected };
    $("#deleteUserPreview").innerHTML =
      "<b dir='ltr'>" + esc(target.username ? "@" + target.username : localPhone(target.phone)) + "</b>" +
      "<span dir='ltr'>" + esc(localPhone(target.phone)) + " · " + esc(target.id) + "</span>" +
      "<span>برای حذف، دقیقاً <b dir='ltr' style='display:inline'>" + esc(expected) + "</b> را در کادر پایین وارد کن.</span>";
    $("#deleteUserPreview").classList.add("on");
    $("#deleteUserConfirmRow").classList.add("on");
    $("#deleteUserConfirm").disabled = false;
    $("#deleteUserConfirm").placeholder = target.username ? "نام کاربری دقیق، بدون @" : "شماره دقیق حساب";
    $("#deleteUserConfirm").focus();
  } catch (error) {
    resetAdminDeleteCandidate(error.message || "بررسی حساب ممکن نشد.");
  } finally { button.disabled = false; }
};

$("#deleteUserConfirm").addEventListener("input", () => {
  const value = $("#deleteUserConfirm").value.trim();
  $("#deleteUserGo").disabled = !adminDeleteCandidate || value !== adminDeleteCandidate.expected;
  $("#deleteUserErr").textContent = "";
});

$("#deleteUserGo").onclick = async () => {
  if (!adminDeleteCandidate) return;
  const confirmation = $("#deleteUserConfirm").value.trim();
  if (confirmation !== adminDeleteCandidate.expected) return;
  const label = adminDeleteCandidate.username ? "@" + adminDeleteCandidate.username : localPhone(adminDeleteCandidate.phone);
  if (!confirm("حساب «" + label + "» و تمام داده‌های شخصی/اپ آن برای همیشه حذف شود؟ سوابق پرداخت مالی باقی می‌مانند.")) return;

  const button = $("#deleteUserGo");
  button.disabled = true;
  try {
    const deletedId = adminDeleteCandidate.id;
    await api("/users/" + encodeURIComponent(deletedId) + "/delete", {
      method: "POST",
      body: { confirmation },
    });
    userDetailCache.delete(deletedId);
    $("#deleteUserLookup").value = "";
    resetAdminDeleteCandidate();
    $("#deleteUserErr").textContent = "حساب و داده‌های اپ حذف شد؛ سوابق پرداخت مالی حفظ شد.";
    await loadUsers();
    void loadOverview();
  } catch (error) {
    $("#deleteUserErr").textContent = error.message || "حذف حساب انجام نشد.";
    button.disabled = false;
  }
};
`;

export function withAdminUserDeleteUi(page: string): string {
  const styleMarker = "</style>";
  const usersMarker = '      <div class="result" id="uResults" aria-live="polite"></div>';
  const bootMarker = "boot();\n</script>";
  if (!page.includes(styleMarker) || !page.includes(usersMarker) || !page.includes(bootMarker)) {
    throw new Error("admin delete UI markers no longer match ADMIN_PAGE");
  }
  return page
    .replace(styleMarker, `${STYLE}\n</style>`)
    .replace(usersMarker, `${HTML}\n${usersMarker}`)
    .replace(bootMarker, `${SCRIPT}\nboot();\n</script>`);
}
