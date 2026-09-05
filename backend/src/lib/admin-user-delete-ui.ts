/**
 * Adds the destructive account-deletion control to the self-contained admin page.
 *
 * This file is UI-only. The server remains authoritative for the destructive
 * operation; the panel merely requires the visible account phone before calling
 * the existing protected delete endpoint.
 */
const STYLE = `
  .detail-delete-open{margin-inline-start:auto!important;border-color:#efb5ae!important;background:#fff!important;color:var(--bad)!important;box-shadow:none!important}
  .detail-delete-open:hover{background:var(--bad-soft)!important}
  .detail-delete-panel{margin-top:10px;padding:13px;border:1px solid #efb5ae;border-radius:14px;background:var(--bad-soft)}
  .detail-delete-panel[hidden]{display:none!important}.detail-delete-panel strong{color:var(--bad);font-size:12px}.detail-delete-panel p{margin:3px 0 10px;color:#875552;font-size:11px}
  .detail-delete-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.detail-delete-row input{min-width:0;flex:1 1 220px;background:#fff}.detail-delete-row .btn{flex:0 0 auto}
  .detail-delete-error{min-height:20px;margin-top:7px;color:var(--bad);font-size:11px}.detail-delete-panel .btn:disabled{cursor:not-allowed}
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

const normalizeDeletePhone = (value) => String(value ?? "")
  .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
  .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
  .trim();

function attachAdminDeleteControls(host, user, userId) {
  const actions = host.querySelector(".detail-actions");
  if (!actions || actions.querySelector(".detail-delete-open")) return;

  const phone = localPhone(user.phone);
  // The existing backend may internally use username as its confirmation key.
  // The admin UI intentionally confirms only the visible phone and supplies the
  // backend value itself after that phone has matched exactly.
  const backendConfirmation = user.username || phone;

  const openButton = document.createElement("button");
  openButton.type = "button";
  openButton.className = "btn secondary mini detail-delete-open";
  openButton.textContent = "حذف حساب";
  actions.appendChild(openButton);

  const panel = document.createElement("div");
  panel.className = "detail-delete-panel";
  panel.hidden = true;
  panel.innerHTML =
    '<strong>حذف کامل حساب</strong>' +
    '<p>برای جلوگیری از حذف اشتباهی، شمارهٔ <b dir="ltr">' + esc(phone) + '</b> را دقیق وارد کن. داده‌های اپ حذف می‌شوند؛ سوابق پرداخت مالی باقی می‌مانند.</p>' +
    '<div class="detail-delete-row"><input class="detail-delete-phone" inputmode="numeric" autocomplete="off" dir="ltr" placeholder="' + esc(phone) + '" aria-label="شماره برای تأیید حذف"><button class="btn secondary mini detail-delete-cancel" type="button">انصراف</button><button class="btn danger mini detail-delete-go" type="button" disabled>حذف برای همیشه</button></div>' +
    '<div class="detail-delete-error" role="alert"></div>';
  actions.insertAdjacentElement("afterend", panel);

  const input = panel.querySelector(".detail-delete-phone");
  const cancelButton = panel.querySelector(".detail-delete-cancel");
  const deleteButton = panel.querySelector(".detail-delete-go");
  const error = panel.querySelector(".detail-delete-error");

  const closePanel = () => {
    panel.hidden = true;
    openButton.hidden = false;
    input.value = "";
    deleteButton.disabled = true;
    error.textContent = "";
  };

  openButton.onclick = (event) => {
    event.stopPropagation();
    openButton.hidden = true;
    panel.hidden = false;
    input.focus();
  };
  cancelButton.onclick = (event) => { event.stopPropagation(); closePanel(); };
  input.onclick = (event) => event.stopPropagation();
  input.oninput = () => {
    deleteButton.disabled = normalizeDeletePhone(input.value) !== phone;
    error.textContent = "";
  };

  deleteButton.onclick = async (event) => {
    event.stopPropagation();
    if (normalizeDeletePhone(input.value) !== phone) return;
    if (!confirm("حساب «" + phone + "» و تمام داده‌های شخصی/اپ آن برای همیشه حذف شود؟ سوابق پرداخت مالی باقی می‌مانند.")) return;

    deleteButton.disabled = true;
    cancelButton.disabled = true;
    error.textContent = "";
    try {
      await api("/users/" + encodeURIComponent(userId) + "/delete", {
        method: "POST",
        body: { confirmation: backendConfirmation },
      });
      userDetailCache.delete(userId);
      alert("حساب و داده‌های اپ حذف شد. سوابق پرداخت مالی حفظ شدند.");
      await loadUsers();
      void loadOverview();
    } catch (cause) {
      error.textContent = cause.message || "حذف حساب انجام نشد.";
      deleteButton.disabled = normalizeDeletePhone(input.value) !== phone;
      cancelButton.disabled = false;
    }
  };
}

const baseRenderUserDetail = renderUserDetail;
renderUserDetail = (host, detail, userId) => {
  baseRenderUserDetail(host, detail, userId);
  attachAdminDeleteControls(host, detail.user, userId);
};
`;

export function withAdminUserDeleteUi(page: string): string {
  const styleMarker = "</style>";
  const bootMarker = "boot();\n</script>";
  if (!page.includes(styleMarker) || !page.includes(bootMarker)) {
    throw new Error("admin delete UI markers no longer match ADMIN_PAGE");
  }
  return page
    .replace(styleMarker, `${STYLE}\n</style>`)
    .replace(bootMarker, `${SCRIPT}\nboot();\n</script>`);
}
