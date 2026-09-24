// Supabase 連線設定（和 FooooooD 共用同一個 Supabase 專案）
// 這兩個值本來就是設計給網頁前端使用的公開資訊，資料安全由資料庫的權限規則（RLS）保護。
// ⚠️ 千萬不要把 service_role / secret key 或資料庫密碼放在這裡！
window.CUTI_CONFIG = {
  SUPABASE_URL: 'https://rdltvbrpobsxfwzjssmo.supabase.co',
  SUPABASE_KEY: 'sb_publishable_Gffty1whIXDOF--1QMF0QQ_ExO6wHrh',
};
