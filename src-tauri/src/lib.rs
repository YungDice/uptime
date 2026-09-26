//! Uptime's native shell.
//!
//! Deliberately thin. The streak, the ledger and every rule live on the server
//! (see supabase/migrations); this crate exists to put the same web frontend
//! on Windows, Android and iOS, and to reach the things a web page cannot: the
//! platform notification services behind the check-in prompt, and on desktop,
//! replacing itself with a newer build.

#[cfg(desktop)]
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // One window, however many times it is launched. Without this, clicking
    // the Start menu entry for an app already open behind other windows
    // opened a second copy - two clocks polling side by side, and a second
    // process holding the exe the updater needs to replace. A second launch
    // now brings the first one forward instead. Registered before anything
    // else, as the plugin requires, so the second copy exits before it has
    // started anything of its own.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
    }));

    let builder = builder.plugin(tauri_plugin_notification::init());

    // `uptime://add/<code>`: an invite link, opened from the invite page. The
    // installer registers the scheme; the frontend reads what arrives
    // (src/invites/deepLink.ts).
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_deep_link::init());

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
        .setup(|_app| {
            #[cfg(desktop)]
            if let Some(window) = _app.get_webview_window("main") {
                fit_to_screen(&window);
            }
            // An installed build has its scheme written by the installer. A
            // development build was never installed, so it registers itself -
            // otherwise invite links could not be tried before a release.
            #[cfg(all(desktop, debug_assertions))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = _app.deep_link().register_all();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![notification_permission])
        .run(tauri::generate_context!())
        .expect("error while running Uptime");
}

/// Keep the window inside the screen it opens on, and centred on it.
///
/// The window is a phone-shaped 900 tall, and the most common laptop setups
/// are not that tall once scaled: 1920x1080 at 125% leaves 816 above the
/// taskbar, and 1366x768 at 100% leaves 720. The window
/// opened taller than the space it had, so its bottom edge - the tab bar, the
/// only way between the four screens - sat under the taskbar or off the
/// screen entirely, on first launch, for exactly the people most likely to
/// install a desktop app on a laptop.
///
/// Measured against the work area, not the monitor, because the taskbar is
/// what was covering it. Physical pixels throughout, so no scale factor is
/// applied twice.
#[cfg(desktop)]
fn fit_to_screen<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else { return };
    let area = *monitor.work_area();
    let (Ok(outer), Ok(inner)) = (window.outer_size(), window.inner_size()) else {
        return;
    };

    // The title bar and borders, which the configured size does not include.
    let frame = outer.height.saturating_sub(inner.height);
    let height = inner.height.min(area.size.height.saturating_sub(frame));
    if height < inner.height {
        let _ = window.set_size(tauri::PhysicalSize::new(inner.width, height));
    }

    let x = area.position.x + (area.size.width as i32 - outer.width as i32) / 2;
    let y = area.position.y + (area.size.height as i32 - (height + frame) as i32) / 2;
    let _ = window.set_position(tauri::PhysicalPosition::new(x, y.max(area.position.y)));
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
