const tl = gsap.timeline({ paused: true });
const q = (s) => document.querySelector(s);
const qa = (s) => Array.from(document.querySelectorAll(s));
const LARANJA = "#dd5b12";
const CINZA = "#d7dce3";

// ---------- helpers ----------
function digitar(id, ocultarPh) {
  const cfg = TYPING.find((t) => t.id === id);
  const chars = qa(`#${id} .ch`);
  const carets = [q(`#${id} .cr0`), ...qa(`#${id} .ch .cr`)];
  if (ocultarPh) tl.set(ocultarPh, { opacity: 0 }, cfg.t0);
  tl.set(carets[0], { opacity: 1 }, cfg.t0 - 0.2);
  chars.forEach((ch, i) => {
    const t = cfg.t0 + i * cfg.dt;
    tl.set(ch, { opacity: 1 }, t);
    tl.set(carets[i], { opacity: 0 }, t);
    tl.set(carets[i + 1], { opacity: 1 }, t);
  });
  return { fim: cfg.t0 + cfg.n * cfg.dt, ultimo: carets[carets.length - 1] };
}
function focar(input, t, ate) {
  tl.to(input, { borderColor: LARANJA, boxShadow: "0 0 0 5px rgba(221,91,18,0.14)", duration: 0.15 }, t);
  if (ate) tl.to(input, { borderColor: CINZA, boxShadow: "0 0 0 0px rgba(221,91,18,0)", duration: 0.15 }, ate);
}
function clicar(cursorSel, btnSel, t) {
  tl.to(`${cursorSel} svg`, { scale: 0.82, duration: 0.08, yoyo: true, repeat: 1, transformOrigin: "20% 10%" }, t);
  tl.fromTo(`${cursorSel} .ripple`, { scale: 0.3, opacity: 0.9 }, { scale: 1.6, opacity: 0, duration: 0.45, ease: "power2.out" }, t);
  if (btnSel) tl.to(btnSel, { scale: 0.95, duration: 0.08, yoyo: true, repeat: 1 }, t);
}
function moverCursor(sel, de, para, t, dur) {
  tl.fromTo(sel, { x: de[0], y: de[1], opacity: 0 }, { x: para[0], y: para[1], opacity: 1, duration: dur, ease: "power2.inOut" }, t);
}
function etiqueta(sel, tIn, tOut) {
  tl.fromTo(sel, { x: -40, opacity: 0 }, { x: 0, opacity: 1, duration: 0.45, ease: "back.out(1.6)" }, tIn);
  if (tOut != null) tl.to(sel, { x: -30, opacity: 0, duration: 0.3, ease: "power2.in" }, tOut);
}
// Entrada de cena: a nova tela desliza por cima, a anterior recua um pouco.
function entrar(palco, anterior, t) {
  tl.fromTo(palco, { xPercent: 100 }, { xPercent: 0, duration: OV, ease: "power3.inOut" }, t);
  if (anterior) tl.to(anterior, { x: -320, duration: OV, ease: "power3.inOut" }, t);
}

// ---------- 1. HOOK ----------
tl.fromTo("#hook-logo", { y: -30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: "power3.out" }, 0.05);
tl.fromTo("#hook-marca", { opacity: 0 }, { opacity: 1, duration: 0.5 }, 0.15);
tl.fromTo("#hook-t1", { y: 80, scale: 1.08, opacity: 0 }, { y: 0, scale: 1, opacity: 1, duration: 0.55, ease: "expo.out", transformOrigin: "0% 100%" }, 0.2);
tl.fromTo("#hook-t2", { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: "power3.out" }, 0.95);
tl.fromTo("#hook-brilho", { x: 0, y: 0 }, { x: -260, y: 120, duration: 3.1, ease: "sine.inOut" }, 0);

// ---------- 2. CADASTRO + CODIGO ----------
entrar("#cad-palco", "#hook-palco", S.cad[0]);
tl.fromTo("#cad-cam", { scale: 1.0 }, { scale: 1.03, duration: T.etapa3 - S.cad[0] - OV, ease: "none" }, S.cad[0] + OV);
etiqueta("#tag-cad", S.cad[0] + 0.45, T.etapa3 - 0.2);

