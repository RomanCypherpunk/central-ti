// QUEM ESTA LOGADO — PERGUNTADO UMA VEZ SO POR PAGINA.
//
// Antes, cada tela protegida fazia o mesmo caminho tres vezes: o auth-guard
// conferia a sessao, o guard da pagina chamava getUser() e lia `usuarios`, e
// o main.js (mais o script da propria tela) repetia tudo. Eram ate quatro
// idas a rede para responder "quem e voce?", em serie, antes de a tela
// mostrar qualquer coisa.
//
// Aqui a resposta e calculada uma vez e compartilhada: quem chegar depois
// recebe a mesma promessa, sem nova consulta.
//
// getSession() le a sessao que o proprio navegador ja guardou, sem ida ao
// servidor; getUser() vai ao servidor a cada chamada. Para desenhar a tela,
// getSession basta — quem protege os dados de verdade e a RLS no banco, que
// confere o token no servidor em toda consulta.

import { supabase } from "./config/supabase-config.js";

//Tudo que as telas pedem do cadastro, numa consulta so.
const CAMPOS_PERFIL = `
  id, nome, sobrenome, email, perfil, status_aprovacao, ativo,
  foto_path, setor_id, unidade_id, setores(nome)
`;

let promessaSessao = null;
let promessaPerfil = null;

export function sessaoAtual() {
  promessaSessao ??= supabase.auth.getSession().then(({ data }) => data?.session ?? null);

  return promessaSessao;
}

export function usuarioAtual() {
  return sessaoAtual().then((sessao) => sessao?.user ?? null);
}

export function meuPerfil() {
  promessaPerfil ??= (async () => {
    const usuario = await usuarioAtual();

    if (!usuario) return null;

    const { data, error } = await supabase
      .from("usuarios")
      .select(CAMPOS_PERFIL)
      .eq("id", usuario.id)
      .single();

    if (error) {
      console.warn("Não foi possível ler o seu cadastro.", error);
      return null;
    }

    return data;
  })();

  return promessaPerfil;
}

// Dados pessoais grava e precisa reler o que acabou de mudar.
export function esquecerPerfil() {
  promessaPerfil = null;
}

//AS TRES PERMISSOES DO SISTEMA, no mesmo desenho das funcoes do banco:
//  aprovado          -> cadastro liberado (is_aprovado)
//  escreveArtigo     -> cadastra solucao na Base (pode_escrever_artigo)
//  equipeTi          -> atende chamado no Portal (is_equipe_ti)
//Esconder tela nunca foi controle de acesso: isto evita carregar uma tela
//que a RLS ia recusar, nada mais.
export function permissoes(perfil) {
  const aprovado = perfil?.status_aprovacao === "aprovado" && Boolean(perfil?.ativo);

  return {
    aprovado,
    escreveArtigo: aprovado && ["contribuinte", "analista", "admin"].includes(perfil?.perfil),
    equipeTi: aprovado && ["analista", "admin"].includes(perfil?.perfil),
    admin: aprovado && perfil?.perfil === "admin",
  };
}

//GUARDA DE TELA: deixa entrar ou manda para outro lugar. `permitido` recebe
//as permissoes acima e devolve true/false.
//
//Sem sessao nao faz nada: o auth-guard ja esta mandando para o login, e
//redirecionar duas vezes atrapalha a volta pelo historico.
export async function exigir(permitido, destino) {
  const usuario = await usuarioAtual();

  if (!usuario) return false;

  if (permitido(permissoes(await meuPerfil()))) return true;

  window.location.replace(destino);

  return false;
}
