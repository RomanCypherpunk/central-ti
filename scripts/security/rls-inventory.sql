-- Inventário somente leitura. Execute como postgres no SQL Editor ou via psql.
-- Não seleciona valores do Vault, tokens, payloads pg_net nem dados de usuários.
-- Salve o resultado fora do diretório public/. Não exige extensões opcionais.
begin read only;
set local statement_timeout = '30s';

-- 1. Contexto e privilégios de schema/TEMP. CREATE em schema usado por DEFINER
-- exige investigação. TEMP sozinho não prova um caminho pelo REST.
select current_database() as database_name, current_user as executing_role,
       current_setting('server_version') as server_version,
       current_setting('session_replication_role') as replication_role;
select r.rolname, r.rolsuper, r.rolbypassrls, n.nspname,
       has_schema_privilege(r.oid, n.oid, 'USAGE') as can_use_schema,
       has_schema_privilege(r.oid, n.oid, 'CREATE') as can_create_in_schema,
       has_database_privilege(r.oid, current_database(), 'TEMP') as can_create_temp
from pg_roles r cross join pg_namespace n
where r.rolname in ('anon', 'authenticated', 'service_role')
  and n.nspname in ('public', 'extensions', 'vault', 'net', 'auth', 'storage')
order by n.nspname, r.rolname;

-- 2. TODAS as tabelas/partições públicas, mais schemas sensíveis.
-- has_table_privilege inclui grants herdados e PUBLIC, ao contrário de
-- procurar apenas um GRANT explícito para anon.
select n.nspname as schema_name, c.relname, c.relkind,
       pg_get_userbyid(c.relowner) as owner, c.relrowsecurity, c.relforcerowsecurity,
       r.rolname,
       has_table_privilege(r.oid,c.oid,'SELECT') as can_select,
       has_any_column_privilege(r.oid,c.oid,'SELECT') as can_select_any_column,
       has_table_privilege(r.oid,c.oid,'INSERT') as can_insert,
       has_table_privilege(r.oid,c.oid,'UPDATE') as can_update,
       has_table_privilege(r.oid,c.oid,'DELETE') as can_delete,
       has_table_privilege(r.oid,c.oid,'TRUNCATE') as can_truncate,
       has_table_privilege(r.oid,c.oid,'TRIGGER') as can_create_trigger
from pg_class c join pg_namespace n on n.oid=c.relnamespace
cross join pg_roles r
where c.relkind in ('r','p','v','m','f')
  and n.nspname in ('public','vault','net','storage','auth')
  and r.rolname in ('anon','authenticated')
order by n.nspname,c.relname,r.rolname;

-- 3. Policies completas. TO PUBLIC, omissão de TO, ALL e policies paralelas
-- precisam ser avaliados em conjunto. Uma policy não concede o GRANT de tabela.
select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check
from pg_policies where schemaname in ('public','storage')
order by schemaname,tablename,cmd,policyname;

-- 4. Policies aplicáveis a anon/authenticated, inclusive membership herdado.
-- Isto identifica candidatas; só a expressão + GRANT + RLS definem o resultado.
select n.nspname,c.relname,p.polname,r.rolname,p.polcmd,p.polpermissive,
       pg_get_expr(p.polqual,p.polrelid) as using_expression,
       pg_get_expr(p.polwithcheck,p.polrelid) as check_expression
from pg_policy p join pg_class c on c.oid=p.polrelid
join pg_namespace n on n.oid=c.relnamespace cross join pg_roles r
where n.nspname in ('public','storage')
  and r.rolname in ('anon','authenticated')
  and exists (
    select 1 from unnest(p.polroles) as pr(role_oid)
    where case when pr.role_oid=0 then true
               else pg_has_role(r.oid,pr.role_oid,'USAGE') end
  )
order by n.nspname,c.relname,r.rolname,p.polname;

