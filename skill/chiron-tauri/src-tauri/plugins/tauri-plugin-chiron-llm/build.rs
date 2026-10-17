const COMMANDS: &[&str] = &[
    "llm_status",
    "llm_download",
    "llm_download_cancel",
    "llm_load",
    "llm_generate",
    "llm_cancel",
    "llm_unload",
    "llm_delete",
    "voice_status",
    "stt_listen",
    "stt_stop",
    "tts_speak",
    "tts_stop",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).android_path("android").build();
}
