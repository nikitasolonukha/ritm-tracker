create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.match_documents(
  filter jsonb,
  match_count integer,
  query_embedding public.vector
)
returns table(id bigint, content text, metadata jsonb, similarity double precision)
language sql
stable
set search_path = pg_catalog, public
as $$
  select
    t.id,
    t.content,
    t.metadata,
    (1 - (t.embedding <=> query_embedding)) as similarity
  from public."RAGformyAIagent" t
  where
    (filter is null or filter = '{}'::jsonb or t.metadata @> filter)
  order by t.embedding <=> query_embedding
  limit match_count;
$$;
