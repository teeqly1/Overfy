// Discord Rich Presence: показывает прослушиваемый трек в статусе аккаунта.
// Соединение идёт по IPC (named pipe) с запущенным клиентом Discord.
// Если Discord не запущен или Client ID ещё не вписан — команды безопасно
// возвращают false, звук/приложение не ломается.

use discord_rich_presence::activity::{Activity, ActivityType, Assets, StatusDisplayType, Timestamps};
use discord_rich_presence::{DiscordIpc, DiscordIpcClient};
use serde::Deserialize;
use std::sync::{Mutex, OnceLock};

static CONTEXT: OnceLock<Mutex<Option<DiscordIpcClient>>> = OnceLock::new();

fn context() -> &'static Mutex<Option<DiscordIpcClient>> {
    CONTEXT.get_or_init(|| Mutex::new(None))
}

fn lock_client() -> Result<std::sync::MutexGuard<'static, Option<DiscordIpcClient>>, String> {
    context().lock().map_err(|_| "mutex poisoned".to_string())
}

/// Параметры активности для отображения в Discord.
#[derive(Deserialize)]
pub struct DiscordActivityPayload {
    pub details: Option<String>,
    pub state: Option<String>,
    pub large_text: Option<String>,
    pub small_text: Option<String>,
    pub playing: bool,
    pub started_at_ms: Option<i64>,
}

fn build_activity(p: DiscordActivityPayload) -> Activity<'static> {
    let mut a = Activity::new()
        .name("Overfy")
        .activity_type(ActivityType::Listening)
        .status_display_type(StatusDisplayType::Details);
    if let Some(d) = p.details {
        a = a.details(d);
    }
    if let Some(s) = p.state {
        a = a.state(s);
    }
    if p.playing || p.started_at_ms.is_some() {
        if let Some(start) = p.started_at_ms {
            a = a.timestamps(Timestamps::new().start(start));
        }
    }
    if p.large_text.is_some() || p.small_text.is_some() {
        let mut assets = Assets::new();
        if let Some(t) = p.large_text {
            assets = assets.large_text(t);
        }
        if let Some(t) = p.small_text {
            assets = assets.small_text(t);
        }
        a = a.assets(assets);
    }
    a
}

/// Подключение к Discord IPC (выполняется в фоне, чтобы не блокировать UI).
#[tauri::command]
pub async fn discord_rpc_connect(client_id: String) -> Result<bool, String> {
    if client_id.is_empty() || client_id.contains("YOUR_CLIENT_ID") {
        return Ok(false);
    }
    let had_client = { lock_client()?.is_some() };
    if had_client {
        return Ok(true);
    }
    let spawned = tauri::async_runtime::spawn_blocking(move || {
        let mut client = DiscordIpcClient::new(client_id.as_str());
        match client.connect() {
            Ok(()) => {
                let mut guard = lock_client()?;
                *guard = Some(client);
                Ok::<bool, String>(true)
            }
            Err(_) => Ok(false),
        }
    })
    .await
    .map_err(|e| e.to_string())?;
    spawned
}

/// Обновление активности (трек, исполнитель, статус воспроизведения).
#[tauri::command]
pub async fn discord_rpc_set_activity(payload: DiscordActivityPayload) -> Result<bool, String> {
    let activity = build_activity(payload);
    let spawned = tauri::async_runtime::spawn_blocking(move || {
        let mut guard = lock_client()?;
        let Some(client) = guard.as_mut() else {
            return Ok::<bool, String>(false);
        };
        client
            .set_activity(activity)
            .map(|_| true)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?;
    spawned
}

/// Сброс активности и отключение от Discord.
#[tauri::command]
pub fn discord_rpc_disconnect() -> Result<(), String> {
    let mut guard = lock_client()?;
    if let Some(mut client) = guard.take() {
        let _ = client.close();
    }
    Ok(())
}