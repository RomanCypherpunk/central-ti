import assert from "node:assert/strict";
import { normalizarVideoUrl } from "../../public/js/componentes/video-embed.js";

const casos = [
  ["https://vimeo.com/123456789/abcdef1234", "https://player.vimeo.com/video/123456789?h=abcdef1234"],
  ["https://vimeo.com/123456789", "https://player.vimeo.com/video/123456789"],
  ["https://player.vimeo.com/video/123456789?h=abcdef1234", "https://player.vimeo.com/video/123456789?h=abcdef1234"],
  ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"],
  ["youtu.be/dQw4w9WgXcQ", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"],
  ["https://youtube.com/shorts/dQw4w9WgXcQ", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"],
];

for (const [entrada, esperado] of casos) {
  assert.equal(normalizarVideoUrl(entrada)?.embed, esperado, entrada);
}

for (const ruim of [
  "", "   ", "javascript:alert(1)", "https://evil.com/vimeo.com/123456789",
  "https://vimeo.com.evil.com/123456789", "https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ",
  "https://vimeo.com/abc", "https://youtube.com/watch?v=curto", "https://example.com",
]) {
  assert.equal(normalizarVideoUrl(ruim), null, ruim);
}

console.log("video-embed: ok");
