// Интеграция Яндекс Музыки через мобильное API (api.music.yandex.net).
//
// Требуется OAuth-токен пользователя (кнопка/ссылка в настройках:
// https://oauth.yandex.ru/authorize?response_type=token&client_id=23cabbbdc6cd418abb4b39c32c41195d
// — access_token из URL редиректа). Токен вводится в настройках и хранится
// только локально (localStorage), никуда не отправляется.
//
// ВАЖНО О ПРЯМЫХ ССЫЛКАХ: собранная ссылка get-mp3 живёт ~1 минуту, поэтому
// search НЕ возвращает ссылки на аудио — фронт вызывает yandex_track_stream
// в момент нажатия Play. Схема: /tracks/{id}/download-info -> downloadInfoUrl
// -> XML(host,path,ts,s) -> sign = md5(SALT + path + s) -> https://{host}/get-mp3/{sign}/{ts}{path}

use md5::{Digest, Md5};
use serde::Serialize;
use serde_json::Value;

const API_BASE: &str = "https://api.music.yandex.net";
const SIGN_SALT: &str = "XGRlBW9FXlekgbPrRHuSiA";

fn http(token: &str) -> Result<reqwest::Client, String> {
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
        reqwest::header::AUTHORIZATION,
        format!("OAuth {}", token).parse().map_err(|_| "Некорректный токен".to_string())?,
    );
    headers.insert(
        "X-Yandex-Music-Client",
        "YandexMusicAndroid/2024.10.3".parse().map_err(|_| "Header error".to_string())?,
    );
    reqwest::Client::builder()
        .default_headers(headers)
        .user_agent("YandexMusicAndroid/2024.10.3")
        .build()
        .map_err(|e| e.to_string())
}

async fn get_json(token: &str, path: &str) -> Result<Value, String> {
    let url = format!("{}{}", API_BASE, path);
    let resp = http(token)?.get(&url).send().await.map_err(|e| {
        if e.is_connect() {
            "Нет соединения с Яндекс Музыкой".to_string()
        } else {
            e.to_string()
        }
    })?;
    let status = resp.status();
    let v: Value = resp.json().await.map_err(|e| e.to_string())?;
    if status.as_u16() == 401 {
        return Err("Токен Яндекса недействителен или истёк. Получите новый в настройках".into());
    }
    if !status.is_success() {
        let msg = v
            .get("error")
            .and_then(|e| e.as_str())
            .unwrap_or("ошибка API");
        return Err(format!("Яндекс Музыка: {} (HTTP {})", msg, status));
    }
    if v.get("result").is_none() && v.get("error").is_some() {
        return Err(format!(
            "Яндекс Музыка: {}",
            v.get("error").and_then(|e| e.as_str()).unwrap_or("ошибка")
        ));
    }
    Ok(v)
}

fn result_of(v: Value) -> Value {
    v.get("result").cloned().unwrap_or(Value::Null)
}

fn s(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(|x| x.as_str()).map(String::from)
}

fn i64v(v: &Value, key: &str) -> i64 {
    v.get(key).and_then(|x| x.as_i64()).unwrap_or(0)
}

#[derive(Debug, Serialize)]
pub struct YmTrack {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub duration_ms: i64,
    pub cover: Option<String>,
    pub available: bool,
    pub explicit: bool,
}

// Обложка: coverUri содержит шаблон "%%" вместо размера
fn cover_url(uri: Option<&str>, size: &str) -> Option<String> {
    uri.map(|u| format!("https://{}", u.replace("%%", size)))
}

fn parse_track(v: &Value) -> Option<YmTrack> {
    let id = match v.get("id") {
        Some(Value::Number(n)) => Some(n.to_string()),
        Some(Value::String(x)) => Some(x.clone()),
        _ => None,
    }?;
    let title_raw = s(v, "title").unwrap_or_else(|| "Без названия".into());
    let version = s(v, "version");
    let title = match version {
        Some(ver) if !ver.is_empty() && !title_raw.contains(&ver) => format!("{} ({})", title_raw, ver),
        _ => title_raw,
    };
    let artist = v
        .get("artists")
        .and_then(|a| a.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|a| s(a, "name"))
                .collect::<Vec<_>>()
                .join(", ")
        })
        .filter(|x| !x.is_empty())
        .unwrap_or_else(|| "Unknown artist".into());
    let cover_raw = s(v, "coverUri").or_else(|| s(v, "ogImage"));
    Some(YmTrack {
        id,
        title,
        artist,
        album: v
            .get("albums")
            .and_then(|a| a.as_array())
            .and_then(|a| a.first())
            .and_then(|a| s(a, "title")),
        duration_ms: i64v(v, "durationMs"),
        cover: cover_url(cover_raw.as_deref(), "200x200"),
        available: v.get("available").and_then(|x| x.as_bool()).unwrap_or(true),
        explicit: v.get("explicit").and_then(|x| x.as_bool()).unwrap_or(false),
    })
}