focar("#in-nome", T.nome - 0.25, T.sobrenome - 0.15);
const nome = digitar("tp-nome", "#ph-nome");
tl.set(nome.ultimo, { opacity: 0 }, T.sobrenome - 0.15);
focar("#in-sobrenome", T.sobrenome - 0.15, T.setor - 0.05);
const sob = digitar("tp-sobrenome", "#ph-sobrenome");
tl.set(sob.ultimo, { opacity: 0 }, T.setor - 0.05);
focar("#in-setor", T.setor - 0.05, T.unidade - 0.05);
tl.set("#ph-setor", { opacity: 0 }, T.setor);
tl.fromTo("#v-setor", { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.2 }, T.setor);
focar("#in-unidade", T.unidade - 0.05, T.proximo - 0.3);
tl.set("#ph-unidade", { opacity: 0 }, T.unidade);
tl.fromTo("#v-unidade", { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.2 }, T.unidade);
moverCursor("#cur-cad", [1500, 980], [912, 762], T.proximo - 0.6, 0.55);
clicar("#cur-cad", "#btn-proximo", T.proximo);
tl.to("#cur-cad", { opacity: 0, duration: 0.2 }, T.proximo + 0.35);

// troca de etapa (1 -> 3): o form desliza para a esquerda
tl.to("#etapa1", { x: -140, opacity: 0, duration: 0.35, ease: "power2.in" }, T.etapa3 - 0.3);
tl.fromTo("#etapa3", { x: 140, opacity: 0 }, { x: 0, opacity: 1, duration: 0.45, ease: "power3.out" }, T.etapa3);
tl.to("#cont-1", { y: -20, opacity: 0, duration: 0.2 }, T.etapa3 - 0.1);
tl.fromTo("#cont-3", { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.25 }, T.etapa3);
etiqueta("#tag-cod", T.etapa3 + 0.3, null);
tl.fromTo("#email-toast", { y: -140, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: "back.out(1.4)" }, T.email);
tl.to("#email-toast", { y: -140, opacity: 0, duration: 0.35, ease: "power2.in" }, T.confirmar - 0.2);
focar("#in-codigo", T.codigo - 0.3, T.confirmar - 0.3);
const cod = digitar("tp-codigo", "#ph-codigo");
tl.set(cod.ultimo, { opacity: 0 }, T.confirmar - 0.3);
tl.fromTo("#cur-cad", { x: 1400, y: 1000, opacity: 0 }, { x: 962, y: 866, opacity: 1, duration: 0.5, ease: "power2.inOut", immediateRender: false }, T.confirmar - 0.55);
clicar("#cur-cad", "#btn-confirmar", T.confirmar);
tl.fromTo("#ok-email", { scale: 0.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.4, ease: "back.out(2)" }, T.ok);
tl.to("#cur-cad", { opacity: 0, duration: 0.2 }, T.ok + 0.3);
tl.fromTo("#cad-cam", { scale: 1.03 }, { scale: 1.06, duration: 3.0, ease: "none", immediateRender: false }, T.etapa3);

// ---------- 3. HOME ----------
entrar("#home-palco", "#cad-palco", S.home[0]);
tl.fromTo("#home-cam", { scale: 1.0 }, { scale: 1.035, duration: 3.3, ease: "none" }, S.home[0] + OV);
tl.fromTo("#saudacao", { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: "power3.out" }, T.saud);
tl.fromTo("#porta1", { y: 90, opacity: 0 }, { y: 0, opacity: 1, duration: 0.55, ease: "power3.out" }, T.porta1);
tl.fromTo("#porta2", { y: 90, opacity: 0 }, { y: 0, opacity: 1, duration: 0.55, ease: "power3.out" }, T.porta2);
etiqueta("#tag-home", S.home[0] + 0.55, null);
moverCursor("#cur-home", [1650, 1000], [1198, 742], T.cursorHome, 0.8);
clicar("#cur-home", "#btn-novo", T.novo); // beat-locked: 12.65s
tl.to("#porta2", { boxShadow: "0 0 0 6px rgba(255,255,255,0.9), 0 30px 70px rgba(40,10,10,0.3)", duration: 0.25 }, T.novo);

