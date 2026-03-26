alter table public.books
    add column if not exists digital_cover_url text;
