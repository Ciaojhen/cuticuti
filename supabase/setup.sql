-- CutiCuti 旅行筆記：Supabase 資料庫設定（和 FooooooD 共用同一個專案，但資料表、照片空間都分開）
-- 用法：Supabase 專案 → SQL Editor → New query → 貼上全部 → Run
-- 可以重複執行，不會重複建立，也不會動到 FooooooD 的資料

-- 1. 旅程資料表：每趟旅程一列，行程、日記、清單整包存在 data（JSON）
create table if not exists public.cuti_trips (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- 2. 權限：每個人只能看到、修改自己的旅程
alter table public.cuti_trips enable row level security;

drop policy if exists "cuticuti 只能讀自己的旅程" on public.cuti_trips;
create policy "cuticuti 只能讀自己的旅程" on public.cuti_trips
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "cuticuti 只能新增自己的旅程" on public.cuti_trips;
create policy "cuticuti 只能新增自己的旅程" on public.cuti_trips
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "cuticuti 只能修改自己的旅程" on public.cuti_trips;
create policy "cuticuti 只能修改自己的旅程" on public.cuti_trips
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "cuticuti 只能刪除自己的旅程" on public.cuti_trips;
create policy "cuticuti 只能刪除自己的旅程" on public.cuti_trips
  for delete to authenticated using (user_id = auth.uid());

-- 3. 照片儲存空間（不公開），每個人的照片放在以自己 user id 命名的資料夾
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('trip-photos', 'trip-photos', false, 5242880, array['image/jpeg'])
on conflict (id) do nothing;

drop policy if exists "cuticuti 只能讀自己的照片" on storage.objects;
create policy "cuticuti 只能讀自己的照片" on storage.objects
  for select to authenticated
  using (bucket_id = 'trip-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "cuticuti 只能上傳自己的照片" on storage.objects;
create policy "cuticuti 只能上傳自己的照片" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'trip-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "cuticuti 只能覆蓋自己的照片" on storage.objects;
create policy "cuticuti 只能覆蓋自己的照片" on storage.objects
  for update to authenticated
  using (bucket_id = 'trip-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'trip-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "cuticuti 只能刪除自己的照片" on storage.objects;
create policy "cuticuti 只能刪除自己的照片" on storage.objects
  for delete to authenticated
  using (bucket_id = 'trip-photos' and (storage.foldername(name))[1] = auth.uid()::text);