// ---------- 4. TRIAGEM ----------
const SOBE = 188; // altura do passo a passo + gap da lista
tl.set(".tri-acoes", { y: -SOBE }, S.tri[0]);
entrar("#tri-palco", "#home-palco", S.tri[0]);
etiqueta("#tag-tri", S.tri[0] + 0.55, null);
const tri = digitar("tp-triagem", "#ph-triagem");
tl.to("#dica-1", { opacity: 0, duration: 0.2 }, T.busca);
tl.to("#dica-2", { opacity: 1, duration: 0.2 }, T.busca + 0.1);
// a camera sobe para acompanhar a lista de solucoes
tl.to("#tri-cam", { y: -600, duration: 0.8, ease: "power3.inOut" }, T.busca);
tl.to("#resultado", { opacity: 1, duration: 0.3 }, T.busca + 0.1);
[0, 1, 2].forEach((i) => {
  tl.fromTo(`#tri-item-${i}`, { y: 50 - (i ? SOBE : 0), opacity: 0 }, { y: -(i ? SOBE : 0), opacity: 1, duration: 0.45, ease: "power3.out" }, T.itens + i * 0.3);
});
moverCursor("#cur-tri", [1500, 1000], [1438, 288], T.abrir - 0.7, 0.6);
clicar("#cur-tri", null, T.abrir);
tl.set("#tri-ver-0", { opacity: 0 }, T.abrir);
tl.to("#tri-item-0", { borderColor: "#f0b394", duration: 0.2 }, T.abrir);
tl.fromTo("#tri-passos", { opacity: 0, y: -10 }, { opacity: 1, y: 0, duration: 0.35 }, T.abrir + 0.05);
// itens de baixo nascem "colados" no primeiro e descem quando o passo a passo abre
tl.to(["#tri-item-1", "#tri-item-2", ".tri-acoes"], { y: 0, duration: 0.4, ease: "power3.out" }, T.abrir);
tl.to("#cur-tri", { opacity: 0, duration: 0.2 }, T.abrir + 0.5);

// ---------- 5. BASE ----------
entrar("#base-palco", "#tri-palco", S.base[0]);
tl.fromTo("#base-cam", { scale: 1.0 }, { scale: 1.04, duration: 3.4, ease: "none" }, S.base[0] + OV);
etiqueta("#tag-base", S.base[0] + 0.55, null);
[0, 1, 2, 3].forEach((i) => {
  tl.fromTo(`#sol-card-${i}`, { y: 60, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45, ease: "power3.out" }, T.cards + i * 0.26);
});

// ---------- 6. SOLICITACOES ----------
entrar("#sol-palco", "#base-palco", S.sol[0]);
etiqueta("#tag-sol", S.sol[0] + 0.55, null);
[0, 1, 2].forEach((i) => {
  tl.fromTo(`#chamado-${i}`, { y: 70, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: "power3.out" }, T.chamados + i * 0.3);
});
tl.to("#chamado-0", { scale: 1.05, borderColor: "#d64545", boxShadow: "0 30px 70px rgba(214,69,69,0.25)", duration: 0.45, ease: "back.out(1.8)" }, T.destaque);
tl.to(["#chamado-1", "#chamado-2"], { opacity: 0.55, duration: 0.45 }, T.destaque);
tl.fromTo("#sol-cam", { scale: 1.0 }, { scale: 1.05, duration: 2.0, ease: "power1.inOut", transformOrigin: "25% 70%" }, T.destaque - 0.2);

// ---------- 7. OUTRO ----------
tl.fromTo("#out-palco", { opacity: 0 }, { opacity: 1, duration: 0.45, ease: "power2.out" }, S.out[0]);
tl.to("#sol-palco", { scale: 0.94, duration: 0.5, ease: "power2.in" }, S.out[0]);
tl.fromTo("#out-logo", { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: "power3.out" }, T.logo);
tl.fromTo("#out-titulo", { y: 60, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, ease: "expo.out" }, T.logo + 0.12);
tl.fromTo("#out-linha", { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: "power3.out" }, T.logo + 0.4);
tl.fromTo("#out-url", { scale: 0.85, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.45, ease: "back.out(1.8)" }, T.logo + 0.7);

// ---------- brilho reage a musica (hook e outro) ----------
function brilho(sel, de, ate) {
  for (let f = Math.round(de * 30); f < Math.round(ate * 30) && f < RMS.length; f++) {
    const v = RMS[f];
    tl.call(() => gsap.set(sel, { opacity: 0.55 + v * 0.45, scale: 0.92 + v * 0.14 }), [], f / 30);
  }
}
brilho("#hook-brilho", 0, S.hook[1]);
brilho("#out-brilho", S.out[0], 28);

window.__timelines["main"] = tl;
