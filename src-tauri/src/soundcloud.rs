// Интеграция SoundCloud через крейт soundcloud-rs.
//
// ВАЖНО О СЕТИ: основной сайт soundcloud.com у части пользователей
// заблокирован (ECONNRESET), а api-v2.soundcloud.com и m.soundcloud.com —
// доступны. Поэтому Client::new() крейта (скрейпит soundcloud.com) не
// работает — client_id получаем из мобильной версии m.soundcloud.com
// и вручную собираем Client из его публичных полей.
//
// Поиск возвращает треки с уже разрешёнными прямыми ссылками
// progressive-стримов (mp3), которые играет <audio>.
// HLS-only треки пропускаются: WebView2 не умеет HLS в audio-элементе.

use serde::Serialize;
use soundcloud_rs::{Client, Identifier, RetryConfig, SOUNDCLOUD_API_URL, Stream, StreamType, TracksQuery};
use soundcloud_rs::response::{Track, Transcoding};
use soundcloud_rs::response::Track as ScTrackRaw;
use std::sync::OnceLock;
use tokio::sync::{Mutex, RwLock};

// Резервный client_id (актуален на момент сборки; при устаревании
// код сам переоткроет свежий из m.soundcloud.com)
const FALLBACK_CLIENT_ID: &str = "KKzJxmw11tYpCs6T24P4uUYhqmjalG6M";
const MOBILE_SITE_URL: &str = "https://m.soundcloud.com/";

static CLIENT_SLOT: OnceLock<Mutex<Option<Client>>> = OnceLock::new();

fn client_slot() -> &'static Mutex<Option<Client>> {
    CLIENT_SLOT.get_or_init(|| Mutex::new(None))
}

// Извлечение client_id (32 alnum-символа после "client_id") без regex.
fn extract_client_id(html: &str) -> Option<String> {
    let mut search_from = 0usize;
    while let Some(rel) = html[search_from..].find("client_id") {
        let after = search_from + rel + "client_id".len();
        let mut run = String::new();
        for &b in html.as_bytes().get(after..)? {
            let c = b as char;
            if c.is_ascii_alphanumeric() {
                run.push(c);
                if run.len() == 32 {
                    return Some(run);
                }
            } else if run.is_empty() && (b == b'"' || b == b'\'' || b == b':' || b == b'=' || b == b' ' || b == b'\\') {
                continue; // разделители перед значением
            } else {
                break;
            }
        }
        search_from = after;
    }
    None
}

async fn discover_client_id() -> Option<String> {
    let text = reqwest::Client::new()
        .get(MOBILE_SITE_URL)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
        .send()
        .await
        .ok()?
        .text()
        .await
        .ok()?;
    extract_client_id(&text)
}

async fn create_client() -> Result<Client, String> {
    let client_id = discover_client_id()
        .await
        .unwrap_or_else(|| FALLBACK_CLIENT_ID.to_string());
    // retry_on_401 выключаем: штатный refresh крейта скрейпит
    // заблокированный soundcloud.com — устаревший id обрабатываем сами.
    Ok(Client {
        client_id: RwLock::new(client_id),
        retry_config: RetryConfig { max_retries: 1, retry_on_401: false },
    })
}

async fn client() -> tokio::sync::MutexGuard<'static, Option<Client>> {
    let mut guard = client_slot().lock().await;
    if guard.is_none() {
        match create_client().await {
            Ok(c) => *guard = Some(c),
            Err(_) => {} // останется None — команды вернут ошибку
        }
    }
    guard
}

#[derive(Debug, Serialize)]
pub struct ScTrack {
    pub id: i64,
    pub title: String,
    pub artist: String,
    pub duration_ms: i64,
    pub artwork_url: Option<String>,
    pub avatar_url: Option<String>,
    pub permalink_url: Option<String>,
    pub genre: Option<String>,
    pub tag_list: Option<String>,
    pub stream_url: Option<String>,
}

// Разрешаем прямую ссылку прогрессивного (mp3) стрима из media.transcodings.
// Приоритет — полный трек; если его нет, допускаем 30-секундный сниппет.
async fn resolve_progressive_stream(track: &Track, client_id: &str) -> Option<String> {
    let transcodings = track.media.as_ref()?.transcodings.as_ref()?;
    if transcodings.is_empty() {
        return None;
    }

    let mut full: Vec<&Transcoding> = Vec::new();
    let mut snippets: Vec<&Transcoding> = Vec::new();
    for t in transcodings {
        let Some(fmt) = t.format.as_ref() else { continue };
        if fmt.protocol.as_ref() != Some(&StreamType::Progressive) {
            continue;
        }
        if t.url.is_none() {
            continue;
        }
        if t.snipped == Some(true) {
            snippets.push(t);
        } else {
            full.push(t);
        }
    }

    for t in full.iter().chain(snippets.iter()) {
        let url = t.url.as_deref().unwrap_or_default();
        if let Ok((stream, _)) = Client::get_json::<Stream, ()>(url, None, None::<&()>, client_id).await {
            if let Some(u) = stream.url {
                return Some(u);
            }
        }
    }
    None
}

