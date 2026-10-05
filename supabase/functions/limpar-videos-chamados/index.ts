import { createClient } from "https://esm.sh/@supabase/supabase-js@2.116.0";

Deno.serve(async (req) => {
  const chave = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!chave || req.headers.get("Authorization") !== `Bearer ${chave}`) {
    return new Response("Não autorizado", { status: 401 });
  }
  if (req.method !== "POST") return new Response("Método inválido", { status: 405 });
  const cliente = createClient(Deno.env.get("SUPABASE_URL")!, chave, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let removidos = 0;
  try {
    // Limita duração e volume; pendências são retomadas no dia seguinte.
    for (let lote = 0; lote < 10; lote++) {
      const { data, error } = await cliente.rpc("videos_expirados_chamados");
      if (error) throw error;
      if (!data?.length) break;
      const paths = data.map((item: { storage_path: string }) => item.storage_path);
      // Storage API apaga o arquivo físico. Nunca apagar apenas storage.objects.
      const resultado = await cliente.storage.from("anexos").remove(paths);
      if (resultado.error) throw resultado.error;
      const exclusao = await cliente.from("anexos").delete().in("storage_path", paths)
        .lte("video_expira_em", new Date().toISOString());
      if (exclusao.error) throw exclusao.error;
      removidos += paths.length;
    }
    console.log("Limpeza de vídeos concluída", { removidos });
    return Response.json({ removidos });
  } catch (erro) {
    console.error("Falha na limpeza de vídeos", erro);
    return Response.json({ erro: "Falha na limpeza; será repetida na próxima execução", removidos }, { status: 500 });
  }
});