-- 5. Funções/procedures chamáveis, parâmetros, volatilidade, owner e ACL efetiva.
-- proacl NULL usa o ACL default (normalmente EXECUTE TO PUBLIC).
-- returns_trigger=true: não é RPC normal; investigar trigger que a invoca.
select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) as arguments,
       p.prokind,pg_get_userbyid(p.proowner) as owner,owner_role.rolbypassrls,
       p.prosecdef,p.provolatile,p.pronargs,p.proconfig,
       p.prorettype in ('pg_catalog.trigger'::regtype,'pg_catalog.event_trigger'::regtype)
         as returns_trigger,
       has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
       has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
       exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
              where a.grantee=0 and a.privilege_type='EXECUTE') as public_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
join pg_roles owner_role on owner_role.oid=p.proowner
where n.nspname in ('public','vault','net') and p.prokind in ('f','p')
order by n.nspname,p.proname,arguments;

-- 6. Default privileges: correção da ACL de funções novas depende do role criador.
select pg_get_userbyid(d.defaclrole) as creator_role,
       coalesce(n.nspname,'<global>') as schema_name,d.defaclobjtype,
       case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee,
       a.privilege_type,a.is_grantable
from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace
cross join lateral aclexplode(d.defaclacl) a
order by creator_role,schema_name,d.defaclobjtype,grantee;

-- 7. Triggers e ordem alfabética. O=normal, D=desabilitado, R=réplica, A=sempre.
-- SECURITY DEFINER não desabilita trigger; verificar BEFOREs posteriores que
-- modifiquem NEW e vínculos criados apenas no Studio.
select n.nspname,c.relname,t.tgname,t.tgenabled,
       (t.tgtype & 2)<>0 as is_before,(t.tgtype & 4)<>0 as on_insert,
       (t.tgtype & 16)<>0 as on_update,
       pn.nspname as function_schema,p.proname,p.prosecdef,
       pg_get_userbyid(p.proowner) as function_owner
from pg_trigger t join pg_class c on c.oid=t.tgrelid
join pg_namespace n on n.oid=c.relnamespace
join pg_proc p on p.oid=t.tgfoid join pg_namespace pn on pn.oid=p.pronamespace
where not t.tgisinternal and n.nspname in ('public','auth','storage')
order by n.nspname,c.relname,t.tgname;

-- 8. Colunas sensíveis: descobrir grants parciais que os grants de tabela não mostram.
select n.nspname,c.relname,a.attname,r.rolname,
       has_column_privilege(r.oid,c.oid,a.attnum,'SELECT') as can_select,
       has_column_privilege(r.oid,c.oid,a.attnum,'INSERT') as can_insert,
       has_column_privilege(r.oid,c.oid,a.attnum,'UPDATE') as can_update
from pg_attribute a join pg_class c on c.oid=a.attrelid
join pg_namespace n on n.oid=c.relnamespace cross join pg_roles r
where a.attnum>0 and not a.attisdropped and n.nspname='public'
  and c.relname in ('usuarios','comentarios','artigos','chamados','push_subscriptions')
  and r.rolname in ('anon','authenticated')
order by c.relname,r.rolname,a.attnum;

-- 9. Views públicas: security_invoker precisa constar de reloptions quando
-- a intenção é aplicar RLS do usuário. Sem isso, revisar owner e definição.
select n.nspname,c.relname,pg_get_userbyid(c.relowner) as owner,c.reloptions
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where c.relkind in ('v','m') and n.nspname in ('public','graphql_public');

-- 10. Buckets e contagem de objetos: nenhum nome de arquivo/conteúdo é retornado.
select b.id,b.public,b.file_size_limit,b.allowed_mime_types,count(o.id) as object_count
from storage.buckets b left join storage.objects o on o.bucket_id=b.id
group by b.id,b.public,b.file_size_limit,b.allowed_mime_types order by b.id;

-- 11. Manifesto de migrations, quando existir (sem acesso a statements).
select n.nspname,c.relname
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='supabase_migrations' and c.relname='schema_migrations';
rollback;