fn to_sc_track(track: &Track, stream_url: Option<String>) -> Option<ScTrack> {
    let id = track.id?;
    Some(ScTrack {
        id,
        title: track.title.clone().unwrap_or_else(|| "Без названия".into()),
        artist: track
            .user
            .as_ref()
            .and_then(|u| u.username.clone())
            .unwrap_or_else(|| "Unknown artist".into()),
        duration_ms: track.duration.unwrap_or(0),
        artwork_url: track.artwork_url.clone(),
        // Аватар артиста — fallback для обложки, если у трека нет artwork
        avatar_url: track
            .user
            .as_ref()
            .and_then(|u| u.avatar_url.clone()),
        permalink_url: track.permalink_url.clone(),
        genre: track.genre.clone(),
        tag_list: track.tag_list.clone(),
        stream_url,
    })
}

async fn resolve_collection(tracks: Vec<Track>, client_id: &str) -> Vec<ScTrack> {
    use futures::stream::{self, StreamExt};

    // Ограничение на огромные плейлисты: 500+ треков не должны блокировать UI
    const MAX_RESOLVE: usize = 150;
    const CONCURRENCY: usize = 8;

    stream::iter(tracks.into_iter().take(MAX_RESOLVE))
        .map(|track| async move {
            let stream_url = resolve_progressive_stream(&track, client_id).await?;
            to_sc_track(&track, Some(stream_url))
        })
        .buffer_unordered(CONCURRENCY)
        .filter_map(|x| async move { x })
        .collect::<Vec<_>>()
        .await
}

async fn search_with_retry(query: &TracksQuery) -> Result<Vec<ScTrack>, String> {
    let mut guard = client().await;
    for attempt in 0..2 {
        let Some(client) = guard.as_ref() else {
            return Err("SoundCloud client unavailable".into());
        };
        let result = client.search_tracks(Some(query)).await;
        match result {
            Ok(resp) => {
                let client_id = client.get_client_id_value().await;
                return Ok(resolve_collection(resp.collection, &client_id).await);
            }
            Err(e) => {
                let msg = e.to_string();
                // client_id устарел — переоткрываем свежий и повторяем один раз
                if attempt == 0 && (msg.contains("401") || msg.contains("403")) {
                    if let Ok(fresh) = create_client().await {
                        *guard = Some(fresh);
                        continue;
                    }
                }
                return Err(msg);
            }
        }
    }
    Err("SoundCloud search failed".into())
}

#[tauri::command]
pub async fn soundcloud_search(q: String, limit: Option<u32>) -> Result<Vec<ScTrack>, String> {
    let query = TracksQuery {
        q: Some(q),
        limit: Some(limit.unwrap_or(20).clamp(1, 50) as i32),
        linked_partitioning: Some(false),
        ..Default::default()
    };
    search_with_retry(&query).await
}

#[derive(serde::Serialize)]
struct ChartsQuery {
    kind: &'static str,
    genre: String,
    limit: i32,
}

#[derive(serde::Deserialize)]
struct ChartsItem {
    #[serde(default)]
    track: Option<Track>,
}

#[derive(serde::Deserialize)]
struct ChartsResponse {
    #[serde(default)]
    collection: Vec<ChartsItem>,
}

// Сопоставление frontend-идентификатора жанра с официальным URN чарта SoundCloud
// и поисковым fallback-запросом.
fn map_genre_to_urn_and_query(genre: &str) -> (&'static str, Option<&'static str>) {
    match genre {
        "hiphop-rap" | "hiphop" | "rap" => ("hiphoprap", Some("hip hop rap")),
        "jazz" => ("jazzblues", Some("jazz blues")),
        "rnb" | "r&b" => ("rbsoul", Some("r&b soul")),
        "electronic" | "edm" => ("electronic", Some("electronic edm")),
        "house" => ("house", Some("house music")),
        "techno" => ("techno", Some("techno")),
        "rock" => ("rock", Some("rock alternative")),
        "pop" => ("pop", Some("pop")),
        "metal" => ("metal", Some("metal")),
        "classical" => ("classical", Some("classical piano orchestra")),
        "ambient" => ("ambient", Some("ambient chill")),
        "trap" => ("trap", Some("trap")),
        "indie" => ("indie", Some("indie rock")),
        "phonk" => ("all-music", Some("drift phonk")),
        "lofi" | "lo-fi" => ("all-music", Some("lofi hip hop chill")),
        _ => ("all-music", None),
    }
}

