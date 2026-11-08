(function () {
  "use strict";

  var api = window.ATBSiteReview;
  var form = document.getElementById("review-request");
  if (!api || !form) return;

  var errorsEl = document.getElementById("form-errors");
  var statusEl = document.getElementById("form-status");
  var draftEl = document.getElementById("draft");
  var draftText = document.getElementById("draft-text");
  var draftTo = document.getElementById("draft-to");
  var shown = document.getElementById("intake-destination");

  function setStatus(message) {
    statusEl.textContent = message;
  }

  function fieldErrorEl(field) {
    return document.getElementById(field + "-error");
  }

  function clearFieldErrors() {
    var nodes = form.querySelectorAll("[aria-invalid]");
    for (var i = 0; i < nodes.length; i++) nodes[i].removeAttribute("aria-invalid");
    var messages = form.querySelectorAll(".field-error");
    for (var j = 0; j < messages.length; j++) {
      messages[j].hidden = true;
      messages[j].textContent = "";
    }
  }

  function hideDraft() {
    draftEl.hidden = true;
    draftText.value = "";
    draftTo.textContent = "";
  }

  function showErrors(result) {
    hideDraft();
    clearFieldErrors();
    var list = document.createElement("ul");
    result.errors.forEach(function (error) {
      var item = document.createElement("li");
      item.textContent = error.message;
      list.appendChild(item);
      var slot = fieldErrorEl(error.field);
      var control = document.getElementById(error.field);
      if (slot) {
        slot.hidden = false;
        slot.textContent = error.message;
      }
      if (control && control.type !== "radio") control.setAttribute("aria-invalid", "true");
    });
    errorsEl.textContent = "";
    var title = document.createElement("p");
    title.textContent = result.honeypot ? "The draft was not prepared." : "The draft was not prepared. Fix the items below.";
    errorsEl.appendChild(title);
    if (!result.honeypot) errorsEl.appendChild(list);
    errorsEl.hidden = false;
    setStatus("");
    errorsEl.focus();
  }

  function showDraft(result) {
    clearFieldErrors();
    errorsEl.hidden = true;
    errorsEl.textContent = "";
    draftTo.textContent = result.inquiry.to;
    draftText.value = result.inquiry.text;
    draftEl.hidden = false;
  }

  function radioValue(name) {
    var picked = form.querySelector('input[name="' + name + '"]:checked');
    return picked ? picked.value : "";
  }

  function readForm() {
    return {
      siteUrl: document.getElementById("site-url").value,
      otherHosts: document.getElementById("other-hosts").value,
      name: document.getElementById("requester-name").value,
      email: document.getElementById("contact-email").value,
      project: document.getElementById("project-name").value,
      role: document.getElementById("role").value,
      ownerName: document.getElementById("owner-name").value,
      ownerContact: document.getElementById("owner-contact").value,
      builder: radioValue("digibyte-builder"),
      projectLink: document.getElementById("project-link").value,
      scope: radioValue("requested-scope"),
      exclusions: document.getElementById("exclusions").value,
      confirm: document.getElementById("confirm-authority").checked,
      leaveBlank: document.getElementById("atb-leave-blank").value
    };
  }

  function syncConditional() {
    var role = document.getElementById("role").value;
    var owner = document.getElementById("owner-fields");
    var showOwner = role === "authorized";
    owner.hidden = !showOwner;
    var ownerInputs = owner.querySelectorAll("input");
    for (var i = 0; i < ownerInputs.length; i++) {
      ownerInputs[i].disabled = !showOwner;
      ownerInputs[i].required = showOwner;
      ownerInputs[i].setAttribute("aria-required", showOwner ? "true" : "false");
      if (!showOwner) ownerInputs[i].value = "";
    }

    var showLink = radioValue("digibyte-builder") === "yes";
    var linkWrap = document.getElementById("builder-link");
    var link = document.getElementById("project-link");
    linkWrap.hidden = !showLink;
    link.disabled = !showLink;
    link.required = showLink;
    link.setAttribute("aria-required", showLink ? "true" : "false");
    if (!showLink) link.value = "";
  }

  function configured() {
    return shown && api.sameDestination(shown.textContent);
  }

  function current() {
    if (!configured()) {
      return {
        ok: false,
        honeypot: false,
        errors: [{ field: "form", message: "This page cannot prepare an email because the address shown does not match the published contact." }]
      };
    }
    return api.prepare(readForm());
  }

  function notSent(message) {
    setStatus(message + " It has not been sent.");
  }

  function onOpen() {
    var result = current();
    if (!result.ok) {
      showErrors(result);
      return;
    }
    showDraft(result);
    if (result.mailto.tooLong) {
      notSent("This draft is too long for an email link. Copy the message or download it, then send it from your email app.");
      return;
    }
    notSent("Your email app should open with this draft to " + result.inquiry.to + ". Send it from that app if you want it delivered. If no app opens, copy the message or download it.");
    if (typeof window.ATB_ON_MAILTO === "function") {
      window.ATB_ON_MAILTO(result.mailto.href);
      return;
    }
    window.location.href = result.mailto.href;
  }

  function onCopy() {
    var result = current();
    if (!result.ok) {
      showErrors(result);
      return;
    }
    showDraft(result);
    var done = function () {
      notSent("The message was copied to the clipboard on this device.");
    };
    var failed = function () {
      draftText.focus();
      draftText.select();
      notSent("The clipboard could not be used. Select the prepared message and copy it yourself.");
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(result.inquiry.text).then(done, function () {
        try {
          if (document.execCommand("copy")) done();
          else failed();
        } catch (e) {
          failed();
        }
      });
      return;
    }
    try {
      draftText.focus();
      draftText.select();
      if (document.execCommand("copy")) done();
      else failed();
    } catch (e) {
      failed();
    }
  }

  function onDownload() {
    var result = current();
    if (!result.ok) {
      showErrors(result);
      return;
    }
    showDraft(result);
    var blob = new Blob([result.inquiry.text], { type: "text/plain;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "website-review-request.txt";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    notSent("The message file was downloaded to your device.");
  }

  document.getElementById("role").addEventListener("change", syncConditional);
  var builderRadios = form.querySelectorAll('input[name="digibyte-builder"]');
  for (var i = 0; i < builderRadios.length; i++) builderRadios[i].addEventListener("change", syncConditional);
  document.getElementById("open-mail").addEventListener("click", onOpen);
  document.getElementById("copy-draft").addEventListener("click", onCopy);
  document.getElementById("download-draft").addEventListener("click", onDownload);
  syncConditional();
})();
