//! Uptime's native shell.
//!
//! Deliberately thin. The streak, the ledger and every rule live on the server
//! (see supabase/migrations); this crate exists to put the same web frontend
//! on Windows, Android and iOS, and to reach the things a web page cannot: the
//! platform notification services behind the check-in prompt, and on desktop,
//! replacing itself with a newer build.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().plugin(tauri_plugin_notification::init());

    // The desktop build updates itself from the signed feed named in
    // tauri.conf.json; the phones get theirs from the stores.
    //
    // The opener hands the Stripe Checkout page to the system browser: the
    // app's own window must never navigate away from the app, and a card form
    // belongs in the browser the user trusts. Desktop only, because the phone
    // stores require their own billing for digital upgrades, so the phone
    // builds do not sell one (see `canBuyHere` in src/payments/checkout.ts).
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init());

    builder
        .invoke_handler(tauri::generate_handler![notification_permission])
        .run(tauri::generate_context!())
        .expect("error while running Uptime");
}

/// Whether this install can show the "still here?" prompt.
///
/// The prompt is a convenience, never the mechanism: the window is measured
/// server-side from `last_seen`, so a user who has blocked notifications keeps
/// their streak exactly as long as one who has not. This only tells the
/// frontend whether it is worth offering to turn them on.
#[tauri::command]
fn notification_permission() -> Result<String, String> {
    Ok("unknown".to_string())
}