// Глобальный чарт SoundCloud (charts API, kind=trending) с надёжным fallback на поиск.
#[tauri::command]
pub async fn soundcloud_charts(genre: Option<String>, limit: Option<u32>) -> Result<Vec<ScTrack>, String> {
    let raw_genre = genre.unwrap_or_else(|| "all-music".into());
    let (sc_genre, fallback_q) = map_genre_to_urn_and_query(&raw_genre);
    let target_limit = limit.unwrap_or(20).clamp(1, 50) as i32;

    let genre_urn = format!("soundcloud:genres:{}", sc_genre);
    let query = ChartsQuery {
        kind: "trending",
        genre: genre_urn,
        limit: target_limit,
    };

    let mut guard = client().await;
    let mut chart_tracks: Vec<Track> = Vec::new();

    for attempt in 0..2 {
        let Some(client) = guard.as_ref() else {
            return Err("SoundCloud client unavailable".into());
        };
        let result = Client::get_json::<ChartsResponse, ChartsQuery>(
            SOUNDCLOUD_API_URL,
            Some("charts"),
            Some(&query),
            &client.get_client_id_value().await,
        )
        .await;
        match result {
            Ok((resp, _)) => {
                chart_tracks = resp.collection.into_iter().filter_map(|i| i.track).collect();
                break;
            }
            Err(e) => {
                let msg = e.to_string();
                if attempt == 0 && (msg.contains("401") || msg.contains("403")) {
                    if let Ok(fresh) = create_client().await {
                        *guard = Some(fresh);
                        continue;
                    }
                }
                break;
            }
        }
    }

    // Если чарт вернул треки — разрешаем аудио-потоки
    if !chart_tracks.is_empty() {
        if let Some(client) = guard.as_ref() {
            let client_id = client.get_client_id_value().await;
            let resolved = resolve_collection(chart_tracks, &client_id).await;
            if !resolved.is_empty() {
                return Ok(resolved);
            }
        }
    }

    // Fallback: если чарт по этому жанру пуст или недоступен (например phonk/lofi/ошибка чартов),
    // ищем топовые треки по жанровому запросу через search
    let search_term = fallback_q.unwrap_or(raw_genre.as_str());
    let search_q = TracksQuery {
        q: Some(search_term.to_string()),
        limit: Some(target_limit),
        linked_partitioning: Some(false),
        ..Default::default()
    };

    drop(guard);
    search_with_retry(&search_q).await
}

// Обновление истёкшей stream-ссылки (фронт вызывает при ошибке воспроизведения).
#[tauri::command]
pub async fn soundcloud_stream_url(id: i64) -> Result<Option<String>, String> {
    let guard = client().await;
    let Some(client) = guard.as_ref() else {
        return Err("SoundCloud client unavailable".into());
    };
    let track = client
        .get_track(&Identifier::Id(id))
        .await
        .map_err(|e| e.to_string())?;
    let client_id = client.get_client_id_value().await;
    Ok(resolve_progressive_stream(&track, &client_id).await)
}

// ===== Артисты и плейлисты =====

#[derive(Debug, Serialize)]
pub struct ScUser {
    pub id: i64,
    pub username: String,
    pub avatar_url: Option<String>,
    pub followers_count: i64,
    pub track_count: i64,
    pub verified: bool,
    pub permalink_url: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ScPlaylist {
    pub id: i64,
    pub title: String,
    pub artwork_url: Option<String>,
    pub username: String,
    pub track_count: i64,
    pub permalink_url: Option<String>,
}

// Универсальный query-набор для поисковых и пагинированных эндпоинтов
#[derive(serde::Serialize)]
struct ListQuery<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    q: Option<&'a str>,
    limit: i32,
}

#[tauri::command]
pub async fn soundcloud_search_artists(q: String, limit: Option<u32>) -> Result<Vec<ScUser>, String> {
    let query = ListQuery { q: Some(q.as_str()), limit: limit.unwrap_or(20).clamp(1, 50) as i32 };
    let mut guard = client().await;
    for attempt in 0..2 {
        let Some(client) = guard.as_ref() else {
            return Err("SoundCloud client unavailable".into());
        };
        let cid = client.get_client_id_value().await;
        match Client::get_json::<soundcloud_rs::response::Users, ListQuery>(
            SOUNDCLOUD_API_URL, Some("search/users"), Some(&query), &cid,
        ).await {
            Ok(resp) => return Ok(resp.0.collection.iter().filter_map(|u| {
                let id = u.id?;
                Some(ScUser {
                    id,
                    username: u.username.clone().unwrap_or_else(|| "Unknown".into()),
                    avatar_url: u.avatar_url.clone(),
                    followers_count: u.followers_count.unwrap_or(0) as i64,
                    track_count: u.track_count.unwrap_or(0) as i64,
                    verified: u.verified.unwrap_or(false),
                    permalink_url: u.permalink_url.clone(),
                })
            }).collect()),
            Err(e) => {
                let msg = e.to_string();
                if attempt == 0 && (msg.contains("401") || msg.contains("403")) {
                    if let Ok(fresh) = create_client().await { *guard = Some(fresh); continue; }
                }
                return Err(msg);
            }
        }
    }
    Err("SoundCloud artists search failed".into())
}

