//! Chiron on-device tutor plugin. Every command is forwarded to the Kotlin plugin
//! (`android/.../LlmPlugin.kt`); on non-Android targets the plugin registers no handle, so the
//! commands answer with an error and the panel hides Veloce. Streaming commands take a Tauri
//! `Channel` that Kotlin writes to (download progress, tokens, STT partials).

use serde_json::{json, Value};
#[cfg(target_os = "android")]
use tauri::Manager;
use tauri::{
    ipc::Channel,
    plugin::{Builder, PluginHandle, TauriPlugin},
    AppHandle, Runtime, State,
};

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "com.gyasi.chiron.llm";

struct Llm<R: Runtime>(PluginHandle<R>);

async fn fwd<R: Runtime>(llm: &State<'_, Llm<R>>, cmd: &str, payload: Value) -> Result<Value, String> {
    llm.0
        .run_mobile_plugin_async::<Value>(cmd, payload)
        .await
        .map_err(|e| format!("{cmd}: {e}"))
}

/// Commands that take a plain JSON object (or nothing).
macro_rules! passthru {
    ($($name:ident => $kt:literal),* $(,)?) => { $(
        #[tauri::command]
        async fn $name<R: Runtime>(_app: AppHandle<R>, llm: State<'_, Llm<R>>, args: Option<Value>) -> Result<Value, String> {
            fwd(&llm, $kt, args.unwrap_or_else(|| json!({}))).await
        }
    )* };
}

passthru! {
    llm_download_cancel => "llmDownloadCancel",
    llm_cancel => "llmCancel",
    llm_unload => "llmUnload",
    llm_delete => "llmDelete",
    voice_status => "voiceStatus",
    stt_stop => "sttStop",
    tts_stop => "ttsStop",
}

#[tauri::command]
async fn llm_status<R: Runtime>(_app: AppHandle<R>, llm: State<'_, Llm<R>>, verify: Option<bool>) -> Result<Value, String> {
    fwd(&llm, "llmStatus", json!({ "verify": verify.unwrap_or(false) })).await
}

#[tauri::command]
async fn llm_load<R: Runtime>(_app: AppHandle<R>, llm: State<'_, Llm<R>>, backend: Option<String>) -> Result<Value, String> {
    fwd(&llm, "llmLoad", json!({ "backend": backend.unwrap_or_else(|| "gpu".into()) })).await
}

#[tauri::command]
async fn llm_download<R: Runtime>(
    _app: AppHandle<R>,
    llm: State<'_, Llm<R>>,
    url: String,
    sha256: Option<String>,
    on_event: Channel<Value>,
) -> Result<Value, String> {
    fwd(&llm, "llmDownload", json!({ "url": url, "sha256": sha256.unwrap_or_default(), "onEvent": on_event })).await
}

#[tauri::command]
async fn llm_generate<R: Runtime>(
    _app: AppHandle<R>,
    llm: State<'_, Llm<R>>,
    system: Option<String>,
    prompt: String,
    max_tokens: Option<i64>,
    on_event: Channel<Value>,
) -> Result<Value, String> {
    fwd(
        &llm,
        "llmGenerate",
        json!({ "system": system.unwrap_or_default(), "prompt": prompt, "maxTokens": max_tokens.unwrap_or(0), "onEvent": on_event }),
    )
    .await
}

#[tauri::command]
async fn stt_listen<R: Runtime>(
    _app: AppHandle<R>,
    llm: State<'_, Llm<R>>,
    lang: Option<String>,
    prefer_offline: Option<bool>,
    on_event: Channel<Value>,
) -> Result<Value, String> {
    fwd(
        &llm,
        "sttListen",
        json!({ "lang": lang.unwrap_or_else(|| "it-IT".into()), "preferOffline": prefer_offline.unwrap_or(true), "onEvent": on_event }),
    )
    .await
}

#[tauri::command]
async fn tts_speak<R: Runtime>(_app: AppHandle<R>, llm: State<'_, Llm<R>>, text: String, lang: Option<String>) -> Result<Value, String> {
    fwd(&llm, "ttsSpeak", json!({ "text": text, "lang": lang.unwrap_or_else(|| "it-IT".into()) })).await
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("chiron-llm")
        .invoke_handler(tauri::generate_handler![llm_status, llm_download, llm_download_cancel, llm_load, llm_generate, llm_cancel, llm_unload, llm_delete, voice_status, stt_listen, stt_stop, tts_speak, tts_stop])
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                let handle = _api.register_android_plugin(PLUGIN_IDENTIFIER, "LlmPlugin")?;
                _app.manage(Llm(handle));
            }
            Ok(())
        })
        .build()
}
