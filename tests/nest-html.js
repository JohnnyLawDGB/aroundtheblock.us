"use strict";

function toNested(html) {
  var pairs = [
    ['href="./#products"', 'href="../#products"'],
    ['href="./"', 'href="../"'],
    ['href="site-review"', 'href="../site-review"'],
    ['href="capabilities"', 'href="../capabilities"'],
    ['href="methodology"', 'href="../methodology"'],
    ['href="cases/', 'href="../cases/'],
    ['href="privacy-policy"', 'href="../privacy-policy"'],
    ['href="bot-terms"', 'href="../bot-terms"'],
    ['href="bot-privacy"', 'href="../bot-privacy"'],
    ['href="contact"', 'href="../contact"'],
    ['href="favicon.ico"', 'href="../favicon.ico"'],
    ['href="favicon-32.png"', 'href="../favicon-32.png"'],
    ['href="apple-touch-icon.png"', 'href="../apple-touch-icon.png"'],
    ['href="site.webmanifest"', 'href="../site.webmanifest"'],
    ['src="assets/', 'src="../assets/'],
    ['srcset="assets/', 'srcset="../assets/'],
    ['1x, assets/', '1x, ../assets/']
  ];
  var out = html;
  for (var i = 0; i < pairs.length; i++) out = out.split(pairs[i][0]).join(pairs[i][1]);
  return out;
}

module.exports = { toNested: toNested };
