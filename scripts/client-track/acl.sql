-- Prints the exact privileges of every relation and function in public and
-- private, as REVOKE ALL + GRANT statements. pg_dump writes ACLs relative to
-- the owner's built-in default, so a project whose default privileges grant
-- anon / authenticated everything would otherwise keep grants the source had
-- revoked (a member's TRUNCATE on home_targets, say).
-- An empty search_path, so argument types print schema-qualified.
set search_path = '';
\pset tuples_only on

select stmt from (
with roles(r) as (values ('anon'), ('authenticated'), ('service_role'), ('tacit_internal')),
rels as (
  select c.oid, pg_catalog.format('%I.%I', n.nspname, c.relname) as name,
         case when c.relkind = 'S' then 'SEQUENCE' else 'TABLE' end as kind,
         coalesce(c.relacl, pg_catalog.acldefault((case when c.relkind = 'S' then 's' else 'r' end)::"char", c.relowner)) as acl
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'private') and c.relkind in ('r', 'v', 'm', 'S', 'p')
),
fns as (
  select p.oid, pg_catalog.format('%I.%I(%s)', n.nspname, p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid)) as name,
         p.proname, coalesce(p.proacl, pg_catalog.acldefault('f'::"char", p.proowner)) as acl
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private') and p.prokind in ('f', 'p')
)
select 1 as ord, pg_catalog.format('REVOKE ALL ON %s %s FROM anon, authenticated, service_role, tacit_internal;', kind, name) ||
       coalesce((select pg_catalog.string_agg(pg_catalog.format(E'\nGRANT %s ON %s %s TO %I;', privs, kind, name, grantee), '')
                 from (select g.rolname as grantee, pg_catalog.string_agg(a.privilege_type, ', ' order by a.privilege_type) as privs
                       from pg_catalog.aclexplode(acl) a join pg_roles g on g.oid = a.grantee
                       where g.rolname in (select r from roles) group by g.rolname) x), '')
from rels
union all
-- Column grants after the table's REVOKE ALL, which also revokes them.
select 2, pg_catalog.format('GRANT %s(%I) ON TABLE %I.%I TO %I;', a.privilege_type, att.attname, n.nspname, c.relname, g.rolname)
from pg_attribute att
join pg_class c on c.oid = att.attrelid
join pg_namespace n on n.oid = c.relnamespace
cross join lateral pg_catalog.aclexplode(att.attacl) a
join pg_roles g on g.oid = a.grantee
where n.nspname in ('public', 'private') and att.attacl is not null and g.rolname in (select r from roles)
union all
select 3, pg_catalog.format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role, tacit_internal;', name) ||
       coalesce((select pg_catalog.string_agg(pg_catalog.format(E'\nGRANT EXECUTE ON FUNCTION %s TO %s;', name,
                                          case when a.grantee = 0 then 'PUBLIC' else pg_catalog.quote_ident(g.rolname) end), '')
                 from pg_catalog.aclexplode(acl) a left join pg_roles g on g.oid = a.grantee
                 where a.grantee = 0 or g.rolname in (select r from roles)), '')
from fns
) x(ord, stmt) order by ord, stmt;
