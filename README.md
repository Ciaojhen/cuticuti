# CutiCuti 旅行筆記

記錄與安排旅行行程的手機 App（PWA）。

👉 **App 網址：https://ciaojhen.github.io/cuticuti/**

不需要上架 App Store，用瀏覽器打開後「加入主畫面」就能像 App 一樣使用，沒網路也能開。

## 功能
- **行程**：依天分頁的時間軸，可設定時間、類別、地點（一鍵開 Google 地圖）、花費、連結、備註，完成後可打勾
- **口袋名單**：想去但還沒排進哪一天的地方
- **日記**：每天寫心得、選心情、加照片（自動壓縮）
- **清單**：行李與待辦，內建常用清單
- **花費**：依類別、依日期自動加總
- **分享行程**：轉成文字，可直接貼到 LINE
- **備份 / 還原**：匯出成 JSON 檔（含照片）

資料只存在手機瀏覽器裡（IndexedDB），不會上傳。換手機前記得先匯出備份。

## 在電腦上預覽
```bash
npx http-server -p 5173 -c-1
```
然後打開 http://localhost:5173

## 放到手機上
PWA 必須透過 **HTTPS** 網址開啟，才能離線使用。最簡單的免費方式：

1. **Netlify Drop**：打開 https://app.netlify.com/drop ，把整個 `CutiCuti` 資料夾拖進去，就會得到一個網址
2. 或者用 **GitHub Pages** / **Cloudflare Pages**

拿到網址後：
- **iPhone**：用 Safari 開啟 → 分享按鈕 → 「加入主畫面」
- **Android**：用 Chrome 開啟 → ⋮ → 「安裝應用程式」

## 更新程式後
修改 `sw.js` 裡的 `CACHE` 版本號（例如 `cuticuti-v2` → `cuticuti-v3`），重新部署即可。
