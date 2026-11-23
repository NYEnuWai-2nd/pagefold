/// Files passed on the command line (e.g. "Open with Pagefold" from the file manager).
#[tauri::command]
fn startup_files() -> Vec<String> {
    std::env::args()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .filter(|a| {
            let l = a.to_lowercase();
            l.ends_with(".pdf") || l.ends_with(".png") || l.ends_with(".jpg") || l.ends_with(".jpeg")
        })
        .filter_map(|a| std::fs::canonicalize(&a).ok().map(|p| {
            let s = p.to_string_lossy().to_string();
            s.strip_prefix(r"\?\").map(str::to_string).unwrap_or(s)
        }))
        .collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![startup_files])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
