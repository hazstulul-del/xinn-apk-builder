# XINN Web2APK Pro GitHub Builder

Bot ini solusi kalau panel kamu cuma **NodeJS** dan tidak bisa install Flutter.

Alur:
Telegram ZIP Flutter → Bot NodeJS → GitHub Actions → APK artifact → Bot kirim APK.

## Setup GitHub
1. Buat repo baru, contoh: `xinn-apk-builder`
2. Upload folder `.github/workflows/flutter-build.yml` ke repo itu.
3. Buka tab **Actions** di repo, pastikan enabled.

## Buat GitHub Token
GitHub → Settings → Developer settings → Personal access tokens → Tokens classic.

Centang:
- repo
- workflow

## Setup panel
Upload ZIP ini ke panel, extract, lalu rename:
`.env.example` → `.env`

Isi:
```env
BOT_TOKEN=token_bot_kamu
GITHUB_TOKEN=token_github_kamu
GITHUB_OWNER=username_github_kamu
GITHUB_REPO=xinn-apk-builder
OWNER_IDS=7562630960
```

Run:
```bash
npm install
npm start
```

## Cara pakai
Kirim ZIP project Flutter, lalu reply:
```txt
/buildapk
```

Untuk debug:
```txt
/builddebug
```
