// SPDX-License-Identifier: AGPL-3.0-or-later
const assert = require("node:assert/strict");
const parser = require("../src/subtitle-parser.js");

const vtt = `WEBVTT

00:00:01.000 --> 00:00:02.500
Hello <i>world</i>

00:00:03.000 --> 00:00:04.000
Second line
`;

const ttml = `<?xml version="1.0" encoding="UTF-8"?>
<tt>
  <body>
    <div>
      <p begin="00:00:05.000" end="00:00:06.250">こんにちは<br/>世界</p>
      <p begin="7.5s" dur="1.5s">次の字幕</p>
    </div>
  </body>
</tt>`;

const netflixTtml = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<tt xmlns:tt="http://www.w3.org/2006/10/ttaf1" xmlns:ttp="http://www.w3.org/2006/10/ttaf1#parameter" ttp:tickRate="10000000" ttp:timeBase="media">
  <tt:body>
    <tt:div>
      <tt:p begin="10000000t" end="25000000t">先生、<tt:span>怒我直言</tt:span><tt:br/>你比我大</tt:p>
    </tt:div>
  </tt:body>
</tt>`;

const langTaggedTtml = `<?xml version="1.0" encoding="utf-8"?>
<tt xml:lang="zh-Hans">
  <body>
    <div>
      <p begin="1s" end="2s">中文</p>
    </div>
  </body>
</tt>`;

const vttSegments = parser.parseSubtitle(vtt, { url: "https://example.com/subtitle?vtt&lang=en" });
assert.equal(vttSegments.length, 2);
assert.deepEqual(vttSegments[0], {
  start: 1,
  end: 2.5,
  text: "Hello world",
  lang: "en",
  source: "captured"
});

const ttmlSegments = parser.parseSubtitle(ttml, { url: "https://example.com/timedtext?lang=ja" });
assert.equal(ttmlSegments.length, 2);
assert.equal(ttmlSegments[0].text, "こんにちは\n世界");
assert.equal(ttmlSegments[1].start, 7.5);
assert.equal(ttmlSegments[1].end, 9);

const netflixSegments = parser.parseSubtitle(netflixTtml, { lang: "zh-Hans" });
assert.equal(netflixSegments.length, 1);
assert.equal(netflixSegments[0].start, 1);
assert.equal(netflixSegments[0].end, 2.5);
assert.equal(netflixSegments[0].text, "先生、怒我直言\n你比我大");

const langTaggedSegments = parser.parseSubtitle(langTaggedTtml, { lang: "en" });
assert.equal(langTaggedSegments.length, 1);
assert.equal(langTaggedSegments[0].lang, "zh-Hans");

console.log("parser tests passed");
