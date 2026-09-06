/**
 * Drop the wasm-bindgen fallback copy of the VM from the polyfill bundle.
 *
 * wasm-bindgen's `--target web` glue ends with
 *
 *     if (typeof module_or_path === 'undefined')
 *         module_or_path = new URL('vm_rust_bg.wasm', import.meta.url);
 *
 * and Vite 3 turns that `new URL(...)` into an inlined
 * `data:application/wasm;base64,...`. The polyfill never takes that branch: its
 * standalone entry always passes `wasmUrl`, a blob built from the DEFLATED copy
 * that `vite-plugin-embed-resources` supplies. So the bundle shipped the same
 * 8.4 MB module twice - once deflated (3.9 MB of base64) and once raw
 * (11.2 MB of base64), the latter dead weight.
 *
 * Measured on this game: bundle 15.5 MB -> 4.4 MB.
 *
 * The replacement is a relative URL that names itself, so if some host ever
 * does reach the branch, the failure says what happened instead of
 * "expected magic word".
 */
const MARKER = 'data:application/wasm;base64,';
const MIN_PAYLOAD = 100000;
const REPLACEMENT = 'dirplayer-wasm-stripped-the-embedded-copy-is-used-instead.wasm';

// Scanned by hand rather than by regex: a quantified character class over a
// 15 MB string blows the JS engine's stack.
function isB64(code) {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
    || (code >= 48 && code <= 57) || code === 43 || code === 47 || code === 61;
}

function stripFrom(code) {
  let out = code;
  let removed = 0;
  let from = 0;
  for (;;) {
    const start = out.indexOf(MARKER, from);
    if (start === -1) break;
    let end = start + MARKER.length;
    while (end < out.length && isB64(out.charCodeAt(end))) end++;
    const payload = end - (start + MARKER.length);
    if (payload < MIN_PAYLOAD) {
      from = end;
      continue;
    }
    out = out.slice(0, start) + REPLACEMENT + out.slice(end);
    removed += end - start;
    from = start + REPLACEMENT.length;
  }
  return { out, removed };
}

export default function stripInlineWasm() {
  return {
    name: 'strip-inline-wasm',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      for (const fileName of Object.keys(bundle)) {
        const chunk = bundle[fileName];
        if (chunk.type !== 'chunk') continue;
        const { out, removed } = stripFrom(chunk.code);
        if (removed) {
          chunk.code = out;
          console.log(
            `[strip-inline-wasm] ${fileName}: removed ${removed} chars ` +
            `(${(removed / 1048576).toFixed(1)} MB) of duplicated wasm`);
        }
      }
    },
  };
}
