// Интеграция Deezer через публичное API (api.deezer.com) — без ключей.
//
// Поиск (треки/артисты/плейлисты) полностью публичный. Воспроизведение —
// официальный 30-секундный превью-фрагмент (preview, mp3). Ссылки на превью
// подписаны и устаревают, поэтому при ошибке воспроизведения фронт
// запрашивает свежую через deezer_track_stream.

use serde::Serialize;
use serde_json::Value;

const API_BASE: &str = "https://api.deezer.com";

fn http() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
        .build()
        .unwrap_or_default()
}

async fn get_json(path: &str) -> Result<Value, String> {
    let url = format!("{}{}", API_BASE, path);
    let resp = http().get(&url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("Deezer HTTP {}", resp.status()));
    }
    let v: Value = resp.json().await.map_err(|e| e.to_string())?;
    if let Some(err) = v.get("error") {
        if !err.is_null() {
            let msg = err
                .get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("неизвестная ошибка");
            return Err(format!("Deezer API: {}", msg));
        }
    }
    Ok(v)
}

#[derive(Debug, Serialize)]
pub struct DzTrack {
    pub id: i64,
    pub title: String,
    pub artist: String,
    pub duration_sec: i64,
    pub cover_medium: Option<String>,
    pub cover_big: Option<String>,
    pub preview: Option<String>,
    pub link: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct DzUser {
    pub id: i64,
    pub name: String,
    pub picture_medium: Option<String>,
    pub nb_fan: i64,
    pub nb_album: i64,
    pub link: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct DzPlaylist {
    pub id: i64,
    pub title: String,
    pub cover_medium: Option<String>,
    pub cover_big: Option<String>,
    pub user_name: String,
    pub nb_tracks: i64,
    pub link: Option<String>,
}

fn s(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(|x| x.as_str()).map(String::from)
}

fn i64v(v: &Value, key: &str) -> i64 {
    v.get(key).and_then(|x| x.as_i64()).unwrap_or(0)
}

fn parse_track(v: &Value) -> Option<DzTrack> {
    let id = v.get("id")?.as_i64()?;
    Some(DzTrack {
        id,
        title: s(v, "title").unwrap_or_else(|| "Без названия".into()),
        artist: v
            .get("artist")
            .and_then(|a| s(a, "name"))
            .unwrap_or_else(|| "Unknown artist".into()),
        duration_sec: i64v(v, "duration"),
        cover_medium: v
            .get("album")
            .and_then(|a| s(a, "cover_medium")),
        cover_big: v.get("album").and_then(|a| s(a, "cover_big")),
        preview: s(v, "preview").filter(|p| !p.is_empty()),
        link: s(v, "link"),
    })
}

fn parse_user(v: &Value) -> Option<DzUser> {
    let id = v.get("id")?.as_i64()?;
    Some(DzUser {
        id,
        name: s(v, "name").unwrap_or_else(|| "Unknown".into()),
        picture_medium: s(v, "picture_medium").or_else(|| s(v, "picture")),
        nb_fan: i64v(v, "nb_fan"),
        nb_album: i64v(v, "nb_album"),
        link: s(v, "link"),
    })
}

fn parse_playlist(v: &Value) -> Option<DzPlaylist> {
    let id = v.get("id")?.as_i64()?;
    Some(DzPlaylist {
        id,
        title: s(v, "title").unwrap_or_else(|| "Без названия".into()),
        cover_medium: s(v, "cover_medium"),
        cover_big: s(v, "cover_big"),
        user_name: v
            .get("user")
            .and_then(|u| s(u, "name"))
            .unwrap_or_default(),
        nb_tracks: i64v(v, "nb_tracks"),
        link: s(v, "link"),
    })
}

fn encode_query(q: &str) -> String {
    // Ручное URL-кодирование, чтобы не тянуть urlencoding-крейт
    let mut out = String::with_capacity(q.len() + 8);
    for b in q.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*b as char)
            }
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

async fn search(kind: &str, q: &str, limit: u32) -> Result<Vec<Value>, String> {
    let path = format!(
        "/search/{}?q={}&limit={}",
        kind,
        encode_query(q),
        limit.clamp(1, 50)
    );
    let v = get_json(&path).await?;
    Ok(v.get("data")
        .and_then(|d| d.as_array())
        .cloned()
        .unwrap_or_default())
}

#[tauri::command]
pub async fn deezer_search(q: String, limit: Option<u32>) -> Result<Vec<DzTrack>, String> {
    let items = search("track", &q, limit.unwrap_or(25)).await?;
    Ok(items.iter().filter_map(parse_track).collect())
}

#[tauri::command]
pub async fn deezer_search_artists(q: String, limit: Option<u32>) -> Result<Vec<DzUser>, String> {
    let items = search("artist", &q, limit.unwrap_or(20)).await?;
    Ok(items.iter().filter_map(parse_user).collect())
}

#[tauri::command]
pub async fn deezer_search_playlists(q: String, limit: Option<u32>) -> Result<Vec<DzPlaylist>, String> {
    let items = search("playlist", &q, limit.unwrap_or(15)).await?;
    Ok(items.iter().filter_map(parse_playlist).collect())
}

// Топ-треки артиста (как плейлист). /artist/{id}/top отдаёт те же объекты трека.
#[tauri::command]
pub async fn deezer_artist_tracks(artist_id: i64, limit: Option<u32>) -> Result<Vec<DzTrack>, String> {
    let path = format!("/artist/{}/top?limit={}", artist_id, limit.unwrap_or(20).clamp(1, 50));
    let v = get_json(&path).await?;
    let items = v.get("data").and_then(|d| d.as_array()).cloned().unwrap_or_default();
    Ok(items.iter().filter_map(parse_track).collect())
}

// Треки плейлиста (играется как очередь)
#[tauri::command]
pub async fn deezer_playlist_tracks(playlist_id: i64) -> Result<Vec<DzTrack>, String> {
    let path = format!("/playlist/{}/tracks?limit=100", playlist_id);
    let v = get_json(&path).await?;
    let items = v.get("data").and_then(|d| d.as_array()).cloned().unwrap_or_default();
    Ok(items.iter().filter_map(parse_track).collect())
}

// Свежая превью-ссылка по id трека (старые подписанные URL устаревают).
#[tauri::command]
pub async fn deezer_track_stream(id: i64) -> Result<Option<String>, String> {
    let path = format!("/track/{}", id);
    let v = get_json(&path).await?;
    let preview = s(&v, "preview").filter(|p| !p.is_empty());
    let readable = v.get("readable").and_then(|r| r.as_bool()).unwrap_or(true);
    if !readable && preview.is_none() {
        return Err("Трек недоступен в Deezer".into());
    }
    Ok(preview)
}
