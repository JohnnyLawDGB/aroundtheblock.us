"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const api = require("../assets/site-review-intake.js");
const { toNested } = require("./nest-html.js");

const root = path.resolve(__dirname, "..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function generalContact(html, file) {
  const matches = html.match(/General:\s*<a href="mailto:([^"]+)">([^<]+)<\/a>/g);
  assert.ok(matches && matches.length, file + " is missing the General contact line");
  const one = /General:\s*<a href="mailto:([^"]+)">([^<]+)<\/a>/;
  matches.forEach(function (line) {
    const found = line.match(one);
    assert.equal(found[1], found[2], file + " mailto text differs from the address");
    assert.equal(found[1], api.DESTINATION, file + " General contact is not the intake destination");
  });
}

function validBase(overrides) {
  return Object.assign({
    siteUrl: "https://example.com",
    otherHosts: "",
    name: "Ada Lovelace",
    email: "ada@example.com",
    project: "North Bridge",
    role: "owner",
    ownerName: "",
    ownerContact: "",
    builder: "no",
    projectLink: "",
    scope: "public",
    exclusions: "",
    confirm: true,
    leaveBlank: ""
  }, overrides || {});
}

test("intake destination is the published general business contact", function () {
  const files = [
    "contact.html",
    "contact/index.html",
    "index.html",
    "home.html",
    "404.html",
    "privacy-policy.html",
    "privacy-policy/index.html",
    "bot-terms.html",
    "bot-terms/index.html",
    "bot-privacy.html",
    "bot-privacy/index.html"
  ];
  files.forEach(function (file) { generalContact(read(file), file); });
  const contact = read("contact.html");
  assert.match(contact, /mailto:security@aroundtheblock.us/);
  assert.match(contact, /SECURITY\.md/);
  assert.notEqual(api.DESTINATION, "security@aroundtheblock.us");
  assert.notEqual(api.DESTINATION, "mark@aroundtheblock.us");
  assert.equal(api.DESTINATION, "contact@aroundtheblock.us");
});

test("directory page is the root page with nested relative links", function () {
  const rootHtml = read("site-review.html");
  const nested = read("site-review/index.html");
  assert.equal(nested, toNested(rootHtml));
  assert.match(nested, /src="\.\.\/assets\/site-review-intake\.js"/);
  assert.match(rootHtml, /src="assets\/site-review-intake\.js"/);
});

test("review pages state the offer without prices or a DigiScope portal", function () {
  ["site-review.html", "site-review/index.html"].forEach(function (file) {
    const html = read(file);
    assert.match(html, /Free for DigiByte builders\./);
    assert.match(html, /within the scope we agree on together/);
    assert.match(html, /No public pricing yet\./);
    assert.match(html, /by a channel agreed for that project/);
    assert.match(html, /not a certification/);
    assert.match(html, /not a guarantee that the site is secure/);
    assert.match(html, /not permission to test/);
    assert.match(html, /does not start a review/);
    assert.match(html, /signed authorization/);
    assert.match(html, /id="intake-destination">contact@aroundtheblock\.us</);
    assert.match(html, /Open in my email app/);
    assert.match(html, /Copy message/);
    assert.match(html, /Download message/);
    assert.match(html, /does not send the email/);
    assert.match(html, /We do not state a retention period/);
    const visible = html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<script[\s\S]*?<\/script>/gi, "");
    assert.doesNotMatch(visible, /DigiScope|DUSD|DigiDollar|account portal|What it costs|\$\d|\$0|\b175\b|\b350\b|\b600\b|\b125\b/i);
    const withoutPricingSentence = visible.replace(/No public pricing yet\./g, "");
    assert.doesNotMatch(withoutPricingSentence, /pric/i);
    assert.doesNotMatch(html, /type="password"|type="file"|<input[^>]+hidden/i);
    assert.equal((html.match(/[^\x00-\x7F]/g) || []).length, 0, file + " has a non-ASCII character");
  });
});

test("inquiry copy does not invent a retention period", function () {
  const html = read("site-review.html");
  const chunk = html.slice(html.indexOf(">Inquiry privacy<"), html.indexOf('<form id="review-request"'));
  assert.ok(chunk.length > 40);
  assert.match(chunk, /does not ask for passwords, seed phrases, private keys, card numbers/);
  assert.doesNotMatch(chunk, /90 days|24 months|we keep|we store|retention period of/i);
});