#[derive(Debug, Serialize)]
pub struct YmUser {
    pub id: i64,
    pub name: String,
    pub cover: Option<String>,
    pub track_count: i64,
    pub verified: bool,
}

fn parse_user(v: &Value) -> Option<YmUser> {
    let id = v.get("id").and_then(|x| x.as_i64())?;
    Some(YmUser {
        id,
        name: s(v, "name").unwrap_or_else(|| "Unknown".into()),
        cover: v
            .get("cover")
            .and_then(|c| c.get("uri"))
            .and_then(|u| u.as_str())
            .and_then(|u| cover_url(Some(u), "200x200")),
        track_count: v
            .get("counts")
            .map(|c| i64v(c, "tracks"))
            .unwrap_or(0),
        verified: v.get("verified").and_then(|x| x.as_bool()).unwrap_or(false),
    })
}

#[derive(Debug, Serialize)]
pub struct YmPlaylist {
    pub kind: i64,
    pub owner_uid: i64,
    pub title: String,
    pub owner_login: String,
    pub cover: Option<String>,
    pub track_count: i64,
}

fn parse_playlist(v: &Value) -> Option<YmPlaylist> {
    let kind = v.get("kind").and_then(|x| x.as_i64())?;
    let owner = v.get("owner")?;
    Some(YmPlaylist {
        kind,
        owner_uid: owner.get("uid").and_then(|x| x.as_i64())?,
        title: s(v, "title").unwrap_or_else(|| "Без названия".into()),
        owner_login: s(owner, "login").unwrap_or_default(),
        cover: v
            .get("cover")
            .and_then(|c| c.get("uri"))
            .and_then(|u| u.as_str())
            .and_then(|u| cover_url(Some(u), "200x200")),
        track_count: i64v(v, "trackCount"),
    })
}

fn encode_query(q: &str) -> String {
    let mut out = String::with_capacity(q.len() + 8);
    for b in q.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(*b as char),
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

#[tauri::command]
pub async fn yandex_search(token: String, q: String, limit: Option<u32>) -> Result<Vec<YmTrack>, String> {
    if token.trim().is_empty() {
        return Err("Токен Яндекс Музыки не задан. Укажите его в настройках — раздел «Источники»".into());
    }
    let limit = limit.unwrap_or(20).clamp(1, 50);
    let path = format!(
        "/search?text={}&type=track&pageSize={}",
        encode_query(&q),
        limit
    );
    let v = get_json(&token, &path).await?;
    let tracks = result_of(v)
        .get("tracks")
        .and_then(|t| t.get("results"))
        .and_then(|t| t.as_array())
        .cloned()
        .unwrap_or_default();
    Ok(tracks.iter().filter_map(parse_track).collect())
}

#[tauri::command]
pub async fn yandex_search_artists(token: String, q: String, limit: Option<u32>) -> Result<Vec<YmUser>, String> {
    if token.trim().is_empty() {
        return Err("Токен Яндекс Музыки не задан. Укажите его в настройках — раздел «Источники»".into());
    }
    let limit = limit.unwrap_or(20).clamp(1, 50);
    let path = format!("/search?text={}&type=artist&pageSize={}", encode_query(&q), limit);
    let v = get_json(&token, &path).await?;
    let artists = result_of(v)
        .get("artists")
        .and_then(|t| t.get("results"))
        .and_then(|t| t.as_array())
        .cloned()
        .unwrap_or_default();
    Ok(artists.iter().filter_map(parse_user).collect())
}

#[tauri::command]
pub async fn yandex_search_playlists(token: String, q: String, limit: Option<u32>) -> Result<Vec<YmPlaylist>, String> {
    if token.trim().is_empty() {
        return Err("Токен Яндекс Музыки не задан. Укажите его в настройках — раздел «Источники»".into());
    }
    let limit = limit.unwrap_or(15).clamp(1, 50);
    let path = format!("/search?text={}&type=playlist&pageSize={}", encode_query(&q), limit);
    let v = get_json(&token, &path).await?;
    let pls = result_of(v)
        .get("playlists")
        .and_then(|t| t.get("results"))
        .and_then(|t| t.as_array())
        .cloned()
        .unwrap_or_default();
    Ok(pls.iter().filter_map(parse_playlist).collect())
}

// Полные описания треков по списку id (batch /tracks?track-ids=)
async fn fetch_tracks_full(token: &str, ids: &[String]) -> Result<Vec<YmTrack>, String> {
    if ids.is_empty() {
        return Ok(vec![]);
    }
    let ids_str = ids.join(",");
    let v = get_json(token, &format!("/tracks?track-ids={}", ids_str)).await?;
    let arr = result_of(v)
        .as_array()
        .cloned()
        .unwrap_or_default();
    Ok(arr.iter().filter_map(parse_track).collect())
}

#[tauri::command]
pub async fn yandex_artist_tracks(token: String, artist_id: i64, limit: Option<u32>) -> Result<Vec<YmTrack>, String> {
    if token.trim().is_empty() {
        return Err("Токен Яндекс Музыки не задан. Укажите его в настройках — раздел «Источники»".into());
    }
    let limit = limit.unwrap_or(20).clamp(1, 50);
    let v = get_json(&token, &format!("/artists/{}/tracks?pageSize={}", artist_id, limit)).await?;
    let arr = result_of(v).as_array().cloned().unwrap_or_default();
    // Здесь приходят краткие объекты — догружаем полные описания по id
    let ids: Vec<String> = arr
        .iter()
        .filter_map(|t| {
            match t.get("id") {
                Some(Value::Number(n)) => Some(n.to_string()),
                Some(Value::String(x)) => Some(x.clone()),
                _ => None,
            }
        })
        .collect();
    fetch_tracks_full(&token, &ids).await
}

#[tauri::command]
pub async fn yandex_playlist_tracks(token: String, owner_uid: i64, kind: i64) -> Result<Vec<YmTrack>, String> {
    if token.trim().is_empty() {
        return Err("Токен Яндекс Музыки не задан. Укажите его в настройках — раздел «Источники»".into());
    }
    let v = get_json(&token, &format!("/users/{}/playlists/{}", owner_uid, kind)).await?;
    let pl = result_of(v);
    let ids: Vec<String> = pl
        .get("tracks")
        .and_then(|t| t.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|t| {
                    match t.get("id") {
                        Some(Value::Number(n)) => Some(n.to_string()),
                        Some(Value::String(x)) => Some(x.clone()),
                        _ => None,
                    }
                })
                .collect()
        })
        .unwrap_or_default();
    // Краткие объекты в плейлисте содержат id и минимум полей — берём полные
    let mut full = fetch_tracks_full(&token, &ids).await?;
    if full.is_empty() {
        // Иногда tracks уже содержат полные объекты
        full = pl
            .get("tracks")
            .and_then(|t| t.as_array())
            .map(|arr| arr.iter().filter_map(parse_track).collect())
            .unwrap_or_default();
    }
    Ok(full)
}