#[tauri::command]
pub async fn soundcloud_artist_tracks(user_id: i64, limit: Option<u32>) -> Result<Vec<ScTrack>, String> {
    let path = format!("users/{}/tracks", user_id);
    let query = ListQuery { q: None, limit: limit.unwrap_or(20).clamp(1, 50) as i32 };
    let mut guard = client().await;
    let mut raw: Option<Vec<ScTrackRaw>> = None;
    for attempt in 0..2 {
        let Some(client) = guard.as_ref() else {
            return Err("SoundCloud client unavailable".into());
        };
        let cid = client.get_client_id_value().await;
        match Client::get_json::<soundcloud_rs::response::Tracks, ListQuery>(
            SOUNDCLOUD_API_URL, Some(&path), Some(&query), &cid,
        ).await {
            Ok(resp) => { raw = Some(resp.0.collection); break; }
            Err(e) => {
                let msg = e.to_string();
                if attempt == 0 && (msg.contains("401") || msg.contains("403")) {
                    if let Ok(fresh) = create_client().await { *guard = Some(fresh); continue; }
                }
                return Err(msg);
            }
        }
    }
    let raw = raw.ok_or_else(|| "SoundCloud artist tracks failed".to_string())?;
    let cid = match guard.as_ref() { Some(c) => c.get_client_id_value().await, None => String::new() };
    Ok(resolve_collection(raw, &cid).await)
}

#[tauri::command]
pub async fn soundcloud_search_playlists(q: String, limit: Option<u32>) -> Result<Vec<ScPlaylist>, String> {
    let query = ListQuery { q: Some(q.as_str()), limit: limit.unwrap_or(15).clamp(1, 50) as i32 };
    let mut guard = client().await;
    for attempt in 0..2 {
        let Some(client) = guard.as_ref() else {
            return Err("SoundCloud client unavailable".into());
        };
        let cid = client.get_client_id_value().await;
        match Client::get_json::<soundcloud_rs::response::Playlists, ListQuery>(
            SOUNDCLOUD_API_URL, Some("search/playlists"), Some(&query), &cid,
        ).await {
            Ok(resp) => return Ok(resp.0.collection.iter().filter_map(|p| {
                let id = p.id?;
                // Обложка плейлиста: у части плейлистов artwork нет —
                // показываем аватар владельца вместо битой картинки
                let artwork = p
                    .artwork_url
                    .clone()
                    .or_else(|| p.user.as_ref().and_then(|u| u.avatar_url.clone()));
                Some(ScPlaylist {
                    id: id as i64,
                    title: p.title.clone().unwrap_or_else(|| "Без названия".into()),
                    artwork_url: artwork,
                    username: p.user.as_ref().and_then(|u| u.username.clone()).unwrap_or_default(),
                    track_count: p.track_count.unwrap_or(0) as i64,
                    permalink_url: p.permalink_url.clone(),
                })
            }).collect()),
            Err(e) => {
                let msg = e.to_string();
                if attempt == 0 && (msg.contains("401") || msg.contains("403")) {
                    if let Ok(fresh) = create_client().await { *guard = Some(fresh); continue; }
                }
                return Err(msg);
            }
        }
    }
    Err("SoundCloud playlists search failed".into())
}

// Полный список треков плейлиста с разрешёнными stream-ссылками
#[tauri::command]
pub async fn soundcloud_playlist_tracks(playlist_id: i64) -> Result<Vec<ScTrack>, String> {
    let mut guard = client().await;
    let mut raw: Option<Vec<ScTrackRaw>> = None;
    for attempt in 0..2 {
        let Some(client) = guard.as_ref() else {
            return Err("SoundCloud client unavailable".into());
        };
        match client.get_playlist(&Identifier::Id(playlist_id)).await {
            Ok(p) => { raw = Some(p.tracks.unwrap_or_default()); break; }
            Err(e) => {
                let msg = e.to_string();
                if attempt == 0 && (msg.contains("401") || msg.contains("403")) {
                    if let Ok(fresh) = create_client().await { *guard = Some(fresh); continue; }
                }
                return Err(msg);
            }
        }
    }
    let raw = raw.ok_or_else(|| "SoundCloud playlist tracks failed".to_string())?;
    let cid = match guard.as_ref() { Some(c) => c.get_client_id_value().await, None => String::new() };
    Ok(resolve_collection(raw, &cid).await)
}
