// Configuração do Supabase.
// Console: supabase.com/dashboard > TI gasometro > Project Settings > API Keys
//
// Esta chave (anon/publishable) NÃO é segredo: ela identifica o projeto, não
// autoriza nada por si só. Quem protege os dados são as políticas de Row
// Level Security (RLS) configuradas nas tabelas e no bucket do Storage.

// A biblioteca mora aqui dentro (js/vendor), e nao num CDN. Vinda do esm.sh
// em tempo de execucao, ela chegava em 17 arquivos encadeados e segurava a
// pagina por ~800ms antes de qualquer coisa aparecer — e todas as telas
// esperam por ela para saber quem esta logado. Para atualizar a versao:
// docs/plano-implementacao.md explica de onde o arquivo veio.
import { createClient } from "../vendor/supabase-js.js";

const SUPABASE_URL = "https://pmwcfdxryjwsvwsmcufm.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_eyb7tOIsJ5DhKypU-PFZpA_xBSf99Lt";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
