# Overfy 🎵

> Быстрый, легковесный и функциональный музыкальный плеер на React + Tauri v2 (Rust).

Overfy объединяет прослушивание музыки из **SoundCloud**, **Deezer**, **Яндекс Музыки** и локальных файлов в едином интерфейсе с рекомендательной волной, текстами песен (LRCLIB), комнатами совместного прослушивания и синхронизацией профиля через **Supabase**.

---

## 🌟 Основные возможности

* **Агрегация источников:** Музыка из SoundCloud, Deezer, Яндекс Музыки без рекламы.
* **Моя Волна:** Умный алгоритм подбора треков по жанрам (Phonk, Lo-Fi, Hip-Hop, Rock, Pop, Ambient, Electronic и др.) с учетом вашей истории и тегов.
* **Скачивание треков:** Загрузка любимых песен прямо в папку `Загрузки/Overfy` в формате MP3.
* **Синхронизированные тексты песен:** Построчный просмотр текстов через сервис LRCLIB с автопрокруткой.
* **Плейлисты и локальные треки:** Создание публичных и приватных плейлистов, а также воспроизведение локальной аудиотеки с компьютера.
* **Комнаты совместного прослушивания:** Комнаты для совместного прослушивания музыки, чат и реакции в реальном времени.
* **Discord Rich Presence:** Отображение текущего играющего трека, исполнителя и времени в вашем Discord статусе.
* **Векторный интерфейс:** Полностью кастомный темный UI без эмодзи на чистых SVG-иконках с поддержкой смены тем и кастомных фонов.

---

## 🛠 Стек технологий

* **Frontend:** React 18, Vite, React Router, Context API, CSS Variables.
* **Desktop Core:** [Tauri v2](https://v2.tauri.app/), Rust, Tokio, Reqwest, WebView2.
* **База данных и авторизация:** [Supabase](https://supabase.com/) (PostgreSQL, Row Level Security, Realtime).
* **Компиляция на Windows:** MSYS2 MinGW-w64 (`x86_64-pc-windows-gnu`).

---

## 🚀 Быстрый старт

### Требования
* **Node.js:** v18 или новее.
* **Rust:** `stable-x86_64-pc-windows-gnu` или `stable-x86_64-pc-windows-msvc`.
* **MSYS2 MinGW-w64 (для GNU toolchain на Windows):** `gcc`, `windres`.

### 1. Установка зависимостей
```bash
npm install
```

### 2. Настройка окружения
Скопируйте пример файла конфигурации:
```bash
cp .env.example .env
```
Откройте файл `.env` и укажите данные вашего проекта Supabase:
```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```
> **Примечание:** Если Supabase не настроен, приложение автоматически работает в **гостевом режиме** (локальное хранилище в localStorage, вся музыка и поиск остаются полностью доступны). База данных нужна для синхронизации аккаунтов, друзей и комнат. Схема таблиц находится в папке `supabase/schema.sql`.

### 3. Запуск в режиме разработки

* **Веб-версия в браузере:**
  ```bash
  npm run dev
  ```
  После запуска перейдите на [http://localhost:3000](http://localhost:3000).

* **Десктопное приложение (Tauri):**
  ```bash
  npm run tauri dev
  ```

---

## 📦 Сборка релиза

### Сборка веб-интерфейса:
```bash
npm run build
```
Готовый бандл будет сохранен в папке `dist/`.

### Сборка десктопного приложения (`.exe`):
```bash
npm run tauri build -- --no-bundle
```
Или запустите готовый скрипт:
```cmd
build.cmd
```
Собранный исполняемый файл появится по адресу:
`src-tauri/target/release/app.exe`.

---

## 📂 Структура проекта

```text
Overfy/
├── src/                      # Исходный код React-интерфейса
│   ├── components/           # Компоненты (PlayerBar, NowPlaying, Icons, SideNav и др.)
│   ├── contexts/             # Контексты состояния (PlayerContext, AuthContext, SettingsContext)
│   ├── pages/                # Страницы (HomePage, SearchPage, PlaylistsPage, RoomsPage и др.)
│   ├── services/             # Интеграции API (SoundCloud, Deezer, Yandex, Supabase, Tauri Bridge)
│   └── styles/               # Глобальные стили темы
├── src-tauri/                # Бэкенд Tauri на Rust
│   ├── src/                  # Исходный код Rust (commands.rs, soundcloud.rs, deezer.rs, discord_rpc.rs)
│   ├── Cargo.toml            # Зависимости Rust
│   └── tauri.conf.json       # Конфигурация окна и разрешений Tauri
├── supabase/                 # Схемы PostgreSQL и миграции
├── public/                   # Статические ресурсы
└── build.cmd                 # Скрипт сборки под Windows
```

---

## 📄 Лицензия

Распространяется под свободной лицензией MIT.