// Прямая ссылка на аудио. Живёт ~1 минуту — вызывается строго перед Play.
#[tauri::command]
pub async fn yandex_track_stream(token: String, track_id: String) -> Result<String, String> {
    if token.trim().is_empty() {
        return Err("Токен Яндекс Музыки не задан".into());
    }
    let clean_id: String = track_id.split(':').next().unwrap_or(&track_id).to_string();
    let v = get_json(&token, &format!("/tracks/{}/download-info", clean_id)).await?;
    let infos = result_of(v)
        .as_array()
        .cloned()
        .ok_or("download-info: неожиданный ответ")?;

    // Приоритет: mp3 с максимальным битрейтом (до 320), иначе любой вариант
    let mut best: Option<&Value> = None;
    let mut best_score: i64 = -1;
    for info in infos.iter() {
        if s(info, "downloadInfoUrl").is_none() {
            continue;
        }
        let codec = s(info, "codec").unwrap_or_default();
        let bitrate = i64v(info, "bitrateInKbps");
        let score = if codec == "mp3" { 1000 + bitrate.min(320) } else { bitrate };
        if score > best_score {
            best_score = score;
            best = Some(info);
        }
    }
    let info = best.ok_or("Для трека нет доступных аудио-потоков (нужна подписка Плюс?)")?;
    let info_url = s(info, "downloadInfoUrl").unwrap();

    // XML с host/path/ts/s
    let xml = http(&token)?
        .get(&info_url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;

    let tag = |name: &str| -> Option<String> {
        let open = format!("<{}>", name);
        let close = format!("</{}>", name);
        let start = xml.find(&open)? + open.len();
        let end = xml[start..].find(&close)? + start;
        Some(xml[start..end].to_string())
    };
    let host = tag("host").ok_or("download-info XML: нет host")?;
    let path = tag("path").ok_or("download-info XML: нет path")?;
    let ts = tag("ts").ok_or("download-info XML: нет ts")?;
    let sig_s = tag("s").ok_or("download-info XML: нет s")?;

    // path в XML начинается с '/', в подписи используется без него
    let path_for_sign = path.trim_start_matches('/');
    let mut hasher = Md5::new();
    hasher.update(SIGN_SALT.as_bytes());
    hasher.update(path_for_sign.as_bytes());
    hasher.update(sig_s.as_bytes());
    let sign = format!("{:x}", hasher.finalize());

    Ok(format!("https://{}/get-mp3/{}/{}{}", host, sign, ts, path))
}
