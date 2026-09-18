// WEB PUSH DE VERDADE PARA O PORTAL DE CHAMADOS.
//
// Chamada por 2 triggers (comentarios_notificar_portal,
// chamados_notificar_portal, ver migration 20260917140000) via pg_net a
// cada INSERT nessas tabelas. Roda no servidor — funciona com a aba do
// Portal em segundo plano/minimizada, diferente da tentativa anterior
// (Notification API pura no navegador, que so disparava com a aba em
// primeiro plano porque o navegador suspende o WebSocket do tempo real em
// abas em background).
//
// 3 gatilhos (o "fui adicionado como atendente" foi descartado a pedido
// do usuario):
//   1. Resposta do solicitante, em chamado onde a pessoa e atendente
//      -> titulo do chamado / "{Nome do solicitante} respondeu"
//      (Portal — pro atendente)
//   2. Chamado novo, em qualquer fila (a categoria do formulario ja
//      decide a fila de destino, nem todo chamado nasce no Inbox)
//      -> titulo do chamado / "Novo ticket aberto"
//      (Portal — pra equipe toda, analista/admin)
//   3. Resposta de um atendente, em chamado de qualquer solicitante
//      -> titulo do chamado / "{Nome do atendente} respondeu seu chamado"
//      (Suas solicitações — pro dono do chamado)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT")!;

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function tituloDoChamado(chamado: { titulo: string | null; numero: number; categoria_nome: string | null }) {
  return chamado.titulo ?? `${chamado.categoria_nome ?? "Sem categoria"} | Ticket-${chamado.numero}`;
}

//MANDA O PUSH PARA TODAS AS INSCRICOES DE UM USUARIO. Se alguma
//inscricao estiver morta (404/410 — navegador desinstalado, permissao
//revogada, cache do navegador limpo), apaga a linha em vez de tentar de
//novo depois.
async function notificarUsuario(usuarioId: string, titulo: string, corpo: string) {
  const { data: inscricoes } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("usuario_id", usuarioId);

  if (!inscricoes?.length) return;

  const payload = JSON.stringify({ titulo, corpo });

  await Promise.all(inscricoes.map(async (inscricao) => {
    const subscription = {
      endpoint: inscricao.endpoint,
      keys: { p256dh: inscricao.p256dh, auth: inscricao.auth },
    };

    try {
      await webpush.sendNotification(subscription, payload);
    } catch (erro) {
      const status = erro?.statusCode;

      if (status === 404 || status === 410) {
        await supabase.from("push_subscriptions").delete().eq("id", inscricao.id);
      } else {
        console.error("Falha ao enviar push:", usuarioId, status, erro?.body ?? erro);
      }
    }
  }));
}

//GATILHO 1 (e o novo 3): comentario novo. So interessa resposta publica
//de gente de verdade (nao nota interna, nao mensagem de sistema). Dois
//sentidos, mutuamente exclusivos — quem escreveu decide quem e avisado:
//  - Autor e o SOLICITANTE -> avisa os atendentes do chamado (gatilho 1
//    original: "{Nome} respondeu seu chamado", pro atendente).
//  - Autor e ATENDENTE (alguem diferente do solicitante) -> avisa o
//    SOLICITANTE (gatilho novo, pedido do usuario pra tela de
//    solicitacoes.html: "{Nome do atendente} respondeu seu chamado").
async function tratarComentarioNovo(comentario: {
  id: string; chamado_id: string; autor_id: string; tipo: string; visibilidade: string;
}) {
  if (comentario.tipo !== "humano" || comentario.visibilidade !== "publico") return;

  const { data: chamado, error } = await supabase
    .from("chamados")
    .select("id, numero, titulo, solicitante_id, categorias(nome), chamado_membros(usuario_id)")
    .eq("id", comentario.chamado_id)
    .maybeSingle();

  if (error || !chamado) {
    console.error("notificar-portal: chamado não encontrado para comentário", comentario.id, error);
    return;
  }

  const { data: autor } = await supabase
    .from("usuarios")
    .select("nome")
    .eq("id", comentario.autor_id)
    .maybeSingle();

  const rotulo = tituloDoChamado({
    titulo: chamado.titulo,
    numero: chamado.numero,
    categoria_nome: (chamado.categorias as { nome: string } | null)?.nome ?? null,
  });

  if (comentario.autor_id === chamado.solicitante_id) {
    // Solicitante respondeu: avisa quem atende o chamado.
    const corpo = `${autor?.nome ?? "O solicitante"} respondeu`;
    const membros = (chamado.chamado_membros ?? []) as { usuario_id: string }[];

    await Promise.all(membros.map((membro) => notificarUsuario(membro.usuario_id, rotulo, corpo)));
  } else {
    // Atendente respondeu: avisa o dono do chamado.
    const corpo = `${autor?.nome ?? "Um atendente"} respondeu seu chamado`;

    await notificarUsuario(chamado.solicitante_id, rotulo, corpo);
  }
}

//GATILHO 2: chamado novo, em QUALQUER fila. A categoria escolhida no
//formulário público já decide a fila de destino (nem todo chamado nasce
//no Inbox — cair direto em "Internet, Conexão e Telefonia" por causa da
//categoria é normal, não só triagem/equipe redirecionando manualmente),
//então restringir à fila de menor `ordem` deixava passar chamados novos
//de verdade sem avisar ninguém.
async function tratarChamadoNovo(chamado: {
  id: string; numero: number; titulo: string | null; fila_id: string; categorias?: unknown;
}) {
  const { data: categoria } = await supabase
    .from("chamados")
    .select("categorias(nome)")
    .eq("id", chamado.id)
    .maybeSingle();

  const rotulo = tituloDoChamado({
    titulo: chamado.titulo,
    numero: chamado.numero,
    categoria_nome: (categoria?.categorias as { nome: string } | null)?.nome ?? null,
  });

  // Chamado acabou de nascer: ainda ninguem e atendente dele. "Novo
  // ticket aberto" avisa toda a equipe que pode atender (analista/admin),
  // nao so quem ja esta no chamado (que ainda e ninguem).
  const { data: equipe } = await supabase
    .from("usuarios")
    .select("id")
    .in("perfil", ["analista", "admin"])
    .eq("ativo", true);

  await Promise.all((equipe ?? []).map((pessoa) => notificarUsuario(pessoa.id, rotulo, "Novo ticket aberto")));
}

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    const tabela = payload.table as string;
    const linha = payload.record;

    if (tabela === "comentarios") {
      await tratarComentarioNovo(linha);
    } else if (tabela === "chamados") {
      await tratarChamadoNovo(linha);
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (erro) {
    console.error("notificar-portal: erro inesperado", erro);
    return new Response(JSON.stringify({ ok: false, erro: String(erro) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
