-- One line per object in public and private: its definition and privileges.
-- Run on tacit-internal's stack and on this repo's, then diff: the only
-- differences must be the staff-only objects (staff-only.json).
set search_path = '';
select 'rel ' || n.nspname || '.' || c.relname || ' ' || c.relkind::text || ' rls=' || c.relrowsecurity::text || ' acl=' || coalesce(c.relacl::text, '')
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public', 'private') and c.relkind in ('r', 'v', 'm', 'S', 'p', 'i')
union all
select 'col ' || c.relname || '.' || a.attname || ' ' || pg_catalog.format_type(a.atttypid, a.atttypmod) || ' nn=' || a.attnotnull::text
       || ' def=' || coalesce(pg_catalog.pg_get_expr(d.adbin, d.adrelid), '') || ' acl=' || coalesce(a.attacl::text, '')
from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
where n.nspname in ('public', 'private') and c.relkind in ('r', 'v') and a.attnum > 0 and not a.attisdropped
union all
select 'fn ' || p.oid::regprocedure::text || ' ' || md5(pg_catalog.pg_get_functiondef(p.oid)) || ' acl=' || coalesce(p.proacl::text, '')
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'private') and p.prokind in ('f', 'p')
union all
select 'pol ' || tablename || '.' || policyname || ' ' || md5(coalesce(qual, '') || '|' || coalesce(with_check, '') || '|' || cmd || '|' || roles::text || '|' || permissive)
from pg_policies where schemaname in ('public', 'private')
union all
select 'con ' || k.conrelid::regclass::text || '.' || k.conname || ' ' || md5(pg_catalog.pg_get_constraintdef(k.oid))
from pg_constraint k join pg_namespace n on n.oid = k.connamespace where n.nspname in ('public', 'private')
union all
select 'trg ' || t.tgrelid::regclass::text || '.' || t.tgname || ' ' || md5(pg_catalog.pg_get_triggerdef(t.oid))
from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public', 'private') and not t.tgisinternal
union all
select 'idx ' || indexrelid::regclass::text || ' ' || md5(pg_catalog.pg_get_indexdef(indexrelid))
from pg_index i join pg_class c on c.oid = i.indexrelid join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public', 'private')
order by 1;
