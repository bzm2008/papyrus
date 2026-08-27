use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    App, AppHandle, Emitter, Manager, WindowEvent,
};

const MENU_SHOW: &str = "papyrus.show";
const MENU_PAUSE: &str = "papyrus.pause";
const MENU_CANCEL: &str = "papyrus.cancel";
const MENU_EXIT: &str = "papyrus.exit";
const EVENT_PAUSE: &str = "papyrus://pause-tasks";
const EVENT_CANCEL: &str = "papyrus://cancel-tasks";
const EVENT_PREPARE_EXIT: &str = "papyrus://prepare-exit";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TrayAction {
    Show,
    Pause,
    Cancel,
    Exit,
}

pub fn install(app: &mut App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, MENU_SHOW, "显示 Papyrus", true, None::<&str>)?;
    let pause = MenuItem::with_id(app, MENU_PAUSE, "暂停当前任务", true, None::<&str>)?;
    let cancel = MenuItem::with_id(app, MENU_CANCEL, "取消当前任务", true, None::<&str>)?;
    let exit = MenuItem::with_id(app, MENU_EXIT, "退出 Papyrus", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &pause, &cancel, &exit])?;

    let builder = TrayIconBuilder::with_id("papyrus-tray")
        .menu(&menu)
        .tooltip("Papyrus")
        .on_menu_event(|app, event| match tray_action(event.id().as_ref()) {
            Some(TrayAction::Show) => show_main_window(app),
            Some(TrayAction::Pause) => {
                let _ = app.emit(EVENT_PAUSE, ());
            }
            Some(TrayAction::Cancel) => {
                let _ = app.emit(EVENT_CANCEL, ());
            }
            Some(TrayAction::Exit) => {
                let _ = app.emit(EVENT_PREPARE_EXIT, ());
            }
            None => {}
        });
    let builder = if let Some(icon) = app.default_window_icon().cloned() {
        builder.icon(icon)
    } else {
        builder
    };
    builder.build(app)?;

    Ok(())
}

pub fn handle_window_event(window: &tauri::Window, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let _ = window.hide();
    }
}

#[tauri::command]
pub fn complete_explicit_exit(app: AppHandle) {
    if let Some(window) = app.get_webview_window("mascot") {
        let _ = window.destroy();
    }
    app.exit(0);
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn tray_action(id: &str) -> Option<TrayAction> {
    match id {
        MENU_SHOW => Some(TrayAction::Show),
        MENU_PAUSE => Some(TrayAction::Pause),
        MENU_CANCEL => Some(TrayAction::Cancel),
        MENU_EXIT => Some(TrayAction::Exit),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tray_menu_only_exposes_explicit_lifecycle_actions() {
        assert_eq!(tray_action(MENU_SHOW), Some(TrayAction::Show));
        assert_eq!(tray_action(MENU_PAUSE), Some(TrayAction::Pause));
        assert_eq!(tray_action(MENU_CANCEL), Some(TrayAction::Cancel));
        assert_eq!(tray_action(MENU_EXIT), Some(TrayAction::Exit));
        assert_eq!(tray_action("papyrus.approve"), None);
    }
}