test("form controls are labeled and the page does not claim the email was sent", function () {
  const html = read("site-review.html");
  const formJs = read("assets/site-review-form.js");
  const ids = ["site-url", "other-hosts", "requester-name", "contact-email", "project-name", "role", "owner-name", "owner-contact", "project-link", "exclusions", "confirm-authority", "atb-leave-blank", "draft-text"];
  ids.forEach(function (id) {
    assert.match(html, new RegExp('id="' + id + '"'), id);
    assert.match(html, new RegExp('for="' + id + '"'), "label for " + id);
  });
  assert.match(html, /id="digibyte-builder"/);
  assert.match(html, /id="requested-scope"/);
  assert.match(html, /<legend>DigiByte builder \(required\)<\/legend>/);
  assert.match(html, /<legend>What you want reviewed \(required\)<\/legend>/);
  assert.match(html, new RegExp(api.CONFIRM_TEXT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(html, /onsubmit="return false"/);
  assert.doesNotMatch(html, /action="https?:/i);
  assert.match(html, /<html lang="en">/);
  assert.match(html, /name="viewport"/);
  assert.match(html, /class="skip" href="#request"/);
  assert.match(html, /aria-hidden="true"/);
  const deliveryText = html + "\n" + formJs;
  [/thank you/i, /we received/i, /request received/i, /has been sent/i, /message sent/i, /successfully sent/i].forEach(function (pattern) {
    assert.doesNotMatch(deliveryText, pattern);
  });
});

test("a complete public-surface request builds a locked mailto", function () {
  const result = api.prepare(validBase({
    otherHosts: "www.example.com\nhttps://example.com/docs?x=1&y=2",
    exclusions: "Do not test the admin area, third-party checkout, or the host after 18:00 UTC."
  }));
  assert.equal(result.ok, true);
  assert.equal(result.inquiry.to, api.DESTINATION);
  assert.equal(result.inquiry.subject, "Website review request: North Bridge");
  assert.match(result.inquiry.body, /Site URL: https:\/\/example\.com/);
  assert.match(result.inquiry.body, /Role: Owner/);
  assert.doesNotMatch(result.inquiry.body, /Owner name:/);
  assert.match(result.inquiry.body, /DigiByte builder: no/);
  assert.match(result.inquiry.body, /Public project link: none/);
  assert.match(result.inquiry.body, /Requested scope: Public-surface review/);
  assert.match(result.inquiry.body, /Confirmation: /);
  assert.match(result.inquiry.text, /^To: contact@aroundtheblock\.us\nSubject: /);
  const parsed = api.parseMailto(result.mailto.href);
  assert.equal(parsed.address, api.DESTINATION);
  assert.deepEqual(parsed.keys, ["subject", "body"]);
  assert.equal(parsed.subject, result.inquiry.subject);
  assert.match(parsed.body, /www\.example\.com/);
  assert.doesNotMatch(result.mailto.href, /[?&](?:bcc|cc|to)=/i);
  assert.equal(result.mailto.href.indexOf("\n"), -1);
  assert.equal(result.mailto.href.indexOf("\r"), -1);
});

test("header and query injection stay inside the encoded body", function () {
  const result = api.prepare(validBase({
    name: "Ann\r\nBcc: evil@example.com",
    project: "North&bcc=evil@example.com\nCc: evil@example.com",
    email: "ada@example.com",
    otherHosts: "qa.example.com?bcc=evil@example.com",
    exclusions: "none\r\nContent-Type: text/html"
  }));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const parsed = api.parseMailto(result.mailto.href);
  assert.equal(parsed.address, "contact@aroundtheblock.us");
  assert.deepEqual(parsed.keys, ["subject", "body"]);
  assert.equal(parsed.subject.indexOf("\n"), -1);
  assert.equal(parsed.subject.indexOf("\r"), -1);
  assert.match(parsed.subject, /North&bcc=evil@example.com Cc: evil@example.com/);
  const body = parsed.body.replace(/\r\n/g, "\n");
  assert.match(body, /Ann\nBcc: evil@example.com/);
  assert.match(body, /Content-Type: text\/html/);
  assert.equal(body.indexOf("Bcc: evil@example.com"), body.indexOf("Name: Ann\nBcc: evil@example.com") + "Name: Ann\n".length);
  assert.doesNotMatch(result.mailto.href, /[?&]bcc=/i);
  assert.doesNotMatch(result.mailto.href, /[?&]cc=/i);
  assert.equal(result.inquiry.to, api.DESTINATION);
});

test("conditional owner and builder fields are required only when selected", function () {
  const missingOwner = api.prepare(validBase({ role: "authorized", builder: "yes" }));
  assert.equal(missingOwner.ok, false);
  const fields = missingOwner.errors.map(function (error) { return error.field; });
  assert.ok(fields.indexOf("owner-name") !== -1);
  assert.ok(fields.indexOf("owner-contact") !== -1);
  assert.ok(fields.indexOf("project-link") !== -1);

  const ready = api.prepare(validBase({
    role: "authorized",
    ownerName: "Grace Hopper",
    ownerContact: "grace@example.com",
    builder: "yes",
    projectLink: "https://github.com/example/digibyte-project",
    scope: "deeper"
  }));
  assert.equal(ready.ok, true, JSON.stringify(ready.errors));
  assert.match(ready.inquiry.body, /Role: Authorized on the owner's behalf/);
  assert.match(ready.inquiry.body, /Owner name: Grace Hopper/);
  assert.match(ready.inquiry.body, /Owner contact: grace@example.com/);
  assert.match(ready.inquiry.body, /DigiByte builder: yes/);
  assert.match(ready.inquiry.body, /https:\/\/github\.com\/example\/digibyte-project/);
  assert.match(ready.inquiry.body, /signed separately/);
});

test("unsafe values and an empty form are rejected", function () {
  const empty = api.prepare({});
  assert.equal(empty.ok, false);
  assert.ok(empty.errors.length >= 6);

  assert.equal(api.prepare(validBase({ siteUrl: "javascript:alert(1)" })).ok, false);
  assert.equal(api.prepare(validBase({ siteUrl: "https://user:secret@example.com" })).ok, false);
  assert.equal(api.prepare(validBase({ email: "ada@example.com\nBcc:evil@example.com" })).ok, false);
  assert.equal(api.prepare(validBase({ email: "ada@example.com,ada2@example.com" })).ok, false);
  assert.equal(api.prepare(validBase({ role: "owner\r\nBcc: evil@example.com" })).ok, false);
  assert.equal(api.prepare(validBase({ confirm: false })).ok, false);

  const card = api.prepare(validBase({ exclusions: "card 4111 1111 1111 1111" }));
  assert.equal(card.ok, false);
  assert.match(card.errors.map(function (error) { return error.message; }).join(" "), /card numbers/i);

  const key = api.prepare(validBase({ exclusions: "xprv9s21ZrQH143K3examplekeymaterial" }));
  assert.equal(key.ok, false);

  const wif = api.prepare(validBase({ otherHosts: "5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJ" }));
  assert.equal(wif.ok, false);

  const hex = api.prepare(validBase({ name: "a".repeat(64) }));
  assert.equal(hex.ok, false);

  const seed = api.prepare(validBase({
    exclusions: "abandon ability able about above absent absorb abstract absurd abuse access accident"
  }));
  assert.equal(seed.ok, false);

  const prose = api.prepare(validBase({
    exclusions: "Do not test the admin area, third-party checkout, or the host after 18:00 UTC."
  }));
  assert.equal(prose.ok, true, JSON.stringify(prose.errors));
});

test("honeypot and overlong drafts do not create a sendable claim", function () {
  const spam = api.prepare(validBase({ leaveBlank: "https://spam.example" }));
  assert.equal(spam.ok, false);
  assert.equal(spam.honeypot, true);
  assert.equal(spam.inquiry, undefined);

  const long = api.prepare(validBase({ exclusions: "?".repeat(1500) }));
  assert.equal(long.ok, true, JSON.stringify(long.errors));
  assert.equal(long.mailto.tooLong, true);
  assert.ok(long.mailto.href.length > api.MAILTO_LIMIT);
  assert.equal(long.inquiry.to, api.DESTINATION);
  const parsed = api.parseMailto(long.mailto.href);
  assert.deepEqual(parsed.keys, ["subject", "body"]);
});

test("visible destination guard fails closed on a mismatch", function () {
  assert.equal(api.sameDestination(" contact@aroundtheblock.us "), true);
  assert.equal(api.sameDestination("security@aroundtheblock.us"), false);
  assert.equal(api.sameDestination("contact@aroundtheblock.us.evil.example"), false);
  assert.equal(api.sameDestination(""), false);
});
