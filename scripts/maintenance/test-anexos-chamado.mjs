import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { File } from 'node:buffer';
globalThis.File = File;
const source = readFileSync(new URL('../../public/js/componentes/anexos-chamado.js', import.meta.url), 'utf8')
  .replace('import { prepararArquivoParaUpload } from "./otimizar-upload.js";', 'const prepararArquivoParaUpload = async f => f;');
const { validarArquivoParaUpload: validar, prepararArquivoParaUploadChamado: preparar, tipoVideo } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const arquivo = (name, type, mb) => ({ name, type, size: mb * 1024 * 1024 });
for (const type of ['video/mp4', 'video/webm', 'video/quicktime']) {
  validar(arquivo('video', type, 50));
  assert.throws(() => validar(arquivo('video', type, 50.001)));
}
validar(arquivo('foto.png', 'image/png', 10));
assert.throws(() => validar(arquivo('foto.png', 'image/png', 11)));
validar(arquivo('doc.pdf', 'application/pdf', 5));
assert.throws(() => validar(arquivo('doc.pdf', 'application/pdf', 6)));
assert.throws(() => validar(arquivo('arquivo.exe', 'application/octet-stream', 1)));
assert.equal(tipoVideo(arquivo('VIDEO.MOV', '', 1)), 'video/quicktime');
assert.equal(tipoVideo(arquivo('falso.mp4', 'application/pdf', 1)), null);
const mov = await preparar(new File(['video'], 'gravacao.mov', { type: '' }));
assert.equal(mov.type, 'video/quicktime');
assert.equal(await mov.text(), 'video');
console.log('Validação de anexos: formatos, limites e normalização aprovados.');
