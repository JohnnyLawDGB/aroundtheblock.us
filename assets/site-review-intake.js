/* Website review intake.
   The mailbox is the published general business contact:
   contact.html and contact/index.html, "General: contact@aroundtheblock.us".
   The same General line is in the footer of index.html, home.html, 404.html,
   privacy-policy.html, bot-terms.html, and bot-privacy.html.
   security@aroundtheblock.us is the product-disclosure address on those pages.
   mark@aroundtheblock.us is only the methodology-page contact.
   Neither of those is the general business contact, so neither is used here.
*/
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ATBSiteReview = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var DESTINATION = "contact@aroundtheblock.us";
  var SUBJECT_PREFIX = "Website review request: ";
  var MAILTO_LIMIT = 1800;
  var CONFIRM_TEXT = "I control this site or have the owner's permission, and I understand this is a request, not authorization to test.";

  var ROLE_LABELS = {
    owner: "Owner",
    maintainer: "Maintainer",
    authorized: "Authorized on the owner's behalf"
  };

  var SCOPE_LABELS = {
    public: "Public-surface review",
    deeper: "Interested in deeper testing (discussed and signed separately)"
  };

  var PROSE_WORDS = {
    the: 1, and: 1, please: 1, not: 1, do: 1, test: 1, your: 1, site: 1,
    sites: 1, this: 1, that: 1, with: 1, from: 1, have: 1, admin: 1,
    checkout: 1, area: 1, page: 1, pages: 1, http: 1, www: 1, off: 1, limits: 1
  };

  function text(value) {
    return String(value == null ? "" : value).replace(/\u0000/g, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  }

  function clean(value) {
    return text(value).trim();
  }

  function oneLine(value) {
    return clean(value).replace(/[\n\t]+/g, " ").replace(/ +/g, " ").trim();
  }

  function isHttpUrl(value) {
    var v = clean(value);
    if (!v || v.length > 300 || /\s/.test(v)) return false;
    var url;
    try { url = new URL(v); } catch (e) { return false; }
    if (url.username || url.password) return false;
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (!url.hostname) return false;
    return true;
  }

  function luhn(digits) {
    var sum = 0;
    var alt = false;
    for (var i = digits.length - 1; i >= 0; i--) {
      var n = digits.charCodeAt(i) - 48;
      if (n < 0 || n > 9) return false;
      if (alt) {
        n *= 2;
        if (n > 9) n -= 9;
      }
      sum += n;
      alt = !alt;
    }
    return digits.length > 0 && sum % 10 === 0;
  }

  function hasCardNumber(value) {
    var match = value.match(/(?:\d[ -]?){13,19}/g) || [];
    for (var i = 0; i < match.length; i++) {
      var digits = match[i].replace(/\D/g, "");
      if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) return true;
    }
    return false;
  }

  function hasUrlCredentials(value) {
    var urls = value.match(/[a-z][a-z0-9+.-]*:\/\/\S+/gi) || [];
    for (var i = 0; i < urls.length; i++) {
      try {
        var url = new URL(urls[i]);
        if (url.username || url.password) return true;
      } catch (e) { /* ignore malformed tokens */ }
    }
    return false;
  }

  function looksLikeSeedPhrase(value) {
    var trimmed = clean(value).toLowerCase();
    if (!/^([a-z]{3,8}[ \n]+){11}[a-z]{3,8}$/.test(trimmed) &&
        !/^([a-z]{3,8}[ \n]+){23}[a-z]{3,8}$/.test(trimmed)) return false;
    var words = trimmed.split(/\s+/);
    for (var i = 0; i < words.length; i++) {
      if (PROSE_WORDS[words[i]]) return false;
    }
    return true;
  }

  function sensitiveKind(value) {
    var raw = text(value);
    if (!clean(raw)) return "";
    if (hasUrlCredentials(raw)) return "credentials";
    if (/(?:seed phrase|mnemonic|private key|secret key|api[_ ]?key|password|passwd)\s*[:=]\s*\S{6,}/i.test(raw)) return "credentials";
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(raw)) return "credentials";
    if (hasCardNumber(raw)) return "card";
    if (/xprv[1-9A-HJ-NP-Za-km-z]{10,}/.test(raw)) return "key";
    var withoutUrls = raw.replace(/https?:\/\/\S+/gi, " ");
    if (/\b[5KL][1-9A-HJ-NP-Za-km-z]{50,51}\b/.test(withoutUrls)) return "key";
    if (/\b[0-9a-fA-F]{64}\b/.test(withoutUrls)) return "key";
    if (looksLikeSeedPhrase(withoutUrls)) return "seed";
    return "";
  }

  function sensitiveMessage(kind) {
    if (kind === "card") return "Remove card numbers. Do not send payment details.";
    if (kind === "seed") return "Remove seed phrases. Do not send them.";
    if (kind === "key" || kind === "credentials") return "Remove passwords, private keys, and other credentials. Do not send them.";
    return "";
  }

  function pushSensitive(errors, field, value) {
    var kind = sensitiveKind(value);
    if (!kind) return;
    errors.push({ field: field, message: sensitiveMessage(kind) });
  }

  function validEmail(value) {
    if (!value || value.length > 200) return false;
    if (/[\s,;<>]/.test(value)) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  function addLength(errors, field, value, max, label) {
    if (value.length > max) {
      errors.push({ field: field, message: "Shorten " + label + " to " + max + " characters or fewer." });
    }
  }

  function prepare(input) {
    input = input || {};
    var errors = [];
    if (clean(input.leaveBlank)) {
      return { ok: false, honeypot: true, errors: [{ field: "form", message: "The draft was not prepared." }] };
    }

    var siteUrl = clean(input.siteUrl);
    var otherHosts = clean(input.otherHosts);
    var name = clean(input.name);
    var email = clean(input.email);
    var project = clean(input.project);
    var role = clean(input.role);
    var ownerName = clean(input.ownerName);
    var ownerContact = clean(input.ownerContact);
    var builder = clean(input.builder);
    var projectLink = clean(input.projectLink);
    var scope = clean(input.scope);
    var exclusions = clean(input.exclusions);
    var confirm = input.confirm === true;

    if (!siteUrl) errors.push({ field: "site-url", message: "Enter the site URL, including https://." });
    else if (!isHttpUrl(siteUrl)) errors.push({ field: "site-url", message: "Enter a public http or https URL with no username or password." });
    else pushSensitive(errors, "site-url", siteUrl);

    if (otherHosts) {
      addLength(errors, "other-hosts", otherHosts, 1000, "the other hostnames");
      pushSensitive(errors, "other-hosts", otherHosts);
    }

    if (!name) errors.push({ field: "requester-name", message: "Enter your name." });
    else addLength(errors, "requester-name", name, 120, "your name");
    pushSensitive(errors, "requester-name", name);

    if (!email) errors.push({ field: "contact-email", message: "Enter a contact email." });
    else if (!validEmail(email)) errors.push({ field: "contact-email", message: "Enter a single contact email address." });

    if (!project) errors.push({ field: "project-name", message: "Enter the project name." });
    else addLength(errors, "project-name", project, 160, "the project name");
    pushSensitive(errors, "project-name", project);

    if (!ROLE_LABELS[role]) errors.push({ field: "role", message: "Select your role." });

    if (role === "authorized") {
      if (!ownerName) errors.push({ field: "owner-name", message: "Enter the owner's name." });
      else addLength(errors, "owner-name", ownerName, 120, "the owner's name");
      pushSensitive(errors, "owner-name", ownerName);
      if (!ownerContact) errors.push({ field: "owner-contact", message: "Enter a way to contact the owner." });
      else addLength(errors, "owner-contact", ownerContact, 200, "the owner contact");
      pushSensitive(errors, "owner-contact", ownerContact);
    }

    if (builder !== "yes" && builder !== "no") {
      errors.push({ field: "digibyte-builder", message: "Say whether you are a DigiByte builder." });
    }
    if (builder === "yes") {
      if (!projectLink) errors.push({ field: "project-link", message: "Enter a public link that shows the DigiByte project." });
      else if (!isHttpUrl(projectLink)) errors.push({ field: "project-link", message: "Enter a public http or https link with no username or password." });
      else pushSensitive(errors, "project-link", projectLink);
    }

    if (!SCOPE_LABELS[scope]) errors.push({ field: "requested-scope", message: "Choose the review you are requesting." });

    if (exclusions) {
      addLength(errors, "exclusions", exclusions, 1500, "the exclusions");
      pushSensitive(errors, "exclusions", exclusions);
    }

    if (!confirm) {
      errors.push({ field: "confirm-authority", message: "Confirm that you control the site or have the owner's permission, and that this is a request, not authorization to test." });
    }

    if (errors.length) return { ok: false, honeypot: false, errors: errors };

    var subject = SUBJECT_PREFIX + oneLine(project).slice(0, 90);
    var lines = [
      "Website security review request",
      "This message is a request only. It is not permission to test, and it does not start a review.",
      "",
      "Site URL: " + siteUrl,
      "Other hostnames or URLs in scope: " + (otherHosts || "none"),
      "Name: " + name,
      "Contact email: " + email,
      "Project name: " + project,
      "Role: " + ROLE_LABELS[role]
    ];
    if (role === "authorized") {
      lines.push("Owner name: " + ownerName);
      lines.push("Owner contact: " + ownerContact);
    }
    lines.push("DigiByte builder: " + (builder === "yes" ? "yes" : "no"));
    lines.push("Public project link: " + (builder === "yes" ? projectLink : "none"));
    lines.push("Requested scope: " + SCOPE_LABELS[scope]);
    lines.push("Exclusions: " + (exclusions || "none"));
    lines.push("Confirmation: " + CONFIRM_TEXT);
    lines.push("");
    lines.push("Prepared on the aroundtheblock.us website review page. This page does not send or store this message.");
    var body = lines.join("\n");
    var inquiryText = "To: " + DESTINATION + "\nSubject: " + subject + "\n\n" + body;
    var mailtoBody = body.replace(/\n/g, "\r\n");
    var href = "mailto:" + DESTINATION + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(mailtoBody);

    return {
      ok: true,
      honeypot: false,
      errors: [],
      inquiry: {
        to: DESTINATION,
        subject: subject,
        body: body,
        text: inquiryText
      },
      mailto: {
        href: href,
        tooLong: href.length > MAILTO_LIMIT
      }
    };
  }

  function parseMailto(href) {
    var match = /^mailto:([^?]*)\?(.*)$/.exec(href || "");
    if (!match) return null;
    var params = new URLSearchParams(match[2]);
    return {
      address: decodeURIComponent(match[1]),
      keys: Array.from(params.keys()),
      subject: params.get("subject"),
      body: params.get("body")
    };
  }

  function sameDestination(visibleText) {
    return String(visibleText == null ? "" : visibleText).trim() === DESTINATION;
  }

  return {
    DESTINATION: DESTINATION,
    SUBJECT_PREFIX: SUBJECT_PREFIX,
    MAILTO_LIMIT: MAILTO_LIMIT,
    CONFIRM_TEXT: CONFIRM_TEXT,
    ROLE_LABELS: ROLE_LABELS,
    SCOPE_LABELS: SCOPE_LABELS,
    prepare: prepare,
    parseMailto: parseMailto,
    sameDestination: sameDestination,
    isHttpUrl: isHttpUrl,
    sensitiveKind: sensitiveKind
  };
});
