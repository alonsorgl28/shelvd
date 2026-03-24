alter table public.books
    add column if not exists isbn_13 text,
    add column if not exists isbn_10 text,
    add column if not exists publisher text,
    add column if not exists published_year integer,
    add column if not exists edition text,
    add column if not exists language text,
    add column if not exists translator text,
    add column if not exists format text,
    add column if not exists match_status text,
    add column if not exists spine_photo_url text,
    add column if not exists back_photo_url text;

create index if not exists idx_books_isbn_13 on public.books (isbn_13);
create index if not exists idx_books_isbn_10 on public.books (isbn_10);
